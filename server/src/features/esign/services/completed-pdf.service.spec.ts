import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { canonicalJson } from './esign-audit.service';
import { CompletedPdfService } from './completed-pdf.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { PdfValidationService } from './pdf-validation.service';

describe('CompletedPdfService', () => {
  it('以原 PDF 嵌入本人欄位 PNG，並以同一 signedAt 轉台北日期後重讀驗證', async () => {
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage([595, 842]);
    const sourceBytes = Buffer.from(await sourcePdf.save());
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
      'base64',
    );
    const payload = { consent: { version: 'v1' }, document: { id: 4 } };
    const document = {
      id: 4,
      docNumber: '550e8400-e29b-41d4-a716-446655440000',
      status: 'finalizing',
      sourceFileSha256: sourceHash,
      signingPayloadJson: payload,
      signingPayloadSha256: createHash('sha256')
        .update(canonicalJson(payload), 'utf8')
        .digest('hex'),
    };
    const signer = {
      id: 7,
      status: 'signed',
      signedAt: new Date('2026-10-13T16:30:00.000Z'),
    };
    const fields = [
      {
        id: 11,
        documentId: 4,
        signerId: 7,
        fieldType: 'signature',
        pageNumber: 1,
        xPercent: '10',
        yPercent: '10',
        widthPercent: '25',
        heightPercent: '10',
      },
      {
        id: 12,
        documentId: 4,
        signerId: 7,
        fieldType: 'date',
        pageNumber: 1,
        xPercent: '40',
        yPercent: '10',
        widthPercent: '20',
        heightPercent: '6',
      },
    ];
    const source = {
      id: 1,
      documentId: 4,
      filePurpose: 'source_pdf',
      archiveStatus: 'active',
      objectKey: 'source.pdf',
      mimeType: 'application/pdf',
      fileSize: sourceBytes.length,
      sha256: sourceHash,
    };
    const signatureFile = {
      documentFieldId: 11,
      signatureRecordId: 21,
      objectKey: 'signature.png',
      filePurpose: 'signature_png',
      mimeType: 'image/png',
      fileSize: pngBytes.length,
      sha256: createHash('sha256').update(pngBytes).digest('hex'),
      archiveStatus: 'active',
    };
    const bytes = new Map<string, Buffer>([
      ['source.pdf', sourceBytes],
      ['signature.png', pngBytes],
    ]);
    const storage = {
      openReadStream: jest.fn(async (file: { objectKey: string }) =>
        Readable.from([bytes.get(file.objectKey)!]),
      ),
      store: jest.fn(async (input: { bytes: Buffer; mimeType: string }) => {
        const objectKey = 'completed.pdf';
        bytes.set(objectKey, input.bytes);
        return {
          objectKey,
          mimeType: input.mimeType,
          fileSize: input.bytes.length,
          sha256: createHash('sha256').update(input.bytes).digest('hex'),
        };
      }),
      delete: jest.fn(),
    };
    const manager = {} as never;
    const drawText = jest.spyOn(PDFPage.prototype, 'drawText');
    const record = {
      id: 21,
      signerId: 7,
      documentSha256: sourceHash,
      signingPayloadSha256: document.signingPayloadSha256,
      consentVersion: 'v1',
      signedAtUtc: signer.signedAt,
    };
    const service = new CompletedPdfService(
      { getManager: () => manager } as never,
      { findById: jest.fn(async () => document) } as never,
      { findByDocument: jest.fn(async () => [signer]) } as never,
      { findByDocument: jest.fn(async () => fields) } as never,
      {
        findDocumentFile: jest.fn(async () => source),
        findSignatureFiles: jest.fn(async () => [signatureFile]),
      } as never,
      {
        findBySignerIds: jest.fn(async () => [record]),
      } as never,
      new EsignDocumentValidationService(),
      new PdfValidationService(),
      storage as never,
    );

    const result = await service.create(4);

    expect(drawText).toHaveBeenCalledWith(
      '2026/10/14',
      expect.objectContaining({ color: expect.anything() }),
    );
    expect(result.metadata.pageCount).toBe(1);
    expect(result.metadata.sha256).toBe(result.stored.sha256);
    expect(bytes.get('source.pdf')).toEqual(sourceBytes);
    expect(bytes.get('completed.pdf')).not.toEqual(sourceBytes);

    signatureFile.sha256 = '0'.repeat(64);
    await expect(service.create(4)).rejects.toThrow('文件完整性驗證失敗');
    signatureFile.sha256 = createHash('sha256').update(pngBytes).digest('hex');
    record.documentSha256 = '0'.repeat(64);
    await expect(service.create(4)).rejects.toThrow('文件完整性驗證失敗');
    record.documentSha256 = sourceHash;
    record.signingPayloadSha256 = '0'.repeat(64);
    await expect(service.create(4)).rejects.toThrow('文件完整性驗證失敗');
    record.signingPayloadSha256 = document.signingPayloadSha256;
    record.consentVersion = 'tampered';
    await expect(service.create(4)).rejects.toThrow('文件完整性驗證失敗');
    record.consentVersion = 'v1';
    storage.openReadStream.mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    await expect(service.create(4)).rejects.toThrow('storage unavailable');
    expect(storage.store).toHaveBeenCalledTimes(1);
    drawText.mockRestore();
  });
});
