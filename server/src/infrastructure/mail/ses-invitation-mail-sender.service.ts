import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { buildInvitationMail } from './invitation-mail-content';
import type {
  InvitationMailSender,
  SendInvitationMailInput,
} from './invitation-mail-sender.port';

@Injectable()
export class SesInvitationMailSender implements InvitationMailSender {
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly origin: string;

  constructor(config: ConfigService) {
    const sesClient = new SESv2Client({
      region: config.getOrThrow<string>('AWS_REGION'),
    });
    this.transporter = nodemailer.createTransport({
      SES: { sesClient, SendEmailCommand },
    });
    this.from = config.getOrThrow<string>('SES_FROM');
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
