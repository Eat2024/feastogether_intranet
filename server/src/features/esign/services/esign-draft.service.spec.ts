import { Readable } from 'node:stream';
import { EsignDraftService } from './esign-draft.service';

describe('EsignDraftService', () => {
  const manager = {} as never;
  const document = {
    id: 1,
    docNumber: '550e8400-e29b-41d4-a716-446655440000',
    title: '文件',
    status: 'draft',
    createdByUserId: 9,
  };
  const stored = {
    objectKey: 'esign/random/source.pdf',
    mimeType: 'application/pdf',
    fileSize: 3,
    sha256: 'a'.repeat(64),
  };

  function setup(transactionError?: Error) {
    const mysql = {
      getManager: jest.fn(() => manager),
      transaction: jest.fn(async (run: (value: never) => Promise<unknown>) => {
        if (transactionError) throw transactionError;
        return run(manager);
      }),
    };
    const documents = {
      create: jest.fn((value: object) => ({ ...document, ...value })),
      save: jest.fn(async (value: object) => value),
      findById: jest.fn(async () => document),
      findByIdForUpdate: jest.fn(async () => document),
      findCreatedByUser: jest.fn(async () => [document]),
      softDeleteDraft: jest.fn(async () => ({ affected: 1 })),
    };
    const files = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => value),
      findDocumentFile: jest.fn(async () => undefined),
      deleteById: jest.fn(),
    };
    const access = { checkEsignCreator: jest.fn() };
    const fields = { deleteDraftFields: jest.fn() };
    const validation = { checkStillDraft: jest.fn() };
    const pdf = {
      validateUpload: jest.fn(async () => stored),
      validatePersistedPdf: jest.fn(async () => stored),
    };
    const audit = { append: jest.fn() };
    const storage = {
      store: jest.fn(async () => stored),
      openReadStream: jest.fn(async () => Readable.from([Buffer.from('pdf')])),
      delete: jest.fn(async () => undefined),
    };
    const service = new EsignDraftService(
      mysql as never,
      documents as never,
      files as never,
      fields as never,
      access as never,
      validation as never,
      pdf as never,
      audit as never,
      storage as never,
    );
    return {
      service,
      documents,
      access,
      validation,
      storage,
      files,
      fields,
      audit,
    };
  }

  it('建立草稿時保存驗證後 PDF metadata 與 audit', async () => {
    const { service, documents, files, storage, audit } = setup();
    await service.create({
      title: '  合約  ',
      creatorUserId: 9,
      bytes: Buffer.from('pdf'),
      originalFileName: '../合約.pdf',
      contentType: 'application/pdf',
    });

    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: '合約', status: 'draft' }),
      manager,
    );
    expect(files.create).toHaveBeenCalledWith(
      expect.objectContaining({ originalFileName: '合約.pdf' }),
      manager,
    );
    expect(storage.delete).not.toHaveBeenCalled();
    expect(storage.store).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: expect.stringMatching(
          /^documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/source$/,
        ),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 1,
        actorUserId: 9,
        eventType: 'document.created',
      }),
      manager,
    );
  });

  it('DB transaction 失敗時清除新上傳 orphan', async () => {
    const { service, storage } = setup(new Error('db failed'));
    await expect(
      service.create({
        title: '合約',
        creatorUserId: 9,
        bytes: Buffer.from('pdf'),
        originalFileName: 'a.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow('db failed');
    expect(storage.delete).toHaveBeenCalledWith(stored);
  });

  it('所有修改與刪除都重用 creator/draft policy', async () => {
    const { service, access, validation } = setup();
    await service.update(1, 9, { title: '新名稱' });
    await service.delete(1, 9);
    expect(access.checkEsignCreator).toHaveBeenCalledTimes(2);
    expect(validation.checkStillDraft).toHaveBeenCalledTimes(2);
  });

  it('替換 PDF 在 transaction 內清除舊欄位與 metadata，commit 後才刪舊 bytes', async () => {
    const { service, files, fields, storage } = setup();
    files.findDocumentFile.mockResolvedValue({
      id: 88,
      objectKey: 'esign/old/source.pdf',
    });

    await service.update(1, 9, {
      file: {
        bytes: Buffer.from('pdf'),
        originalFileName: 'new.pdf',
        contentType: 'application/pdf',
      },
    });

    expect(fields.deleteDraftFields).toHaveBeenCalledWith(1, manager);
    expect(files.deleteById).toHaveBeenCalledWith(88, manager);
    expect(storage.delete).toHaveBeenCalledWith({
      objectKey: 'esign/old/source.pdf',
      objectVersion: undefined,
    });
  });

  it('policy 拒絕非 creator 或非 draft 時不寫入', async () => {
    const { service, access, validation, documents } = setup();
    access.checkEsignCreator.mockImplementationOnce(() => {
      throw new Error('找不到電子簽資源');
    });
    await expect(service.update(1, 10, { title: '越權' })).rejects.toThrow(
      '找不到電子簽資源',
    );
    validation.checkStillDraft.mockImplementationOnce(() => {
      throw new Error('文件已發起');
    });
    await expect(service.update(1, 9, { title: '改 active' })).rejects.toThrow(
      '文件已發起',
    );
    expect(documents.save).not.toHaveBeenCalled();
  });

  it('拒絕空白、過長名稱與空更新', async () => {
    const { service } = setup();
    await expect(service.update(1, 9, {})).rejects.toThrow(
      '至少需要提供一項草稿更新內容',
    );
    await expect(service.update(1, 9, { title: '   ' })).rejects.toThrow(
      '文件名稱必須為 1 至 200 字',
    );
    await expect(
      service.update(1, 9, { title: 'x'.repeat(201) }),
    ).rejects.toThrow('文件名稱必須為 1 至 200 字');
  });
});
