import { AppErrors } from '#app/common/errors/app-errors';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  concatTransformationMatrix,
  pushGraphicsState,
  popGraphicsState,
  PDFDocument,
  type PDFImage,
  type PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { type BitMatrix, create as createQr } from 'qrcode';
import { AppException } from '#app/common/errors/app.exception';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import { DocumentFieldRepository } from '../repositories/document-field.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { FileObjectRepository } from '../repositories/file-object.repository';
import { SignatureRecordRepository } from '../repositories/signature-record.repository';
import { SignerRepository } from '../repositories/signer.repository';
import type { EsignFileObject } from '../entities/esign-file-object.entity';
import type { EsignSignatureRecord } from '../entities/esign-signature-record.entity';
import { canonicalSha256 } from './esign-audit.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignTokenService } from './esign-token.service';
import { PdfValidationService } from './pdf-validation.service';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 與 PDF.js 相同，百分比以 MediaBox/CropBox 交集的旋轉後可視區域為準。 */
function beginVisiblePage(page: PDFPage): { width: number; height: number } {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  const box =
    right > x && top > y ? { x, y, width: right - x, height: top - y } : media;
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const transforms: Record<
    number,
    [number, number, number, number, number, number]
  > = {
    0: [1, 0, 0, 1, box.x, box.y],
    90: [0, 1, -1, 0, box.x + box.width, box.y],
    180: [-1, 0, 0, -1, box.x + box.width, box.y + box.height],
    270: [0, -1, 1, 0, box.x, box.y + box.height],
  };
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...(transforms[rotation] ?? transforms[0])),
  );
  return rotation === 90 || rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/**
 * 簽名欄位版面（與簽署畫面佔位圖相同）：QR 邊長為欄位高度 72% 並貼齊右下角，
 * 簽名在左側剩餘寬度（扣除欄位高度 8% 間距）內等比縮放置中，兩者不重疊。
 * 欄位過窄時 QR 縮到不超過可用寬度的一半，確保簽名不被擠掉、QR 不超出欄位。
 */
export function signatureFieldLayout(
  field: Box,
  image: { width: number; height: number },
): { signature: Box; qr: Box } {
  const gap = field.height * 0.08;
  const qrSize = Math.max(
    0,
    Math.min(field.height * 0.72, (field.width - gap) / 2),
  );
  const availableWidth = Math.max(0, field.width - qrSize - gap);
  const scale = Math.min(
    availableWidth / image.width,
    field.height / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    signature: {
      x: field.x + (availableWidth - width) / 2,
      y: field.y + (field.height - height) / 2,
      width,
      height,
    },
    qr: {
      x: field.x + field.width - qrSize,
      y: field.y,
      width: qrSize,
      height: qrSize,
    },
  };
}

/** 一列中連續暗模組的 [起始欄, 長度]，合併後減少 PDF 繪圖指令與接縫。 */
function darkRuns(modules: BitMatrix, row: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (let col = 0; col < modules.size; col += 1) {
    if (!modules.get(row, col)) continue;
    const last = runs.at(-1);
    if (last && last[0] + last[1] === col) last[1] += 1;
    else runs.push([col, 1]);
  }
  return runs;
}

/** 以向量方塊畫 QR（錯誤修正 M、無留白、先畫白底），任何列印解析度都清晰。 */
export function drawVectorQr(page: PDFPage, text: string, box: Box): void {
  const { modules } = createQr(text, { errorCorrectionLevel: 'M' });
  const cell = box.width / modules.size;
  page.drawRectangle({ ...box, color: rgb(1, 1, 1) });
  for (let row = 0; row < modules.size; row += 1) {
    for (const [col, length] of darkRuns(modules, row)) {
      page.drawRectangle({
        x: box.x + col * cell,
        y: box.y + box.height - (row + 1) * cell,
        width: length * cell,
        height: cell,
        color: rgb(0, 0, 0),
      });
    }
  }
}

