import { AppErrors } from '#app/common/errors/app-errors';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppException } from '#app/common/errors/app.exception';

export interface DocumentUpload {
  fields: Record<string, string>;
  file?: { bytes: Buffer; originalFileName: string; contentType: string };
}

/** multipart 允許的文字欄位；fields 為 JSON 字串，由 DTO 解析與驗證。 */
const TEXT_FIELDS = new Set(['title', 'fields']);

/** 僅供電子簽草稿上傳：解析 file/title/fields，不建立資料、不驗證 PDF 業務內容。 */
@Injectable()
export class DocumentUploadInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    request.body = await this.readMultipart(request);
    return next.handle();
  }

  private async readMultipart(
    request: FastifyRequest,
  ): Promise<DocumentUpload> {
    const fields: Record<string, string> = {};
    let file:
      | { bytes: Buffer; originalFileName: string; contentType: string }
      | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') {
          await part.toBuffer();
          throw new AppException(
            ...AppErrors.ESIGN_UPLOAD_FIELD_UNSUPPORTED(part.fieldname),
          );
        }
        if (file)
          throw new AppException(...AppErrors.ESIGN_SINGLE_UPLOAD_REQUIRED);
        file = {
          bytes: await part.toBuffer(),
          originalFileName: part.filename,
          contentType: part.mimetype,
        };
      } else if (typeof part.value === 'string') {
        if (!TEXT_FIELDS.has(part.fieldname)) {
          throw new AppException(
            ...AppErrors.ESIGN_UPLOAD_FIELD_UNSUPPORTED(part.fieldname),
          );
        }
        fields[part.fieldname] = part.value;
      }
    }
    return { fields, file };
  }
}
