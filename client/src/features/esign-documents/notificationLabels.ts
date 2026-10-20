export const notificationReasons: Record<string, string> = {
  INTERNAL_REMINDER_UNSUPPORTED: '目前只支援外部簽署人催簽',
  SIGNER_ALREADY_COMPLETED: '已簽署或拒簽，不需催簽',
  SIGNING_WINDOW_CLOSED: '目前不在有效簽署期間',
  REMINDER_IN_PROGRESS: '催簽排隊、寄送或重試中',
  REMINDER_DAILY_LIMIT: '今天已催簽，台北時間午夜後可再通知',
  RECIPIENT_UNAVAILABLE: '沒有有效收件入口',
  DELIVERY_OUTCOME_UNKNOWN: '投遞結果未確認，不自動重寄',
  MAIL_DELIVERY_FAILED: '寄送失敗',
  INVITATION_NO_LONGER_ACTIVE: '邀請已失效',
  INVITATION_CREDENTIAL_UNAVAILABLE: '邀請憑證已失效',
};
export const notificationStatuses: Record<string, string> = {
  pending: '排隊中',
  queued: '排隊中',
  processing: '寄送中',
  delivered: '已寄出',
  failed: '寄送失敗',
  skipped: '未寄出',
  unknown: '投遞結果未確認',
  completed: '處理完成',
  partial_failed: '部分寄送失敗',
};
export const notificationTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '—';
