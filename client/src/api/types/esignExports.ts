// 已簽署副本 ZIP 匯出（server/src/features/esign/services/esign-export.service.ts、dto/export.dto.ts）
import type { EsignSignerStatus } from './esignDocuments';

/**
 * 匯出工作狀態：pending 排隊中；waiting 仍有個人副本產製中，等待完成；processing 打包中；
 * completed 可下載；failed 失敗（可重試）；expired 檔案已過期（需重新產生）
 */
export type EsignExportStatus = 'pending' | 'waiting' | 'processing' | 'completed' | 'failed' | 'expired';

/** 一次 ZIP 匯出工作；範圍固定為受理當下所有已簽署的個人副本 */
export interface EsignExportJob {
  id: string;
  documentId: string;
  status: EsignExportStatus;
  /** 固定匯出範圍的時間 */
  snapshotAt: string | null;
  /** 這次要打包的副本數 */
  expectedCount: number;
  processedCount: number;
  /** 還在產製中的個人副本數 */
  waitingCount: number;
  completedAt: string | null;
  /** 檔案保存期限；過期後需重新產生 */
  expiresAt: string | null;
  failureCode: string | null;
  /** 完成且未過期時才有 */
  files: { id: string; fileName: string; size: number; sha256: string; downloadPath: string }[];
}

/** POST esign/documents/:id/exports 的回應；reused 表示沿用既有的匯出工作 */
export interface EsignExportRequestResult extends EsignExportJob {
  reused: boolean;
}

// ── 歷史匯出紀錄（Spec 015：server/src/features/esign/controllers/export-history.controller.ts） ──

/** excel：簽署紀錄清單 Excel；pdf：單人已簽署文件 PDF；zip：已簽署副本 ZIP */
export type ExportHistoryType = 'excel' | 'pdf' | 'zip';

/** 簽署紀錄 Excel 可匯出的欄位 */
export type ExcelExportField =
  | 'name'
  | 'employeeNo'
  | 'dept'
  | 'title'
  | 'email'
  | 'status'
  | 'signedAt'
  | 'rejectedAt'
  | 'rejectReason';

/** Excel 的匯出條件（重新下載時依此重新產生）；空陣列表示全部 */
export interface ExcelExportConditions {
  statuses: EsignSignerStatus[];
  /** 部門鍵（d: 加 encodeURIComponent(部門名稱)），每個最多 1,400 字、最多 500 個 */
  depts: string[];
  /** 至少一個 */
  fields: ExcelExportField[];
}

interface ExportHistoryItemBase {
  /** 紀錄 id（ZIP 為匯出工作 id） */
  id: string;
  document: { id: string; title: string; docNumber: string };
  /** 員工有 employeeNo、email 為 null；外部簽署人相反 */
  exportedBy: { name: string; employeeNo: string | null; email: string | null };
  exportedAt: string;
  /** 畫面顯示用的範圍說明（超過 255 字會被截斷） */
  scope: string;
  count: number;
}

export interface ExcelExportHistoryItem extends ExportHistoryItemBase {
  type: 'excel';
  conditions: ExcelExportConditions;
}

export interface PdfExportHistoryItem extends ExportHistoryItemBase {
  type: 'pdf';
  signerPublicId: string;
}

export interface ZipExportHistoryItem extends ExportHistoryItemBase, Omit<EsignExportJob, 'id'> {
  type: 'zip';
}

export interface ExportHistoryItemByType {
  excel: ExcelExportHistoryItem;
  pdf: PdfExportHistoryItem;
  zip: ZipExportHistoryItem;
}

/** GET esign/history/export 的查詢參數 */
export interface ExportHistoryParams<T extends ExportHistoryType = ExportHistoryType> {
  type: T;
  page?: number;
  /** 1～100，預設 10 */
  pageSize?: number;
  /** 限定單一文件；同時套用到 typeTotals */
  documentId?: string;
}

/** GET esign/history/export 的回應（頁碼分頁，依匯出時間由新到舊） */
export interface ExportHistoryPage<T extends ExportHistoryType = ExportHistoryType> {
  items: ExportHistoryItemByType[T][];
  page: number;
  pageSize: number;
  /** 目前類型的總筆數 */
  total: number;
  /** 各類型的總筆數（分頁標籤用） */
  typeTotals: Record<ExportHistoryType, number>;
}

/** POST esign/history/export：記錄一次 Excel 匯出（首次匯出與重新下載共用）；匯出人取自 session */
export interface CreateExcelExportRecordBody {
  type: 'excel';
  documentId: string;
  /** trim 後 1～2,000 字 */
  scope: string;
  count: number;
  conditions: ExcelExportConditions;
}

/** GET esign/history/export/:id/document：Excel 重新下載用的文件目前資料（欄位名稱與文件詳情相同） */
export interface ExcelExportDocument {
  id: string;
  title: string;
  docNumber: string;
  signStartAt: string | null;
  signEndAt: string | null;
  originalSignEndAt: string | null;
  isReopened: boolean;
  createdBy: { name: string; employeeNo: string } | null;
  signers: {
    type: 'user' | 'email';
    name: string;
    employeeNo: string | null;
    department: string | null;
    title: string | null;
    email: string | null;
    status: EsignSignerStatus;
    signedAt: string | null;
    rejectedAt: string | null;
    rejectReason: string | null;
  }[];
}
