import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { EsignCompletionAccessService } from './esign-completion-access.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { PdfValidationService } from './pdf-validation.service';
import { canonicalSha256 } from './esign-audit.service';

describe('EsignCompletionAccessService 個人下載', () => {
  async function setup(status = 'active') {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const payload = { schemaVersion: 2 };
    const signer = {
      id: 8,
      publicId: 'person-a',
      documentId: 4,
      userId: 20,
      signerType: 'user',
      nameSnapshot: '王小明',
      status: 'signed',
      completionStatus: 'ready',
      signedAt: new Date('2026-10-16T00:00:00Z'),
    };
    const document = {
      id: 4,
      docNumber: 'ESIGN-2026-001',
      title: '員工保密協議',
      createdByUserId: 7,
      status,
      signingPayloadJson: payload,
      signingPayloadSha256: canonicalSha256(payload),
    };
    const record = {
      id: 21,
      signerId: 8,
      signedAtUtc: signer.signedAt,
      signingPayloadSha256: document.signingPayloadSha256,
    };
    const file = {
      id: 31,
      signatureRecordId: 21,
      documentId: null as number | null,
      filePurpose: 'completed_pdf',
      archiveStatus: 'active',
      mimeType: 'application/pdf',
      objectKey: 'private.pdf',
      fileSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const files = {
      findCompletedFile: jest.fn(async () => file),
      findDocumentFile: jest.fn(),
    };
    const storage = {
      openReadStream: jest.fn(async () => Readable.from([bytes])),
    };
    const service = new EsignCompletionAccessService(
      { getManager: () => ({}) } as never,
      { findById: jest.fn(async () => document) } as never,
      { findByPublicId: jest.fn(async () => signer) } as never,
      files as never,
      new EsignAccessPolicyService(
        new EsignDocumentValidationService(),
        {} as never,
      ),
      new PdfValidationService(),
      storage as never,
      { findBySignerId: jest.fn(async () => record) } as never,
    );
    return { service, signer, document, file, record, files, storage, bytes };
  }

  it.each(['active', 'expired', 'finalizing', 'completed', 'stopped'])(
    '%s 的 ready 副本供建立人及本人下載',
    async (status) => {
      const f = await setup(status);
      expect((await f.service.creatorFile(4, 'person-a', 7))?.bytes).toEqual(
        f.bytes,
      );
      await expect(f.service.signerFile('person-a', 20)).rejects.toMatchObject({
        status: 403,
        code: 'ESIGN_EMAIL_OTP_REQUIRED',
      });
      expect(f.files.findCompletedFile).toHaveBeenCalledWith(
        21,
        expect.anything(),
      );
      expect(f.files.findDocumentFile).not.toHaveBeenCalled();
    },
  );

  it('跨人、非建立人與跨文件查詢在讀檔前拒絕', async () => {
    const f = await setup();
    await expect(f.service.signerFile('person-a', 99)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      f.service.creatorFile(4, 'person-a', 20),
    ).rejects.toMatchObject({ status: 404 });
    f.signer.documentId = 5;
    await expect(f.service.creatorFile(4, 'person-a', 7)).rejects.toMatchObject(
      { status: 404 },
    );
    expect(f.storage.openReadStream).not.toHaveBeenCalled();
  });

  it.each(['pending', 'processing', 'failed'])(
    '%s 不提供檔案，也不查整份完成檔作替代',
    async (status) => {
      const f = await setup();
      f.signer.completionStatus = status;
      await expect(f.service.creatorFile(4, 'person-a', 7)).resolves.toBeNull();
      expect(f.files.findCompletedFile).not.toHaveBeenCalled();
      expect(f.files.findDocumentFile).not.toHaveBeenCalled();
    },
  );

  it('外部簽署人不可透過員工本人下載入口取得檔案', async () => {
    const f = await setup();
    f.signer.signerType = 'email';
    await expect(f.service.signerFile('person-a', 20)).rejects.toMatchObject({
      status: 404,
    });
    expect(f.storage.openReadStream).not.toHaveBeenCalled();
  });

  it('personalCopy 由呼叫端授權後直接讀取本人副本，不限簽署人類型', async () => {
    const f = await setup('stopped');
    f.signer.signerType = 'email';
    expect(
      (await f.service.personalCopy(f.document as never, f.signer as never))
        ?.bytes,
    ).toEqual(f.bytes);
    f.signer.completionStatus = 'processing';
    await expect(
      f.service.personalCopy(f.document as never, f.signer as never),
    ).resolves.toBeNull();
  });

  it('個人副本檔名包含文件編號、文件名稱與簽署人姓名', async () => {
    const f = await setup();
    await expect(
      f.service.personalCopy(f.document as never, f.signer as never),
    ).resolves.toMatchObject({
      fileName: 'ESIGN-2026-001_員工保密協議_王小明.pdf',
    });

    f.document.title = '保密/協議';
    f.signer.nameSnapshot = '王:小明';
    await expect(
      f.service.personalCopy(f.document as never, f.signer as never),
    ).resolves.toMatchObject({
      fileName: 'ESIGN-2026-001_保密_協議_王_小明.pdf',
    });
  });

  it.each(['owner', 'record', 'hash', 'size', 'evidence'])(
    '完成產物 %s 不一致時拒絕',
    async (change) => {
      const f = await setup();
      if (change === 'owner') f.file.documentId = 4;
      if (change === 'record') f.file.signatureRecordId = 22;
      if (change === 'hash') f.file.sha256 = '0'.repeat(64);
      if (change === 'size') f.file.fileSize += 1;
      if (change === 'evidence') f.record.signingPayloadSha256 = '0'.repeat(64);
      await expect(
        f.service.creatorFile(4, 'person-a', 7),
      ).rejects.toMatchObject({
        status: 409,
      });
    },
  );
});
