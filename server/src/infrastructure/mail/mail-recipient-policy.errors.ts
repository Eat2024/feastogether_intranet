/** 寄送資格錯誤只保留穩定分類，不攜帶地址、規則或上游回應。 */
export class MailRecipientBlockedError extends Error {
  readonly reasonCode = 'MAIL_RECIPIENT_NOT_WHITELISTED';
  readonly retryable = false;
  constructor() {
    super('非正式環境白名單未允許寄送');
    this.name = 'MailRecipientBlockedError';
  }
}

export class MailWhitelistCheckFailedError extends Error {
  readonly reasonCode = 'MAIL_WHITELIST_CHECK_FAILED';
  readonly retryable = true;
  constructor() {
    super('寄送白名單檢查失敗');
    this.name = 'MailWhitelistCheckFailedError';
  }
}
