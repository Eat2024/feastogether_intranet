// 電子簽文件（server/src/features/esign/dto/esign-common.dto.ts、document-query.dto.ts）

/** 後端文件狀態；finalizing 為所有人已簽署、系統正在產生完成檔 */
export type EsignDocumentStatus = 'draft' | 'active' | 'finalizing' | 'completed' | 'stopped';

/** GET esign/documents 的查詢參數（皆選填） */
export interface GetDocumentsParams {
  /** created：我建立的；assigned：指派給我簽署的；不帶為兩者合併 */
  role?: 'created' | 'assigned';
  status?: EsignDocumentStatus;
}

/** 文件列表的一筆資料；時間皆為 ISO 8601 */
export interface EsignDocumentListItem {
  id: string;
  docNumber: string;
  title: string;
  status: EsignDocumentStatus;
  createdAt: string;
  initiatedAt: string | null;
  completedAt: string | null;
  stoppedAt: string | null;
  /** 尚未簽署人數 */
  pendingCount: number;
  /** 已簽署人數 */
  signedCount: number;
  signStartAt: string | null;
  signEndAt: string | null;
  /** 建立人帳號不存在時為 null */
  createdBy: { name: string; employeeNo: string } | null;
}
