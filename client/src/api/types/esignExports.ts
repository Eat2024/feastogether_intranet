// 已簽署副本 ZIP 匯出（server/src/features/esign/services/esign-export.service.ts、dto/export.dto.ts）

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

/** GET esign/exports 的查詢參數 */
export interface ExportHistoryParams {
  documentId?: string;
  cursor?: string;
  /** 1～100，預設 50 */
  limit?: number;
}

/** GET esign/exports 的一筆匯出紀錄 */
export interface EsignExportHistoryItem extends EsignExportJob {
  /** 申請匯出的員工姓名 */
  requesterName: string;
  /**
   * 文件名稱與文件編號。
   * TODO: 後端補上後改為必填；補上前畫面以文件 id 代替
   */
  documentTitle?: string;
  docNumber?: string;
}

export interface EsignExportHistory {
  items: EsignExportHistoryItem[];
  nextCursor: string | null;
}
