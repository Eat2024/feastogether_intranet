import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { isDeployedEnvironment } from '#app/config/app.environment';
import {
  buildInvitationMail,
  buildInternalGroupMail,
  buildOtpMail,
  type InvitationMailContent,
} from './invitation-mail-content';
import type {
  InvitationMailSender,
  SendInvitationMailInput,
  SendInternalGroupMailInput,
  InternalMailRecipientResult,
  SendOtpMailInput,
} from './invitation-mail-sender.port';

@Injectable()
export class SmtpInvitationMailSender implements InvitationMailSender {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly origin: string;

  constructor(config: ConfigService) {
    const user = config.get<string>('SMTP_USER');
    const password = config.get<string>('SMTP_PASSWORD');
    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: config.getOrThrow<number>('SMTP_PORT'),
      secure: config.getOrThrow<string>('SMTP_SECURE') === 'true',
      // 部署環境未用直接 TLS 時必須升級 STARTTLS，無法加密就不寄出（不送明文帳密）
      requireTLS: isDeployedEnvironment(config.get<string>('NODE_ENV')),
      auth: user && password ? { user, pass: password } : undefined,
    });
    this.from = config.getOrThrow<string>('SMTP_FROM');
    this.origin = config.getOrThrow<string>('EXTERNAL_SIGNING_ORIGIN');
  }

  async send(input: SendInvitationMailInput): Promise<void> {
    await this.deliver(
      input.recipientEmail,
      buildInvitationMail(input, this.origin),
    );
  }

  async sendOtp(input: SendOtpMailInput): Promise<void> {
    await this.deliver(input.recipientEmail, buildOtpMail(input));
  }

  async sendInternalGroup(
    input: SendInternalGroupMailInput,
  ): Promise<InternalMailRecipientResult[]> {
    // 不使用 keepBcc，也不另加寄件人至 envelope；實際 MIME 由 Nodemailer 移除 BCC。
    try {
      const info: unknown = await this.transporter.sendMail({
        from: this.from,
        bcc: input.recipientEmails,
        ...buildInternalGroupMail(input),
      });
      return input.recipientEmails.map((recipientEmail) => {
        const accepted = addresses(info, 'accepted').includes(recipientEmail);
        const rejected = addresses(info, 'rejected').includes(recipientEmail);
        if (accepted && !rejected)
          return { recipientEmail, status: 'accepted', retryable: false };
        if (rejected && !accepted) {
          const errors = value(info, 'rejectedErrors');
          const error = Array.isArray(errors)
            ? errors.find((item) => value(item, 'recipient') === recipientEmail)
            : undefined;
          return {
            recipientEmail,
            status: 'rejected',
            retryable: temporaryFailure(error),
          };
        }
        return { recipientEmail, status: 'unknown', retryable: false };
      });
    } catch (error) {
      // Nodemailer 10 的 _onClose 在 DATA 後也會回 ECONNECTION／CONN；
      // 不能用錯誤碼或 command 推論尚未寄送，沒有明確拒收回應就維持 unknown。
      const code = value(error, 'responseCode');
      const definitelyUnsent =
        (typeof code === 'number' && code >= 400 && code < 600) ||
        ['EAUTH', 'EDNS'].includes(String(value(error, 'code')));
      return input.recipientEmails.map((recipientEmail) => {
        const errors = value(error, 'rejectedErrors');
        const recipientError = Array.isArray(errors)
          ? errors.find((item) => value(item, 'recipient') === recipientEmail)
          : undefined;
        return {
          recipientEmail,
          status: definitelyUnsent || recipientError ? 'rejected' : 'unknown',
          retryable:
            (definitelyUnsent || !!recipientError) &&
            temporaryFailure(recipientError ?? error),
        };
      });
    }
  }

  private async deliver(
    to: string,
    content: InvitationMailContent,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }
}

function value(object: unknown, key: string): unknown {
  return typeof object === 'object' && object !== null
    ? Reflect.get(object, key)
    : undefined;
}

function addresses(info: unknown, key: string): string[] {
  const items = value(info, key);
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown) => {
    const address = typeof item === 'string' ? item : value(item, 'address');
    return typeof address === 'string' ? [address.trim().toLowerCase()] : [];
  });
}

function temporaryFailure(error: unknown): boolean {
  const code = value(error, 'responseCode');
  if (typeof code === 'number') return code >= 400 && code < 500;
  return value(error, 'code') === 'EDNS';
}
