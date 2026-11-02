import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { FeastogetherModule } from '#app/infrastructure/http-client/feastogether/feastogether.module';
import { FakeInvitationMailSender } from './fake-invitation-mail-sender.service';
import { INVITATION_MAIL_SENDER } from './invitation-mail-sender.port';
import { SmtpInvitationMailSender } from './smtp-invitation-mail-sender.service';
import { GuardedInvitationMailSender } from './guarded-invitation-mail-sender.service';
import { MailRecipientPolicyService } from './mail-recipient-policy.service';

export function createInvitationMailSender(
  config: ConfigService,
  policy: MailRecipientPolicyService,
) {
  const driver = config.get<string>('ESIGN_MAIL_DRIVER');
  if (driver !== 'fake' && driver !== 'smtp')
    throw new Error('ESIGN_MAIL_DRIVER 必須是 fake 或 smtp');
  const adapter =
    driver === 'fake'
      ? new FakeInvitationMailSender()
      : new SmtpInvitationMailSender(config);
  return new GuardedInvitationMailSender(config, policy, adapter);
}

@Module({
  imports: [MysqlModule, FeastogetherModule],
  providers: [
    MailRecipientPolicyService,
    {
      provide: INVITATION_MAIL_SENDER,
      inject: [ConfigService, MailRecipientPolicyService],
      useFactory: createInvitationMailSender,
    },
  ],
  exports: [INVITATION_MAIL_SENDER],
})
export class MailModule {}
