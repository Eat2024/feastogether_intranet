import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppErrorCode } from '#app/common/errors/app-error-code';
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
          throw this.invalid(`不支援的欄位：${part.fieldname}`);
        }
        if (file) throw this.invalid('一次只能上傳一個檔案');
        file = {
          bytes: await part.toBuffer(),
          originalFileName: part.filename,
          contentType: part.mimetype,
        };
      } else if (typeof part.value === 'string') {
        if (!TEXT_FIELDS.has(part.fieldname)) {
          throw this.invalid(`不支援的欄位：${part.fieldname}`);
        }
        fields[part.fieldname] = part.value;
      }
    }
    return { fields, file };
  }

  private invalid(message: string): AppException {
    return new AppException(
      AppErrorCode.INVALID_REQUEST,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
