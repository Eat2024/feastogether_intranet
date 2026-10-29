import { Injectable } from '@nestjs/common';
import type {
  InvitationMailSender,
  SendInvitationMailInput,
  SendInternalGroupMailInput,
  InternalMailRecipientResult,
  SendOtpMailInput,
} from './invitation-mail-sender.port';

/** 僅供 test environment 注入；不寫 log、不模擬 production fallback。 */
@Injectable()
export class FakeInvitationMailSender implements InvitationMailSender {
  readonly internalGroupDeliveries: SendInternalGroupMailInput[] = [];
  readonly deliveries: SendInvitationMailInput[] = [];
  readonly otpDeliveries: SendOtpMailInput[] = [];

  sendInternalGroup(
    input: SendInternalGroupMailInput,
  ): Promise<InternalMailRecipientResult[]> {
    this.internalGroupDeliveries.push({
      ...input,
      recipientEmails: [...input.recipientEmails],
    });
    return Promise.resolve(
      input.recipientEmails.map((recipientEmail) => ({
        recipientEmail,
        status: 'accepted',
        retryable: false,
      })),
    );
  }

  send(input: SendInvitationMailInput): Promise<void> {
    this.deliveries.push({ ...input });
    return Promise.resolve();
  }

  sendOtp(input: SendOtpMailInput): Promise<void> {
    this.otpDeliveries.push({ ...input });
    return Promise.resolve();
  }
}
