export const INVITATION_MAIL_SENDER = Symbol('INVITATION_MAIL_SENDER');

export interface SendInvitationMailInput {
  kind?: 'invitation' | 'reminder';
  recipientEmail: string;
  documentTitle: string;
  creatorName: string;
  signEndAt: Date;
  invitationToken: string;
}

/** 外部簽署人開啟文件前的驗證碼信（Spec 008 FR-029）：不含邀請連結。 */
export interface SendOtpMailInput {
  recipientEmail: string;
  documentTitle: string;
  code: string;
  /** 驗證碼自寄出起的有效分鐘數 */
  validMinutes: number;
}

export interface InvitationMailSender {
  send(input: SendInvitationMailInput): Promise<void>;
  sendOtp(input: SendOtpMailInput): Promise<void>;
}
