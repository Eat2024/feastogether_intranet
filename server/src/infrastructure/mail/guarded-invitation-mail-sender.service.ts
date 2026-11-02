import { isEmail } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { MailRecipientPolicyService } from './mail-recipient-policy.service';
import {
  MailRecipientBlockedError,
  MailWhitelistCheckFailedError,
} from './mail-recipient-policy.errors';
import type {
  InvitationMailSender,
  SendInvitationMailInput,
  SendOtpMailInput,
  SendInternalGroupMailInput,
  InternalMailRecipientResult,
} from './invitation-mail-sender.port';

/** HTTP 與 worker 共用的唯一公開寄送入口，底層 adapter 不另行公開。 */
export class GuardedInvitationMailSender implements InvitationMailSender {
  constructor(
    private readonly config: ConfigService,
    private readonly policy: MailRecipientPolicyService,
    private readonly adapter: InvitationMailSender,
  ) {}

  async send(input: SendInvitationMailInput): Promise<void> {
    const recipientEmail = await this.assertAllowed(input.recipientEmail);
    await this.adapter.send({ ...input, recipientEmail });
  }

  async sendOtp(input: SendOtpMailInput): Promise<void> {
    const recipientEmail = await this.assertAllowed(input.recipientEmail);
    await this.adapter.sendOtp({ ...input, recipientEmail });
  }

  async sendInternalGroup(
    input: SendInternalGroupMailInput,
  ): Promise<InternalMailRecipientResult[]> {
    const emails = [
      ...new Set(
        input.recipientEmails.map((email) => email.trim().toLowerCase()),
      ),
    ];
    let allowed: Set<string>;
    try {
      if (this.isProduction()) return this.adapter.sendInternalGroup(input);
      const valid = input.recipientEmails
        .map(normalizeRecipient)
        .filter((email): email is string => email !== null);
      allowed = await this.policy.allowedRecipients([...new Set(valid)]);
    } catch {
      return emails.map((recipientEmail) => ({
        recipientEmail,
        status: 'check-failed',
        reasonCode: 'MAIL_WHITELIST_CHECK_FAILED',
        retryable: true,
      }));
    }
    const recipients = emails.filter((email) => allowed.has(email));
    const results = recipients.length
      ? await this.adapter.sendInternalGroup({
          ...input,
          recipientEmails: recipients,
        })
      : [];
    return emails.map((recipientEmail) => {
      if (!allowed.has(recipientEmail))
        return {
          recipientEmail,
          status: 'blocked',
          reasonCode: 'MAIL_RECIPIENT_NOT_WHITELISTED',
          retryable: false,
        };
      const matches = results.filter(
        (result) => result.recipientEmail === recipientEmail,
      );
      return matches.length === 1
        ? matches[0]
        : { recipientEmail, status: 'unknown', retryable: false };
    });
  }

  private isProduction(): boolean {
    const environment = this.config.get<string>('NODE_ENV');
    if (environment === 'production') return true;
    if (!['development', 'test', 'staging'].includes(environment ?? ''))
      throw new MailWhitelistCheckFailedError();
    return false;
  }

  private async assertAllowed(email: string): Promise<string> {
    if (this.isProduction()) return email;
    const normalized = normalizeRecipient(email);
    if (
      !normalized ||
      !(await this.policy.allowedRecipients([normalized])).has(normalized)
    )
      throw new MailRecipientBlockedError();
    return normalized;
  }
}

function normalizeRecipient(email: string): string | null {
  const value = email.trim().toLowerCase();
  return value.length <= 255 && !/[\r\n]/.test(email) && isEmail(value)
    ? value
    : null;
}
