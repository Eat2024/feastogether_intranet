import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { isDeployedEnvironment } from '#app/config/app.environment';
import {
  buildInvitationMail,
  buildOtpMail,
  type InvitationMailContent,
} from './invitation-mail-content';
import type {
  InvitationMailSender,
  SendInvitationMailInput,
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