@Injectable()
export class CompletedPdfService {
  constructor(
    private readonly mysql: MysqlService,
    private readonly documents: DocumentRepository,
    private readonly signers: SignerRepository,
    private readonly fields: DocumentFieldRepository,
    private readonly files: FileObjectRepository,
    private readonly records: SignatureRecordRepository,
    private readonly validation: EsignDocumentValidationService,
    private readonly pdfValidation: PdfValidationService,
    private readonly tokens: EsignTokenService,
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {}

  async create(documentId: number, signerId: number) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    if (
      !document ||
      !['active', 'finalizing', 'stopped'].includes(document.status)
    )
      throw this.integrity();
    const [signer, fields, source] = await Promise.all([
      this.signers.findById(signerId, manager),
      this.fields.findByDocument(documentId, manager),
      this.files.findDocumentFile(documentId, 'source_pdf', manager),
    ]);
    if (
      !source ||
      !signer ||
      signer.documentId !== documentId ||
      signer.status !== 'signed'
    ) {
      throw this.integrity();
    }
    const sourceBytes = await readPrivateFile(this.storage, source);
    const sourceMetadata =
      await this.pdfValidation.validatePersistedPdf(sourceBytes);
    this.validation.assertSourceIntegrity(
      document,
      source,
      sourceMetadata.sha256,
    );
    this.validation.assertPayloadIntegrity(
      document,
      canonicalSha256(document.signingPayloadJson),
    );

    this.validation.assertFieldsBelongToDocument(fields, documentId);
    this.validation.assertSigningSnapshot(
      document,
      sourceMetadata.sha256,
      fields,
    );
    const record = await this.records.findBySignerId(signerId, manager);
    if (
      !record ||
      record.signerId !== signerId ||
      record.documentSha256 !== sourceMetadata.sha256 ||
      record.signingPayloadSha256 !== document.signingPayloadSha256 ||
      record.consentVersion !==
        this.consentVersion(document.signingPayloadJson) ||
      !signer.signedAt ||
      signer.signedAt.getTime() !== record.signedAtUtc.getTime()
    ) {
      throw this.integrity();
    }
    const signatureFiles = await this.files.findSignatureFiles(
      record.id,
      manager,
    );
    const signatureByField = new Map(
      signatureFiles.map((file) => [file.documentFieldId, file]),
    );
    const output = await PDFDocument.load(sourceBytes, {
      updateMetadata: false,
    });
    const font = await output.embedFont(StandardFonts.Helvetica);
    const signatureFields = fields.filter(
      (field) => field.fieldType === 'signature',
    );
    if (
      signatureFields.length === 0 ||
      signatureByField.size !== signatureFields.length ||
      signatureFiles.length !== signatureFields.length
    ) {
      throw this.integrity();
    }

    for (const field of fields) {
      if (field.pageNumber < 1 || field.pageNumber > output.getPageCount())
        throw this.integrity();
      const page = output.getPage(field.pageNumber - 1);
      const { width: pageWidth, height: pageHeight } = beginVisiblePage(page);
      const x = (Number(field.xPercent) / 100) * pageWidth;
      const width = (Number(field.widthPercent) / 100) * pageWidth;
      const height = (Number(field.heightPercent) / 100) * pageHeight;
      const y =
        pageHeight -
        ((Number(field.yPercent) + Number(field.heightPercent)) / 100) *
          pageHeight;
      if (field.fieldType === 'signature') {
        const png = await this.embedSignature(
          output,
          signatureByField.get(field.id),
          record,
        );
        const layout = signatureFieldLayout({ x, y, width, height }, png);
        page.drawImage(png, layout.signature);
        const verificationUrl = this.tokens.verificationUrl(
          record.verificationCode,
        );
        if (!verificationUrl) throw this.integrity();
        drawVectorQr(page, verificationUrl, layout.qr);
      } else if (field.fieldType === 'date') {
        const date = this.taipeiDate(record.signedAtUtc);
        const size = Math.min(
          12,
          height * 0.6,
          width / font.widthOfTextAtSize(date, 1),
        );
        page.drawText(date, {
          x,
          y: y + (height - size) / 2,
          size,
          font,
          color: rgb(0, 0, 0),
        });
      } else {
        throw this.integrity();
      }
      page.pushOperators(popGraphicsState());
    }

    const rendered = Buffer.from(
      await output.save({ useObjectStreams: false }),
    );
    const stored = await this.storage.store({
      directory: `documents/${document.docNumber}/completed/${signer.publicId}`,
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes: rendered,
    });
    try {
      const persisted = await this.pdfValidation.validatePersistedPdf(
        await readPrivateFile(this.storage, stored),
      );
      if (
        persisted.pageCount !== sourceMetadata.pageCount ||
        persisted.sha256 !== stored.sha256
      ) {
        throw this.integrity();
      }
      return {
        stored,
        metadata: persisted,
        signatureRecordId: record.id,
        sourceSha256: sourceMetadata.sha256,
        signingPayloadSha256: record.signingPayloadSha256,
      };
    } catch (error) {
      await this.storage.delete(stored).catch(() => undefined);
      throw error;
    }
  }

  /** 簽名 PNG 必須屬於該簽署紀錄且 bytes 與保存的摘要一致，才可嵌入完成 PDF。 */
  private async embedSignature(
    output: PDFDocument,
    file: EsignFileObject | undefined,
    record: EsignSignatureRecord,
  ): Promise<PDFImage> {
    if (
      !file ||
      file.signatureRecordId !== record.id ||
      file.filePurpose !== 'signature_png' ||
      file.mimeType !== 'image/png' ||
      file.archiveStatus !== 'active'
    ) {
      throw this.integrity();
    }
    const pngBytes = await readPrivateFile(this.storage, file);
    if (
      Number(file.fileSize) !== pngBytes.byteLength ||
      file.sha256 !== createHash('sha256').update(pngBytes).digest('hex')
    ) {
      throw this.integrity();
    }
    return output.embedPng(pngBytes);
  }

  private taipeiDate(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return `${value.year}/${value.month}/${value.day}`;
  }

  private consentVersion(payload: unknown): string {
    if (!payload || typeof payload !== 'object') throw this.integrity();
    const consent = (payload as Record<string, unknown>).consent;
    if (!consent || typeof consent !== 'object') throw this.integrity();
    const version = (consent as Record<string, unknown>).version;
    if (typeof version !== 'string' || version === '') throw this.integrity();
    return version;
  }

  private integrity(): AppException {
    return new AppException(...AppErrors.ESIGN_INTEGRITY_FAILED);
  }
}
