import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { ExportJobRepository } from '../repositories/export-job.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { type EsignExportJob } from '../entities/esign-export-job.entity';
import { type EsignSigner } from '../entities/esign-signer.entity';
import {
  EXPORT_HISTORY_TYPES,
  type ExportedByDto,
  type ExportHistoryItemDto,
  type ExportHistoryPageDto,
  type ExportHistoryQueryDto,
  type ExportHistoryType,
} from '../dto/export-history.dto';
import {
  EsignCompletionAccessService,
  type PersonalCopyFile,
} from './esign-completion-access.service';
import { EsignExportService } from './esign-export.service';

/** API 紀錄類型與 DB `export_type` 的唯一對應；ZIP 沿用 Spec 009 的既有值。 */
const EXPORT_TYPE_COLUMN: Record<ExportHistoryType, string> = {
  excel: 'excel',
  pdf: 'pdf',
  zip: 'signed_copies_zip',
};

/** `esign_export_jobs.scope_description` 的欄位長度（字元）。 */
const SCOPE_MAX_LENGTH = 255;

/** 歷史匯出紀錄：三種類型共用 `esign_export_jobs`，ZIP 工作狀態沿用 EsignExportService。 */
@Injectable()
export class EsignExportHistoryService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly jobs: ExportJobRepository,
    private readonly exports: EsignExportService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly completions: EsignCompletionAccessService,
  ) {}

  async list(q: ExportHistoryQueryDto): Promise<ExportHistoryPageDto> {
    const manager = this.mysql.getManager();
    const documentId = q.documentId ? Number(q.documentId) : undefined;
    const [rows, counts] = await Promise.all([
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
      items: await Promise.all(rows.map((job) => this.item(job, q.type))),
      page: q.page,
      pageSize: q.pageSize,
      total: typeTotals[q.type],
      typeTotals,
    };
  }

  /**
   * 單人副本送出前寫入一筆 pdf 紀錄，範圍為簽署人標籤。
   * exporterUserId 為 NULL 代表外部簽署人本人下載；寫入失敗時拋錯，呼叫端不可送出檔案。
   */
  recordPdf(signer: EsignSigner, exporterUserId: number | null): Promise<void> {
    return this.insertPdf(signer, signerLabel(signer), exporterUserId);
  }

  /**
   * 從 pdf 紀錄重新下載：任何員工都能取得該簽署人目前的副本。
   * 送出前新增一筆紀錄，簽署人（含文件）與範圍沿用原紀錄，匯出人為目前使用者。
   */
  async redownloadPdf(
    recordId: string,
    userId: number,
  ): Promise<PersonalCopyFile> {
    const manager = this.mysql.getManager();
    const record = await this.jobs.findRecord(
      recordId,
      EXPORT_TYPE_COLUMN.pdf,
      manager,
    );
    const signer = record?.signerId
      ? await this.signers.findById(record.signerId, manager)
      : null;
    const document = signer
      ? await this.documents.findById(signer.documentId, manager)
      : null;
    if (!record || !signer || !document)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    const file = await this.completions.personalCopy(document, signer);
    if (!file)
      throw new AppException(...AppErrors.ESIGN_PERSONAL_COPY_NOT_READY);
    await this.insertPdf(signer, record.scopeDescription, userId);
    return file;
  }

  private async insertPdf(
    signer: EsignSigner,
    scope: string,
    exporterUserId: number | null,
  ): Promise<void> {
    const manager = this.mysql.getManager();
    await this.jobs.save(
      this.jobs.create(
        {
          publicId: randomUUID(),
          exportType: EXPORT_TYPE_COLUMN.pdf,
          documentId: signer.documentId,
          createdByUserId: exporterUserId,
          signerId: signer.id,
          status: 'completed',
          scopeDescription: scope,
          recordCount: 1,
          completedAt: new Date(),
        },
        manager,
      ),
      manager,
    );
  }

  /** 紀錄需已帶出文件、匯出員工與簽署人（見 ExportJobRepository.historyPage）。 */
  private async item(
    job: EsignExportJob,
    type: ExportHistoryType,
  ): Promise<ExportHistoryItemDto> {
    const document = job.document!;
    const common = {
      id: job.publicId!,
      type,
      document: {
        id: String(document.id),
        title: document.title,
        docNumber: document.docNumber,
      },
      exportedBy: exportedBy(job),
      exportedAt: job.createdAt.toISOString(),
      scope: job.scopeDescription,
      count: Number(job.recordCount ?? 0),
    };
    if (type === 'excel') return { ...common, conditions: job.conditionsJson! };
    if (type === 'pdf')
      return { ...common, signerPublicId: job.signer!.publicId };
    return { ...common, ...(await this.exports.view(job)) };
  }
}

/** 員工為「姓名（員工編號）」，外部簽署人為「姓名（Email）」；超過欄位長度時依字元截斷。 */
function signerLabel(signer: EsignSigner): string {
  const identity =
    signer.signerType === 'email' ? signer.email : signer.empidSnapshot;
  return Array.from(`${signer.nameSnapshot}（${identity}）`)
    .slice(0, SCOPE_MAX_LENGTH)
    .join('');
}

/** 有匯出員工時顯示員工；NULL 代表外部簽署人本人下載，改以簽署人姓名與 Email 顯示。 */
function exportedBy(job: EsignExportJob): ExportedByDto {
  if (job.createdByUser)
    return {
      name: job.createdByUser.name,
      employeeNo: job.createdByUser.empid,
      email: null,
    };
  return {
    name: job.signer!.nameSnapshot,
    employeeNo: null,
    email: job.signer!.email ?? null,
  };
}
