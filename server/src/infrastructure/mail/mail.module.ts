import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeInvitationMailSender } from './fake-invitation-mail-sender.service';
import { INVITATION_MAIL_SENDER } from './invitation-mail-sender.port';
import { SesInvitationMailSender } from './ses-invitation-mail-sender.service';
import { SmtpInvitationMailSender } from './smtp-invitation-mail-sender.service';

export function createInvitationMailSender(config: ConfigService) {
  const driver = config.get<string>('ESIGN_MAIL_DRIVER');
  if (driver === 'fake') return new FakeInvitationMailSender();
  if (driver === 'smtp') return new SmtpInvitationMailSender(config);
  if (driver === 'ses') return new SesInvitationMailSender(config);
  throw new Error('ESIGN_MAIL_DRIVER 必須是 fake、smtp 或 ses');
}

@Module({
  providers: [
    {
      provide: INVITATION_MAIL_SENDER,
      inject: [ConfigService],
      useFactory: createInvitationMailSender,
    },
  ],
  exports: [INVITATION_MAIL_SENDER],
})
export class MailModule {}
