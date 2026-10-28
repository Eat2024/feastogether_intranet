import type { FastifyReply } from 'fastify';
import type { PersonalCopyFile } from '../services/esign-completion-access.service';

/**
 * 以附件送出已簽署副本。Cache-Control 與 nosniff 由路由的 @Header 設定，
 * 錯誤回應也會帶上。
 */
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
