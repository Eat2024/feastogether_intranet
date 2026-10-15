import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { buildInvitationMail } from './invitation-mail-content';
import type {
  InvitationMailSender,
  SendInvitationMailInput,
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
      auth: user && password ? { user, pass: password } : undefined,
    });
    this.from = config.getOrThrow<string>('SMTP_FROM');
    this.origin = config.getOrThrow<string>('EXTERNAL_SIGNING_ORIGIN');
  }

  async send(input: SendInvitationMailInput): Promise<void> {
    const content = buildInvitationMail(input, this.origin);
    await this.transporter.sendMail({
      from: this.from,
      to: input.recipientEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }
}
