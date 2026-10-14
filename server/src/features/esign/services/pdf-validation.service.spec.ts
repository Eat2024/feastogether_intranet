import { createHash } from 'node:crypto';
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { MAX_PDF_SIZE, PdfValidationService } from './pdf-validation.service';

describe('PdfValidationService', () => {
  const service = new PdfValidationService();

  const validPdf = async (pages = 1) => {
    const document = await PDFDocument.create();
    for (let page = 0; page < pages; page += 1) document.addPage();
    return Buffer.from(await document.save());
  };

  it('只以實際 bytes 計算 size、page count 與 SHA-256', async () => {
    const bytes = await validPdf(2);
    await expect(service.validatePersistedPdf(bytes)).resolves.toEqual({
      mimeType: 'application/pdf',
      fileSize: bytes.byteLength,
      pageCount: 2,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('拒絕空檔、偽裝 signature 與損壞 PDF', async () => {
    await expect(service.validatePersistedPdf(Buffer.alloc(0))).rejects.toThrow(
      '不可為空',
    );
    await expect(
      service.validatePersistedPdf(Buffer.from('not-a-pdf')),
    ).rejects.toThrow('不是有效 PDF');
    await expect(
      service.validatePersistedPdf(Buffer.from('%PDF-corrupt')),
    ).rejects.toThrow('損壞或無法讀取');
  });

  it('拒絕錯誤 MIME 或副檔名，即使 bytes 是有效 PDF', async () => {
    const bytes = await validPdf();
    await expect(
      service.validateUpload({
        bytes,
        originalFileName: 'document.txt',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow('只接受 PDF');
    await expect(
      service.validateUpload({
        bytes,
        originalFileName: 'document.pdf',
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('只接受 PDF');
  });

  it('拒絕加密 PDF', async () => {
    const load = jest
      .spyOn(PDFDocument, 'load')
      .mockRejectedValueOnce(new EncryptedPDFError());
    await expect(
      service.validatePersistedPdf(Buffer.from('%PDF-encrypted')),
    ).rejects.toThrow('不接受加密 PDF');
    load.mockRestore();
  });

  it('拒絕超過 20 MiB 或 100 頁', async () => {
    const oversized = Buffer.alloc(MAX_PDF_SIZE + 1);
    oversized.write('%PDF-');
    await expect(service.validatePersistedPdf(oversized)).rejects.toMatchObject(
      {
        status: 413,
      },
    );

    await expect(
      service.validatePersistedPdf(await validPdf(101)),
    ).rejects.toThrow('1 至 100 頁');
  });
});
