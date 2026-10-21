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
  /** 拒絕簽署的時間與原因（原因選填，未填為空字串）；只有 status 為 rejected 時有值 */
  rejectedAt: string | null;
  rejectReason: string | null;
  /** 個人簽署副本的產製狀態；尚未簽署時 status 為 null */
  completion: { status: 'pending' | 'processing' | 'ready' | 'failed' | null; readyAt: string | null };
  /** 外部（Email）簽署人的邀請寄送結果；內部簽署人為 null */
  invitationDelivery: 'pending' | 'delivered' | 'failed' | null;
  /** 簽章公開驗證網址；只有 status 為 signed 時有值 */
  verificationUrl: string | null;
}

/** 一次通知（初次邀請或催簽）的寄送結果；status 見 notificationLabels.ts */
export interface EsignNotificationOutcome {
  status: string;
  completedAt: string | null;
  reasonCode: string | null;
}

/** 建立人檢視的簽署人：多了只給建立人看的管理備註與通知紀錄 */
export interface EsignManagedSignerView extends EsignSignerView {
  /** 管理備註（最多 30 字）；沒有時為空字串，不提供給簽署人本人 */
  note: string;
  /** 最近一次初次邀請、催簽的結果；內部簽署人或沒有紀錄時為 null */
  latestInvitation: EsignNotificationOutcome | null;
  latestReminder: EsignNotificationOutcome | null;
  /** 已寄出的催簽次數 */
  deliveredReminderCount: number;
  /** 目前能否催簽：只有外部簽署人、待簽署、在簽署期間內，且每人每日一次（台北時間） */
  reminderEligibility: {
    eligible: boolean;
    /** 不能催簽的原因代碼；可以催簽時為 null */
    reasonCode: string | null;
    /** 達到每日上限時，下一次可催簽的時間 */
    nextEligibleAt: string | null;
  };
}

/** 共用欄位：屬於文件、不屬於特定簽署人 */
export interface EsignFieldView extends EsignFieldPlacement {
  id: string;
}

/** GET esign/documents/:id：建立人的文件詳情 */
export interface EsignDocumentDetail extends Omit<EsignDocumentListItem, 'signStartAt' | 'signEndAt' | 'createdBy'> {
  createdBy: { name: string; employeeNo: string } | null;
  sourceFile?: { fileName: string; size: number; pageCount: number; sha256: string };
  signStartAt: string | null;
  signEndAt: string | null;
  /** 浮水印、允許拒簽：草稿為暫存的設定，發起後為發起時的設定 */
  watermark: boolean;
  allowReject: boolean;
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
  /** 下載／匯出的個人簽署副本（PDF）每一頁加上浮水印 */
  watermark: boolean;
  /** 簽署人可以拒絕簽署 */
  allowReject: boolean;
}

/**
 * PATCH esign/documents/:id/draft-settings：暫存草稿設定，不發起、不寄送邀請。
 * 各欄皆可省略（省略的保留原值）；期間傳 null 表示清空。
 */
export interface DraftSettingsBody {
  /** 整批取代簽署人，至少 1 位 */
  signers?: EsignSignerInput[];
  /** ISO 8601（含時區） */
  signStartAt?: string | null;
  signEndAt?: string | null;
  watermark?: boolean;
  allowReject?: boolean;
}

/** POST esign/documents/:id/reopenings：已到期且仍有人未簽署時，設定新的截止時間重新開放補簽 */
export interface ReopenDocumentBody {
  id: string;
  /** 畫面上看到的目前截止時間；與後端不一致（已被他人變更）時回 409 */
  expectedSignEndAt: string;
  /** 新的截止時間，須晚於現在與目前截止時間；補簽不修改原開始時間 */
  signEndAt: string;
  /** 去除首尾空白後 1～500 字 */
  reason: string;
}

