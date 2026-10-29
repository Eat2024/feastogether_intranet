import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { ExportJobRepository } from '../repositories/export-job.repository';
import { SignerRepository } from '../repositories/signer.repository';
import {
  type EsignExportJob,
  EXPORT_TYPE_COLUMN,
} from '../entities/esign-export-job.entity';
import { type EsignSigner } from '../entities/esign-signer.entity';
import {
  type CreateExcelExportRecordDto,
  type ExcelExportDocumentDto,
  EXPORT_HISTORY_TYPES,
  type ExportedByDto,
  type ExportHistoryItemDto,
  type ExportHistoryPageDto,
  type ExportHistoryQueryDto,
  type ExportHistoryType,
} from '../dto/export-history.dto';
import {
  EsignCompletionAccessService,
  type PersonalCopyDownload,
  type PersonalCopyFile,
} from './esign-completion-access.service';
import { EsignExportService } from './esign-export.service';
import { EsignViewMapper } from './esign-view.mapper';
import { ExternalAccessService } from './external-access.service';

/** `esign_export_jobs.scope_description` 的欄位長度（字元）。 */
const SCOPE_MAX_LENGTH = 255;

/** 歷史匯出紀錄：三種類型共用 `esign_export_jobs`，ZIP 工作狀態沿用 EsignExportService。 */
@Injectable()
export class EsignExportHistoryService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly jobs: ExportJobRepository,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly users: UserRepository,
    private readonly exports: EsignExportService,
    private readonly mapper: EsignViewMapper,
    private readonly completions: EsignCompletionAccessService,
    private readonly external: ExternalAccessService,
  ) {}

  async list(q: ExportHistoryQueryDto): Promise<ExportHistoryPageDto> {
    const manager = this.mysql.getManager();
    const documentId = q.documentId ? Number(q.documentId) : undefined;
    const [records, counts] = await Promise.all([
      this.jobs.historyPage(
        {
          exportType: EXPORT_TYPE_COLUMN[q.type],
          documentId,
          offset: (q.page - 1) * q.pageSize,
          limit: q.pageSize,
        },
        manager,
      ),
      this.jobs.historyCounts(
        Object.values(EXPORT_TYPE_COLUMN),
        documentId,
        manager,
      ),
    ]);
    const typeTotals = {} as Record<ExportHistoryType, number>;
    for (const type of EXPORT_HISTORY_TYPES)
      typeTotals[type] = counts.get(EXPORT_TYPE_COLUMN[type]) ?? 0;
    return {
      items: await Promise.all(
        records.map((record) => this.toHistoryItem(record, q.type)),
      ),
      page: q.page,
      pageSize: q.pageSize,
      total: typeTotals[q.type],
      typeTotals,
    };
  }

  /** 記錄前端產生的 Excel：任何員工可記錄已發起文件，匯出人取自 session。 */
  async recordExcel(
    userId: number,
    body: CreateExcelExportRecordDto,
  ): Promise<ExportHistoryItemDto> {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(
      Number(body.documentId),
      manager,
    );
    // 已發起的文件不會再回到草稿或被刪除，不需鎖定。
    if (!document || document.status === 'draft')
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    const { publicId } = await this.insertRecord({
      exportType: EXPORT_TYPE_COLUMN.excel,
      documentId: document.id,
      createdByUserId: userId,
      scopeDescription: fitScope(body.scope, '…'),
      recordCount: body.count,
      conditionsJson: body.conditions,
    });
    const record = await this.jobs.historyRecord(
      publicId!,
      EXPORT_TYPE_COLUMN.excel,
      manager,
    );
    return this.toHistoryItem(record!, 'excel');
  }

  /** Excel 重新下載資料：任何員工可依 excel 紀錄取得文件目前的資料；唯讀，不新增紀錄。 */
  async excelDocument(publicId: string): Promise<ExcelExportDocumentDto> {
    const manager = this.mysql.getManager();
    const record = await this.jobs.historyRecord(
      publicId,
      EXPORT_TYPE_COLUMN.excel,
      manager,
    );
    const document = record
      ? await this.documents.findById(record.documentId!, manager)
      : null;
    if (!document)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    const [creator, signers] = await Promise.all([
      this.users.findById(document.createdByUserId, manager),
      this.signers.findByDocument(document.id, manager),
    ]);
    return this.mapper.excelExportDocument(document, creator, signers);
  }

  /** 建立人下載簽署人副本：匯出人為建立人；副本未產生時沿用建立人下載的錯誤。 */
  async downloadCreatorCopy(
    documentId: number,
    signerPublicId: string,
    userId: number,
  ): Promise<PersonalCopyFile> {
    const copy = await this.completions.creatorFile(
      documentId,
      signerPublicId,
      userId,
    );
    if (!copy.file)
      throw new AppException(...AppErrors.ESIGN_COMPLETED_DOCUMENT_NOT_READY);
    return this.recordPdf(copy, userId);
  }

  /** 內部員工以員工 session 下載本人副本：匯出人為本人。 */
  async downloadOwnCopy(
    signerPublicId: string,
    userId: number,
  ): Promise<PersonalCopyFile> {
    return this.recordPdf(
      await this.completions.signerFile(signerPublicId, userId),
      userId,
    );
  }

  /** 外部簽署人以 Email OTP 存取下載本人副本：匯出員工為 NULL。 */
  async downloadExternalCopy(credential: string): Promise<PersonalCopyFile> {
    return this.recordPdf(await this.external.completedFile(credential), null);
  }

  /**
   * 從 pdf 紀錄重新下載：任何員工都能取得該簽署人目前的副本。
   * 新紀錄的簽署人（含文件）與範圍沿用原紀錄，匯出人為目前使用者。
   */
  async redownloadPdf(
    publicId: string,
    userId: number,
  ): Promise<PersonalCopyFile> {
    const manager = this.mysql.getManager();
    const record = await this.jobs.historyRecord(
      publicId,
      EXPORT_TYPE_COLUMN.pdf,
      manager,
    );
    const signer = record
      ? await this.signers.findById(record.signerId!, manager)
      : null;
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    if (!record || !signer || !document)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    const file = await this.completions.personalCopy(document, signer);
    return this.recordPdf({ signer, file }, userId, record.scopeDescription);
  }

  /**
   * 送出副本前寫入一筆 pdf 紀錄，範圍預設為簽署人標籤；副本未產生時回 409，不記錄。
   * exporterUserId 為 NULL 代表外部簽署人本人下載；寫入失敗時拋錯，呼叫端不會送出檔案。
   */
  private async recordPdf(
    { signer, file }: PersonalCopyDownload,
    exporterUserId: number | null,
    scope = signerLabel(signer),
  ): Promise<PersonalCopyFile> {
    if (!file)
      throw new AppException(...AppErrors.ESIGN_PERSONAL_COPY_NOT_READY);
    await this.insertRecord({
      exportType: EXPORT_TYPE_COLUMN.pdf,
      documentId: signer.documentId,
      createdByUserId: exporterUserId,
      signerId: signer.id,
      scopeDescription: scope,
      recordCount: 1,
    });
    return file;
  }

  /** 新增一筆已完成的 excel／pdf 紀錄；這兩類紀錄寫入後不再更新。 */
  private insertRecord(fields: Partial<EsignExportJob>) {
    const manager = this.mysql.getManager();
    return this.jobs.save(
      this.jobs.create(
        {
          publicId: randomUUID(),
          status: 'completed',
          completedAt: new Date(),
          ...fields,
        },
        manager,
      ),
      manager,
    );
  }

  /** 紀錄需已帶出文件、匯出員工與簽署人（見 ExportJobRepository.historyPage）。 */
  private async toHistoryItem(
    record: EsignExportJob,
    type: ExportHistoryType,
  ): Promise<ExportHistoryItemDto> {
    const document = record.document!;
    return {
      id: record.publicId!,
      type,
      document: {
        id: String(document.id),
        title: document.title,
        docNumber: document.docNumber,
      },
      exportedBy: exportedBy(record),
      exportedAt: record.createdAt.toISOString(),
      scope: record.scopeDescription,
      count: Number(record.recordCount ?? 0),
      ...(await this.typeSpecificFields(record, type)),
    };
  }

  /** excel 的匯出條件、pdf 的簽署人，或 zip 的匯出工作狀態。 */
  private async typeSpecificFields(
    record: EsignExportJob,
    type: ExportHistoryType,
  ): Promise<Partial<ExportHistoryItemDto>> {
    if (type === 'excel') return { conditions: record.conditionsJson! };
    if (type === 'pdf') return { signerPublicId: record.signer!.publicId };
    return this.exports.view(record);
  }
}

/** 員工為「姓名（員工編號）」，外部簽署人為「姓名（Email）」；超過欄位長度時依字元截斷。 */
function signerLabel(signer: EsignSigner): string {
  const identity =
    signer.signerType === 'email' ? signer.email : signer.empidSnapshot;
  return fitScope(`${signer.nameSnapshot}（${identity}）`);
}

/** 依字元（code point）截斷到範圍欄位長度；有截斷時以 marker 結尾，總長仍不超過欄位長度。 */
function fitScope(scope: string, marker = ''): string {
  const characters = Array.from(scope);
  if (characters.length <= SCOPE_MAX_LENGTH) return scope;
  return (
    characters.slice(0, SCOPE_MAX_LENGTH - marker.length).join('') + marker
  );
}

/** 匯出員工為 NULL 代表外部簽署人本人下載，以簽署人姓名與 Email 顯示；其餘顯示匯出員工。 */
function exportedBy(record: EsignExportJob): ExportedByDto {
  if (record.createdByUserId === null)
    return {
      name: record.signer!.nameSnapshot,
      employeeNo: null,
      email: record.signer!.email ?? null,
    };
  return {
    name: record.createdByUser!.name,
    employeeNo: record.createdByUser!.empid,
    email: null,
  };
}
