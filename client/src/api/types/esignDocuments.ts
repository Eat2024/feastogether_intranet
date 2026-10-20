// 電子簽文件（server/src/features/esign/dto/esign-common.dto.ts、document-query.dto.ts）

/**
 * 後端文件狀態：finalizing 為所有人已簽署、系統正在產生完成檔；
 * expired 為超過簽署期限仍有人未簽署（後端即時計算，可補簽重新開放）
 */
export type EsignDocumentStatus = 'draft' | 'active' | 'expired' | 'finalizing' | 'completed' | 'stopped';

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
  /** 目前的簽署截止時間；補簽後為補簽的新期限 */
  signEndAt: string | null;
  /** 發起時設定的截止時間（草稿為 null） */
  originalSignEndAt: string | null;
  /** 是否補簽過（signEndAt 與 originalSignEndAt 不同） */
  isReopened: boolean;
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

/** PATCH esign/documents/:id：修改草稿（multipart/form-data），至少要有一項 */
export interface UpdateDocumentBody {
  id: string;
  title?: string;
  /** 換新的 PDF；換 PDF 時會清除舊欄位，需一併傳入 fields */
  file?: File;
  /** 整批取代共用欄位（空陣列表示清除所有欄位） */
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
  rejectedAt: string | null;
  rejectReason: string | null;
  /** 個人簽署副本的產製狀態；尚未簽署時 status 為 null */
  completion: {
    status: 'pending' | 'processing' | 'ready' | 'failed' | null;
    readyAt: string | null;
  };
  /** 外部（Email）簽署人的邀請寄送結果；內部簽署人為 null */
  invitationDelivery: 'pending' | 'delivered' | 'failed' | null;
  /** 簽章公開驗證網址；只有 status 為 signed 時有值 */
  verificationUrl: string | null;
}

/** 僅建立人管理頁可見，不用於本人簽署任務。 */
export interface EsignManagedSignerView extends EsignSignerView {
  note: string;
  reminderEligibility?: {
    eligible: boolean;
    reasonCode: string | null;
    nextEligibleAt: string | null;
  };
  latestInvitation?: {
    status: string;
    reasonCode: string | null;
    completedAt: string | null;
  } | null;
  latestReminder?: {
    status: string;
    reasonCode: string | null;
    completedAt: string | null;
  } | null;
  deliveredReminderCount?: number;
}

export interface SaveSignerNoteBody {
  id: string;
  signerPublicId: string;
  note: string;
}
export interface SignerNoteResult {
  signerPublicId: string;
  note: string;
}

/** 共用欄位：屬於文件、不屬於特定簽署人 */
export interface EsignFieldView extends EsignFieldPlacement {
  id: string;
}

/** GET esign/documents/:id：建立人的文件詳情 */
export interface EsignDocumentDetail extends Omit<EsignDocumentListItem, 'signStartAt' | 'signEndAt' | 'createdBy'> {
  watermark: boolean;
  allowReject: boolean;
  createdBy: { name: string; employeeNo: string } | null;
  sourceFile?: {
    fileName: string;
    size: number;
    pageCount: number;
    sha256: string;
  };
  signStartAt: string | null;
  signEndAt: string | null;
  stopReason: string | null;
  signers: EsignManagedSignerView[];
  fields: EsignFieldView[];
}

/** 發起簽署的簽署人：內部員工帶後端 userId；外部以 Email 加入 */
export type EsignSignerInput = { type: 'user'; userId: string } | { type: 'email'; name: string; email: string };

/** POST esign/documents/:id/initiations */
export interface InitiateDocumentBody {
  /** 至少 1 位 */
  signers: EsignSignerInput[];
  /** 共用欄位 1～200 個，至少要有一個簽名欄位；後端會替每位簽署人各產生一份個人副本 */
  fields: EsignFieldPlacement[];
  /** ISO 8601，開始時間必須早於結束時間 */
  signStartAt: string;
  signEndAt: string;
  /** 依文件選項繪製浮水印 */
  watermark: boolean;
  /** 開放拒絕簽署 */
  allowReject: boolean;
}

/** GET esign/documents/:id/history 的一筆事件（依發生時間由舊到新） */
export interface EsignHistoryItem {
  /** 事件類型，例如 document.initiated、signature.completed、document.stopped_by_creator */
  type: string;
  occurredAt: string;
  /** 依事件辨識動作者；系統事件不以工作對象冒充本人。 */
  actor: {
    kind: 'signer' | 'employee' | 'system';
    name: string;
    signerPublicId?: string;
  };
  /** 停止簽署等事件的原因 */
  reason: string | null;
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

/** 未傳欄位保留；日期 null 清空，允許單端日期。 */
export interface DraftSettingsBody {
  signers?: EsignSignerInput[];
  signStartAt?: string | null;
  signEndAt?: string | null;
  watermark?: boolean;
  allowReject?: boolean;
}

/** 催簽受理不是已送達；SMTP 接受後才顯示已寄出。 */
export interface EsignNotificationBatch {
  batchId: string;
  kind: 'invitation' | 'reminder';
  status: 'queued' | 'processing' | 'completed' | 'partial_failed' | 'failed' | 'unknown';
  requestedBy: { userId: string; name: string } | null;
  nextCursor: string | null;
  selectedCount: number;
  queuedCount: number;
  notSentCount: number;
  createdAt: string;
  items: Array<{
    signerPublicId: string;
    name: string;
    status: string;
    reasonCode: string | null;
    attemptCount: number;
    completedAt: string | null;
    attemptHistory: Array<{
      status: string;
      at: string;
      reasonCode: string | null;
    }>;
  }>;
}

export interface NotificationPageParams {
  cursor?: string;
  limit?: number;
}
export interface NotificationListParams extends NotificationPageParams {
  kind?: 'invitation' | 'reminder';
}
export interface EsignNotificationBatchList {
  items: Omit<EsignNotificationBatch, 'items' | 'nextCursor'>[];
  nextCursor: string | null;
}
