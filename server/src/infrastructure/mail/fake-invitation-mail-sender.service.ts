import { Injectable } from '@nestjs/common';
import type {
  InvitationMailSender,
  SendInvitationMailInput,
} from './invitation-mail-sender.port';

/** 僅供 test environment 注入；不寫 log、不模擬 production fallback。 */
@Injectable()
export class FakeInvitationMailSender implements InvitationMailSender {
  readonly deliveries: SendInvitationMailInput[] = [];

  send(input: SendInvitationMailInput): Promise<void> {
    this.deliveries.push({ ...input });
    return Promise.resolve();
  }
}
