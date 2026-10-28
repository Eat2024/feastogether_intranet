// 通知（初次邀請、催簽）的狀態與原因代碼對照的中文說明；未列出的代碼顯示預設文字
import { formatDateTime } from './listQuery';

/** 不能催簽或寄送未完成的原因（server/src/features/esign/services/esign-reminder-policy.ts 等） */
export const NOTIFICATION_REASONS: Record<string, string> = {
  SIGNER_ALREADY_COMPLETED: '已簽署或已拒絕，不需催簽',
  SIGNING_WINDOW_CLOSED: '目前不在簽署期間內',
  REMINDER_IN_PROGRESS: '催簽排隊、寄送或重試中',
  REMINDER_DAILY_LIMIT: '今天已催簽過，每人每日一次（台北時間午夜後可再通知）',
  RECIPIENT_UNAVAILABLE: '沒有有效的收件信箱；內部員工請由人資通知自行登入入口網簽署',
  RECIPIENT_ALREADY_NOTIFIED: '同批次共用信箱已通知，不重複寄送',
  DELIVERY_OUTCOME_UNKNOWN: '寄送結果未確認，不會自動重寄',
  MAIL_DELIVERY_FAILED: '寄送失敗',
  INVITATION_NO_LONGER_ACTIVE: '邀請已失效',
  INVITATION_CREDENTIAL_UNAVAILABLE: '邀請憑證已失效',
};

export const notificationReason = (code: string | null | undefined, fallback = '目前無法催簽') =>
  (code && NOTIFICATION_REASONS[code]) || fallback;

/** 通知批次與逐人結果的狀態 */
export const NOTIFICATION_STATUSES: Record<string, string> = {
  pending: '排隊中',
  queued: '排隊中',
  processing: '寄送中',
  delivered: '已寄出',
  failed: '寄送失敗',
  skipped: '未寄出',
  unknown: '寄送結果未確認',
  completed: '處理完成',
  partial_failed: '部分寄送失敗',
};

export const notificationStatus = (status: string) => NOTIFICATION_STATUSES[status] ?? status;

export const notificationTime = (iso: string | null) => formatDateTime(iso) ?? '—';
