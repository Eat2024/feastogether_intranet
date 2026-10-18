import { AppErrors } from '#app/common/errors/app-errors';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { Injectable } from '@nestjs/common';
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
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
      throw new AppException(...AppErrors.ESIGN_PDF_ONLY);
    }
    return this.validatePersistedPdf(input.bytes);
  }

  async validatePersistedPdf(bytesLike: Uint8Array): Promise<ValidatedPdf> {
    const bytes = Buffer.from(bytesLike);
    if (bytes.byteLength === 0) {
      throw new AppException(...AppErrors.ESIGN_PDF_EMPTY);
    }
    if (bytes.byteLength > MAX_PDF_SIZE) {
      throw new AppException(...AppErrors.ESIGN_PDF_TOO_LARGE);
    }
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new AppException(...AppErrors.ESIGN_PDF_CONTENT_INVALID);
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
        throw new AppException(...AppErrors.ESIGN_PDF_ENCRYPTED);
      }
      throw new AppException(...AppErrors.ESIGN_PDF_UNREADABLE);
    }

    const pageCount = document.getPageCount();
    if (pageCount < 1 || pageCount > MAX_PDF_PAGES) {
      throw new AppException(...AppErrors.ESIGN_PDF_PAGE_COUNT_INVALID);
    }

    return {
      mimeType: 'application/pdf',
      fileSize: bytes.byteLength,
      pageCount,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
}
