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
    const access = {
      checkEsignCreator: jest.fn(),
      checkAndLockDraftDoc: jest.fn(async () => document),
    };
    const fields = {
      deleteDraftFields: jest.fn(),
      save: jest.fn(async (values: object[]) => values),
    };
    const validation = { checkStillDraft: jest.fn() };
    const pdf = {
      validateUpload: jest.fn(async () => stored),
      validatePersistedPdf: jest.fn(async () => ({ ...stored, pageCount: 2 })),
    };
    const fieldService = {
      build: jest.fn(() => [{ fieldType: 'signature' }]),
      buildFields: jest.fn(),
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
      fieldService as never,
    );
    return {
      service,
      mysql,
      pdf,
      documents,
      access,
      validation,
      storage,
      files,
      fields,
      fieldService,
      audit,
    };
  }

  const placement = {
    type: 'signature' as const,
    page: 2,
    xPercent: 10,
    yPercent: 20,
    widthPercent: 30,
    heightPercent: 15,
    sortOrder: 0,
  };
  const pdfFile = {
    bytes: Buffer.from('pdf'),
    originalFileName: 'new.pdf',
    contentType: 'application/pdf',
  };

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

  it('建立草稿可一併寫入未指派欄位，頁數以伺服器驗證的 PDF 為準', async () => {
    const { service, fields, fieldService } = setup();
    await service.create({
      title: '合約',
      creatorUserId: 9,
      fields: [placement],
      ...pdfFile,
    });

    expect(fieldService.build).toHaveBeenCalledWith(
      1,
      9,
      [placement],
      2,
      manager,
    );
    expect(fields.save).toHaveBeenCalledWith(
      [{ fieldType: 'signature' }],
      manager,
    );
  });

  it('建立草稿時欄位不合法，整筆不建立並清除已上傳的 PDF', async () => {
    const { service, storage, fieldService, audit } = setup();
    fieldService.build.mockImplementationOnce(() => {
      throw new Error('欄位頁碼或位置超出 PDF 範圍');
    });

    await expect(
      service.create({
        title: '合約',
        creatorUserId: 9,
        fields: [{ ...placement, page: 3 }],
        ...pdfFile,
      }),
    ).rejects.toThrow('欄位頁碼或位置超出 PDF 範圍');
    expect(audit.append).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith(stored);
  });

  it('修改草稿只帶欄位時，於同一交易整批取代欄位', async () => {
    const { service, fields, fieldService } = setup();
    await service.update(1, 9, { fields: [placement] });

    expect(fieldService.buildFields).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, createdByUserId: 9, status: 'draft' }),
      9,
      [placement],
      manager,
    );
    expect(fields.deleteDraftFields).not.toHaveBeenCalled();
  });

  it('修改草稿同時換 PDF 與帶欄位時，依新 PDF 頁數寫入欄位', async () => {
    const { service, fields, fieldService } = setup();
    await service.update(1, 9, { file: pdfFile, fields: [placement] });

    expect(fields.deleteDraftFields).toHaveBeenCalledWith(1, manager);
    expect(fieldService.build).toHaveBeenCalledWith(
      1,
      9,
      [placement],
      2,
      manager,
    );
    expect(fields.save).toHaveBeenCalledWith(
      [{ fieldType: 'signature' }],
      manager,
    );
    expect(fieldService.buildFields).not.toHaveBeenCalled();
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
    const { service, access } = setup();
    await service.update(1, 9, { title: '新名稱' });
    await service.delete(1, 9);
    expect(access.checkAndLockDraftDoc).toHaveBeenNthCalledWith(
      1,
      1,
      9,
      manager,
    );
    expect(access.checkAndLockDraftDoc).toHaveBeenNthCalledWith(
      2,
      1,
      9,
      manager,
    );
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
    const { service, access, documents } = setup();
    access.checkAndLockDraftDoc.mockRejectedValueOnce(
      new Error('找不到電子簽資源'),
    );
    await expect(service.update(1, 10, { title: '越權' })).rejects.toThrow(
      '找不到電子簽資源',
    );
    access.checkAndLockDraftDoc.mockRejectedValueOnce(new Error('文件已發起'));
    await expect(service.update(1, 9, { title: '改 active' })).rejects.toThrow(
      '文件已發起',
    );
    expect(documents.save).not.toHaveBeenCalled();
  });

  it('換 PDF 前的權限檢查失敗時，不上傳也不開啟交易', async () => {
    const { service, access, storage, mysql } = setup();
    access.checkEsignCreator.mockImplementationOnce(() => {
      throw new Error('找不到電子簽資源');
    });

    await expect(service.update(1, 10, { file: pdfFile })).rejects.toThrow(
      '找不到電子簽資源',
    );
    expect(storage.store).not.toHaveBeenCalled();
    expect(mysql.transaction).not.toHaveBeenCalled();
  });

  it('儲存後 PDF 雜湊不符時，清除新檔且不開啟交易', async () => {
    const { service, pdf, storage, mysql } = setup();
    pdf.validatePersistedPdf.mockResolvedValueOnce({
      ...stored,
      sha256: 'b'.repeat(64),
      pageCount: 2,
    });

    await expect(service.update(1, 9, { file: pdfFile })).rejects.toThrow(
      '文件完整性驗證失敗',
    );
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(stored);
    expect(mysql.transaction).not.toHaveBeenCalled();
  });

  it('上傳後鎖內檢查失敗時，只清除新檔而不修改舊資料', async () => {
    const { service, access, storage, files, fields } = setup();
    access.checkAndLockDraftDoc.mockRejectedValueOnce(new Error('文件已發起'));

    await expect(service.update(1, 9, { file: pdfFile })).rejects.toThrow(
      '文件已發起',
    );
    expect(storage.delete).toHaveBeenCalledWith(stored);
    expect(files.deleteById).not.toHaveBeenCalled();
    expect(fields.deleteDraftFields).not.toHaveBeenCalled();
  });

  it('audit 失敗時保留舊檔，只清除新上傳的 PDF', async () => {
    const { service, files, audit, storage } = setup();
    files.findDocumentFile.mockResolvedValue({
      id: 88,
      objectKey: 'esign/old/source.pdf',
    });
    audit.append.mockRejectedValueOnce(new Error('audit failed'));

    await expect(service.update(1, 9, { file: pdfFile })).rejects.toThrow(
      'audit failed',
    );
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(stored);
  });

  it('換 PDF 與多個欄位只驗證新檔一次，不重新讀取 PDF 或逐欄位查詢', async () => {
    const { service, pdf, files, fields, fieldService } = setup();
    await service.update(1, 9, {
      file: pdfFile,
      fields: Array.from({ length: 10 }, () => ({ ...placement })),
    });

    expect(pdf.validateUpload).toHaveBeenCalledTimes(1);
    expect(pdf.validatePersistedPdf).toHaveBeenCalledTimes(1);
    expect(files.findDocumentFile).toHaveBeenCalledTimes(1);
    expect(fields.deleteDraftFields).toHaveBeenCalledTimes(1);
    expect(fields.save).toHaveBeenCalledTimes(1);
    expect(fieldService.buildFields).not.toHaveBeenCalled();
  });

  it('空欄位陣列仍會清空既有欄位', async () => {
    const { service, fieldService } = setup();
    await service.update(1, 9, { fields: [] });
    expect(fieldService.buildFields).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      9,
      [],
      manager,
    );
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
