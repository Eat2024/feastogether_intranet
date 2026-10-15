export const INVITATION_MAIL_SENDER = Symbol('INVITATION_MAIL_SENDER');

export interface SendInvitationMailInput {
  recipientEmail: string;
  documentTitle: string;
  creatorName: string;
  signEndAt: Date;
  invitationToken: string;
}

export interface InvitationMailSender {
  send(input: SendInvitationMailInput): Promise<void>;
}
