import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AppErrorCode } from '#app/common/errors/app-error-code';
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
import { canonicalJson } from './esign-audit.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { PdfValidationService } from './pdf-validation.service';

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
    @Inject(PRIVATE_FILE_STORAGE)
    private readonly storage: PrivateFileStorage,
  ) {}

  async create(documentId: number) {
    const manager = this.mysql.getManager();
    const document = await this.documents.findById(documentId, manager);
    if (!document || document.status !== 'finalizing') throw this.integrity();
    const [signers, fields, source] = await Promise.all([
      this.signers.findByDocument(documentId, manager),
      this.fields.findByDocument(documentId, manager),
      this.files.findDocumentFile(documentId, 'source_pdf', manager),
    ]);
    if (!source || signers.some((signer) => signer.status !== 'signed')) {
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
      createHash('sha256')
        .update(canonicalJson(document.signingPayloadJson), 'utf8')
        .digest('hex'),
    );

    const records = await this.records.findBySignerIds(
      signers.map((signer) => signer.id),
      manager,
    );
    const recordBySigner = new Map(
      records.map((record) => [record.signerId, record]),
    );
    if (recordBySigner.size !== signers.length) throw this.integrity();
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
      throw this.integrity();
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
      throw this.integrity();
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
        throw this.integrity();
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
        const file = signatureByField.get(field.id);
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
          file.sha256 !==
            createHash('sha256').update(pngBytes).digest('hex')
        ) {
          throw this.integrity();
        }
        const png = await output.embedPng(pngBytes);
        page.drawImage(png, { x, y, width, height });
      } else if (field.fieldType === 'date') {
        page.drawText(this.taipeiDate(record.signedAtUtc), {
          x,
          y: y + Math.max(0, (height - 12) / 2),
          size: Math.min(12, Math.max(8, height * 0.6)),
          font,
          color: rgb(0, 0, 0),
        });
      } else {
        throw this.integrity();
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
        throw this.integrity();
      }
      return { stored, metadata: persisted };
    } catch (error) {
      await this.storage.delete(stored).catch(() => undefined);
      throw error;
    }
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
    return new AppException(
      AppErrorCode.ESIGN_INTEGRITY_FAILED,
      '文件完整性驗證失敗',
      HttpStatus.CONFLICT,
    );
  }
}
