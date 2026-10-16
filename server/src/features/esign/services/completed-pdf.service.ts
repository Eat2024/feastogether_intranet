import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PDFDocument,
  type PDFImage,
  type PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { type BitMatrix, create as createQr } from 'qrcode';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { readPrivateFile } from '#app/infrastructure/file-storage/read-private-file';
import { integrityFailed } from '../helpers/esign-errors';
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

  async create(documentId: number) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    if (!document || document.status !== 'finalizing') throw integrityFailed();
    const [signers, fields, source] = await Promise.all([
      this.signers.findByDocument(documentId, manager),
      this.fields.findByDocument(documentId, manager),
      this.files.findDocumentFile(documentId, 'source_pdf', manager),
    ]);
    if (!source || signers.some((signer) => signer.status !== 'signed')) {
      throw integrityFailed();
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

    const records = await this.records.findBySignerIds(
      signers.map((signer) => signer.id),
      manager,
    );
    const recordBySigner = new Map(
      records.map((record) => [record.signerId, record]),
    );
    if (recordBySigner.size !== signers.length) throw integrityFailed();
    const signatureFiles = (
      await Promise.all(
        records.map((record) =>
          this.files.findSignatureFiles(record.id, manager),
        ),
      )
    ).flat();
    const consentVersion = this.consentVersion(document.signingPayloadJson);
    if (
      records.some(
        (record) =>
          record.documentSha256 !== sourceMetadata.sha256 ||
          record.signingPayloadSha256 !== document.signingPayloadSha256 ||
          record.consentVersion !== consentVersion,
      )
    ) {
      throw integrityFailed();
    }
    const signatureByField = new Map(
      signatureFiles.map((file) => [file.documentFieldId, file]),
    );
    const signerById = new Map(signers.map((signer) => [signer.id, signer]));
    const output = await PDFDocument.load(sourceBytes, {
      updateMetadata: false,
    });
    const font = await output.embedFont(StandardFonts.Helvetica);
    const signatureFields = fields.filter(
      (field) => field.fieldType === 'signature',
    );
    if (signatureFiles.length !== signatureFields.length) {
      throw integrityFailed();
    }

    for (const field of fields) {
      const signer = signerById.get(field.signerId ?? -1);
      const record = signer ? recordBySigner.get(signer.id) : undefined;
      const page = output.getPage(field.pageNumber - 1);
      if (
        !signer ||
        !record ||
        !page ||
        !signer.signedAt ||
        signer.signedAt.getTime() !== record.signedAtUtc.getTime()
      ) {
        throw integrityFailed();
      }
      const { width: pageWidth, height: pageHeight } = page.getSize();
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
        // Spec 04 上線前的簽署紀錄沒有驗證代碼，不畫 QR
        const verificationUrl = this.tokens.verificationUrl(
          record.verificationCode,
        );
        if (verificationUrl) drawVectorQr(page, verificationUrl, layout.qr);
      } else if (field.fieldType === 'date') {
        page.drawText(this.taipeiDate(record.signedAtUtc), {
          x,
          y: y + Math.max(0, (height - 12) / 2),
          size: Math.min(12, Math.max(8, height * 0.6)),
          font,
          color: rgb(0, 0, 0),
        });
      } else {
        throw integrityFailed();
      }
    }

    const rendered = Buffer.from(
      await output.save({ useObjectStreams: false }),
    );
    const stored = await this.storage.store({
      directory: `documents/${document.docNumber}/completed`,
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
        throw integrityFailed();
      }
      return { stored, metadata: persisted };
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
      throw integrityFailed();
    }
    const pngBytes = await readPrivateFile(this.storage, file);
    if (
      Number(file.fileSize) !== pngBytes.byteLength ||
      file.sha256 !== createHash('sha256').update(pngBytes).digest('hex')
    ) {
      throw integrityFailed();
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
    if (!payload || typeof payload !== 'object') throw integrityFailed();
    const consent = (payload as Record<string, unknown>).consent;
    if (!consent || typeof consent !== 'object') throw integrityFailed();
    const version = (consent as Record<string, unknown>).version;
    if (typeof version !== 'string' || version === '') throw integrityFailed();
    return version;
  }
}
