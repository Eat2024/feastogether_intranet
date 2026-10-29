import {
  applyDecorators,
  Header,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import type { PersonalCopyFile } from '../services/esign-completion-access.service';

/**
 * 已簽署副本下載路由的共同設定：同源 POST、200 PDF 附件、不快取與 nosniff。
 * 標頭以 @Header 設定，錯誤回應也會帶上。
 */
export function CompletedPdfDownload() {
  return applyDecorators(
    UseGuards(OriginGuard),
    ApiProduces('application/pdf'),
    ApiOkResponse({
      description: '已簽署副本 PDF（附件）',
      schema: { type: 'string', format: 'binary' },
    }),
    HttpCode(HttpStatus.OK),
    Header('Cache-Control', 'private, no-store'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

/** 以附件送出已簽署副本；路由需套用 CompletedPdfDownload。 */
export function sendCompletedPdf(
  reply: FastifyReply,
  file: PersonalCopyFile,
): void {
  reply
    .type('application/pdf')
    .header(
      'Content-Disposition',
      `attachment; filename="completed.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    )
    .send(file.bytes);
}
