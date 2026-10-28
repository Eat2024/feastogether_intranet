import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { DocumentRepository } from '../repositories/document.repository';
import { ExportJobRepository } from '../repositories/export-job.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { type EsignExportJob } from '../entities/esign-export-job.entity';
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
import { EsignExportService } from './esign-export.service';
import { EsignViewMapper } from './esign-view.mapper';

/** API 紀錄類型與 DB `export_type` 的唯一對應；ZIP 沿用 Spec 009 的既有值。 */
const EXPORT_TYPE_COLUMN: Record<ExportHistoryType, string> = {
  excel: 'excel',
  pdf: 'pdf',
  zip: 'signed_copies_zip',
};

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
    const { statuses, depts, fields } = body.conditions;
    const job = await this.jobs.save(
      this.jobs.create(
        {
          publicId: randomUUID(),
          exportType: EXPORT_TYPE_COLUMN.excel,
          documentId: document.id,
          createdByUserId: userId,
          status: 'completed',
          scopeDescription: body.scope,
          recordCount: body.count,
          conditionsJson: { statuses, depts, fields },
          completedAt: new Date(),
        },
        manager,
      ),
      manager,
    );
    return this.item(
      (await this.jobs.historyRecord(job.publicId!, manager))!,
      'excel',
    );
  }

  /** Excel 重新下載資料：任何員工可依 excel 紀錄取得文件目前的資料；唯讀，不新增紀錄。 */
  async excelDocument(publicId: string): Promise<ExcelExportDocumentDto> {
    const manager = this.mysql.getManager();
    const job = await this.jobs.historyRecord(publicId, manager);
    const document =
      job?.exportType === EXPORT_TYPE_COLUMN.excel
        ? await this.documents.findById(job.documentId!, manager)
        : null;
    if (!document)
      throw new AppException(...AppErrors.ESIGN_RESOURCE_NOT_FOUND);
    const [creator, signers] = await Promise.all([
      this.users.findById(document.createdByUserId, manager),
      this.signers.findByDocument(document.id, manager),
    ]);
    return this.mapper.excelExportDocument(document, creator, signers);
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
