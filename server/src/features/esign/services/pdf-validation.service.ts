import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';

export const MAX_PDF_SIZE = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;

export interface ValidatedPdf {
  mimeType: 'application/pdf';
  fileSize: number;
  pageCount: number;
  sha256: string;
}

export interface PdfUpload {
  bytes: Uint8Array;
  originalFileName: string;
  contentType: string;
}

@Injectable()
export class PdfValidationService {
  async validateUpload(input: PdfUpload): Promise<ValidatedPdf> {
    const fileName = basename(input.originalFileName);
    if (
      input.contentType !== 'application/pdf' ||
      extname(fileName).toLowerCase() !== '.pdf'
    ) {
      throw this.invalidPdf('只接受 PDF 檔案');
    }
    return this.validatePersistedPdf(input.bytes);
  }

  async validatePersistedPdf(bytesLike: Uint8Array): Promise<ValidatedPdf> {
    const bytes = Buffer.from(bytesLike);
    if (bytes.byteLength === 0) {
      throw this.invalidPdf('PDF 檔案不可為空');
    }
    if (bytes.byteLength > MAX_PDF_SIZE) {
      throw new AppException(
        AppErrorCode.ESIGN_INVALID_PDF,
        'PDF 檔案不可超過 20 MiB',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw this.invalidPdf('檔案內容不是有效 PDF');
    }

    let document: PDFDocument;
    try {
      document = await PDFDocument.load(bytes, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch (error) {
      if (
        error instanceof EncryptedPDFError ||
        (error instanceof Error &&
          (error.constructor.name === 'EncryptedPDFError' ||
            error.message.toLowerCase().includes('encrypted')))
      ) {
        throw this.invalidPdf('不接受加密 PDF');
      }
      throw this.invalidPdf('PDF 檔案損壞或無法讀取');
    }

    const pageCount = document.getPageCount();
    if (pageCount < 1 || pageCount > MAX_PDF_PAGES) {
      throw this.invalidPdf('PDF 頁數必須介於 1 至 100 頁');
    }

    return {
      mimeType: 'application/pdf',
      fileSize: bytes.byteLength,
      pageCount,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  private invalidPdf(message: string): AppException {
    return new AppException(
      AppErrorCode.ESIGN_INVALID_PDF,
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