export interface ReopenDocumentResult {
  documentId: string;
  status: 'active';
  originalSignEndAt: string;
  signEndAt: string;
  isReopened: true;
  reopenedAt: string;
  /** 重新開放的待簽署人數 */
  pendingCount: number;
}

/** GET esign/documents/:id/reopening-invitations：補簽後外部待簽署人的新邀請連結（不寄信，連結即憑證，勿記錄或外流） */
export interface ReopeningInvitation {
  signerPublicId: string;
  invitationUrl: string;
  expiresAt: string;
}

/** POST esign/documents/:id/notification-batches：建立外部催簽批次（只受理，由後端背景寄送） */
export interface CreateNotificationBatchBody {
  /** UUID v4；同一批重送時沿用，後端依此判斷重複送出 */
  requestId: string;
  /** selected：指定的簽署人；all_pending：所有待簽署的外部簽署人 */
  selection: 'selected' | 'all_pending';
  /** selection 為 selected 時必填 */
  signerPublicIds?: string[];
}

/** 催簽批次的摘要 */
export interface EsignNotificationBatchSummary {
  batchId: string;
  kind: 'invitation' | 'reminder';
  status: 'queued' | 'processing' | 'completed' | 'partial_failed' | 'failed' | 'unknown';
  requestedBy: { userId: string; name: string } | null;
  selectedCount: number;
  /** 受理寄送的人數 */
  queuedCount: number;
  /** 不符合條件、未寄出的人數 */
  notSentCount: number;
  createdAt: string;
}

/** 催簽批次的逐人結果（分頁） */
export interface EsignNotificationBatch extends EsignNotificationBatchSummary {
  items: {
    signerPublicId: string;
    name: string;
    status: string;
    reasonCode: string | null;
    attemptCount: number;
    completedAt: string | null;
    attemptHistory: { status: string; at: string; reasonCode: string | null }[];
  }[];
  nextCursor: string | null;
}

export interface NotificationPageParams {
  cursor?: string;
  /** 1～100，預設 20 */
  limit?: number;
}

export interface NotificationListParams extends NotificationPageParams {
  kind?: 'invitation' | 'reminder';
}

export interface EsignNotificationBatchList {
  items: EsignNotificationBatchSummary[];
  nextCursor: string | null;
}

/** PATCH esign/documents/:id/signers/:signerPublicId/note：空字串表示清除備註 */
export interface SaveSignerNoteBody {
  id: string;
  signerPublicId: string;
  note: string;
}

export interface SignerNoteResult {
  signerPublicId: string;
  note: string;
}

/** GET esign/documents/:id/history 的一筆事件（依發生時間由舊到新） */
export interface EsignHistoryItem {
  /** 事件類型，例如 document.initiated、signature.completed、document.stopped_by_creator */
  type: string;
  occurredAt: string;
  /** 操作者：簽署人、員工（建立人）或系統；同名簽署人以 signerPublicId 區分 */
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

/** GET esign/signer-candidates/org-chart 的一位員工（格式沿用饗賓人 API） */
export interface EsignOrgEmployee {
  /** 員工編號 */
  person_empid: string;
  person_name: string | null;
  title: string | null;
}

/** GET esign/signer-candidates/org-chart 的一個部門（正式員工組織架構，格式沿用饗賓人 API） */
export interface EsignOrgDepartment {
  department_ch_id: string;
  department_name: string;
  department_parent_guid: string | null;
  startdate: string | null;
  /** 後端只回傳未停用的部門 */
  stopdate: null;
  children: EsignOrgDepartment[];
  employees: EsignOrgEmployee[];
}

/** POST esign/signer-candidates/resolutions 的一筆結果 */
export interface EsignSignerResolution {
  employeeNo: string;
  /** resolved 時為後端 userId，發起簽署時使用 */
  userId: string | null;
  name: string | null;
  department: string | null;
  title: string | null;
  /** unavailable：查無此人，或不是試用／正式員工 */
  status: 'resolved' | 'unavailable';
}
