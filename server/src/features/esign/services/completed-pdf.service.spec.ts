import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { create as createQr } from 'qrcode';
import { canonicalJson } from './esign-audit.service';
import {
  CompletedPdfService,
  signatureFieldLayout,
} from './completed-pdf.service';
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
      publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
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
    const drawImage = jest.spyOn(PDFPage.prototype, 'drawImage');
    const drawRectangle = jest.spyOn(PDFPage.prototype, 'drawRectangle');
    const verificationUrl = `https://esign.example.internal/verify/${'A'.repeat(110)}`;
    const tokens = { verificationUrl: jest.fn(() => verificationUrl) };
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
      tokens as never,
      storage as never,
    );

    const result = await service.create(4);

    // 欄位 11：x=10%、y=10%、寬 25%、高 10%，PDF 座標原點在左下
    const field = { x: 59.5, y: 842 - 168.4, width: 148.75, height: 84.2 };
    const qrSize = field.height * 0.72;
    expect(tokens.verificationUrl).toHaveBeenCalledWith(signer.publicId);
    const [qrBackground, ...darkCells] = drawRectangle.mock.calls.map(
      ([options]) => options!,
    );
    expect(qrBackground).toMatchObject({
      width: expect.closeTo(qrSize, 6) as number,
      height: expect.closeTo(qrSize, 6) as number,
    });
    expect(qrBackground.x! + qrBackground.width!).toBeCloseTo(
      field.x + field.width,
      6,
    );
    expect(qrBackground.y).toBeCloseTo(field.y, 6);
    const { modules } = createQr(verificationUrl, {
      errorCorrectionLevel: 'M',
    });
    const cell = qrSize / modules.size;
    const darkCount = Array.from(modules.data).filter(Boolean).length;
    expect(
      darkCells.reduce((sum, options) => sum + options.width! / cell, 0),
    ).toBeCloseTo(darkCount, 6);
    const signatureBox = drawImage.mock.calls[0][1]!;
    expect(signatureBox.x! + signatureBox.width!).toBeLessThanOrEqual(
      qrBackground.x! - field.height * 0.08 + 1e-6,
    );

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
    drawImage.mockRestore();
    drawRectangle.mockRestore();
  });
});

describe('signatureFieldLayout', () => {
  const field = { x: 10, y: 20, width: 200, height: 100 };

  it('QR 邊長為欄位高度 72% 並貼齊右下角', () => {
    expect(signatureFieldLayout(field, { width: 300, height: 100 }).qr).toEqual(
      { x: 138, y: 20, width: 72, height: 72 },
    );
  });

  it.each([
    ['寬簽名', { width: 300, height: 100 }],
    ['高簽名', { width: 50, height: 200 }],
  ])('%s在左側剩餘寬度內等比縮放置中，且不與 QR 重疊', (_name, image) => {
    const { signature, qr } = signatureFieldLayout(field, image);
    const available = field.width - 72 - 8;
    expect(signature.width / signature.height).toBeCloseTo(
      image.width / image.height,
      6,
    );
    expect(signature.x - field.x).toBeCloseTo(
      (available - signature.width) / 2,
      6,
    );
    expect(signature.y - field.y).toBeCloseTo(
      (field.height - signature.height) / 2,
      6,
    );
    expect(signature.x + signature.width).toBeLessThanOrEqual(qr.x - 8 + 1e-6);
    expect(signature.height).toBeLessThanOrEqual(field.height + 1e-6);
  });

  it('欄位過窄時 QR 縮到可用寬度一半，簽名仍可見且 QR 不超出欄位', () => {
    const narrow = { x: 10, y: 20, width: 60, height: 84 };
    const { signature, qr } = signatureFieldLayout(narrow, {
      width: 300,
      height: 100,
    });
    const gap = narrow.height * 0.08;
    expect(qr.width).toBeCloseTo((narrow.width - gap) / 2, 6);
    expect(qr.x).toBeGreaterThanOrEqual(narrow.x);
    expect(qr.x + qr.width).toBeCloseTo(narrow.x + narrow.width, 6);
    expect(signature.width).toBeGreaterThan(0);
    expect(signature.x + signature.width).toBeLessThanOrEqual(
      qr.x - gap + 1e-6,
    );
  });
});
