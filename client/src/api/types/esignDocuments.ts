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

/** 欄位類型：簽名或簽署日期 */
export type EsignFieldType = 'signature' | 'date';

/** 欄位位置；皆為頁面寬高的百分比，x、y 為左上角 */
export interface EsignFieldPlacement {
  type: EsignFieldType;
  /** 第幾頁（從 1 開始，最多 100） */
  page: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  sortOrder: number;
}

/** POST esign/documents：上傳 PDF 並建立草稿（multipart/form-data） */
export interface CreateDocumentBody {
  /** 1～200 字 */
  title: string;
  file: File;
  /** 草稿欄位，一律存成未指派，發起時再指派簽署人 */
  fields?: EsignFieldPlacement[];
}

export type EsignSignerStatus = 'pending' | 'signed' | 'rejected';

export interface EsignSignerView {
  publicId: string;
  type: 'user' | 'email';
  name: string;
  employeeNo: string | null;
  department: string | null;
  title: string | null;
  email: string | null;
  status: EsignSignerStatus;
  signedAt: string | null;
  /** 外部（Email）簽署人的邀請寄送結果；內部簽署人為 null */
  invitationDelivery: 'pending' | 'delivered' | 'failed' | null;
}

export interface EsignFieldView extends EsignFieldPlacement {
  id: string;
  /** 草稿中尚未指派時為 null */
  signerPublicId: string | null;
}

/** GET esign/documents/:id：建立人的文件詳情 */
export interface EsignDocumentDetail extends Omit<EsignDocumentListItem, 'signStartAt' | 'signEndAt' | 'createdBy'> {
  createdBy: { name: string; employeeNo: string } | null;
  sourceFile?: { fileName: string; size: number; pageCount: number; sha256: string };
  signStartAt: string | null;
  signEndAt: string | null;
  stopReason: string | null;
  signers: EsignSignerView[];
  fields: EsignFieldView[];
}

/** 發起簽署的簽署人：內部員工帶後端 userId；外部以 Email 加入 */
export type EsignSignerInput = { type: 'user'; userId: string } | { type: 'email'; name: string; email: string };

/** POST esign/documents/:id/initiations */
export interface InitiateDocumentBody {
  /** 1～50 位 */
  signers: EsignSignerInput[];
  /** 1～200 個；signerIndex 為 signers 陣列的索引，每位簽署人至少要有一個簽名欄位 */
  fields: (EsignFieldPlacement & { signerIndex: number })[];
  /** ISO 8601，開始時間必須早於結束時間 */
  signStartAt: string;
  signEndAt: string;
  /** 下載／匯出的已簽署 PDF 是否加上浮水印 */
  watermark: boolean;
  /** 是否允許簽署人拒絕簽署 */
  allowReject: boolean;
}

/** GET esign/signer-candidates 的一筆資料 */
export interface EsignSignerCandidate {
  /** 後端 userId，發起簽署時使用 */
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  title: string | null;
}
