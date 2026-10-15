import type { EsignDocument } from '../entities/esign-document.entity';
import { Readable } from 'node:stream';
import { AppException } from '#app/common/errors/app.exception';
import { EsignFieldService } from './esign-field.service';

describe('EsignFieldService', () => {
  const manager = {} as never;
  const document = {
    id: 3,
    status: 'draft',
    createdByUserId: 7,
  } as EsignDocument;
  const signerPublicId = 'c854d925-1d70-49dc-9c81-abf18409ae42';
  const placement = {
    page: 1,
    xPercent: 10,
    yPercent: 20,
    widthPercent: 30,
    heightPercent: 15,
    sortOrder: 0,
  };

  function setup() {
    const signers = {
      findByDocument: jest.fn(async () => [
        { id: 11, publicId: signerPublicId, documentId: 3 },
      ]),
    };
    const fields = {
      create: jest.fn((value: object) => value),
      deleteDraftFields: jest.fn(),
      save: jest.fn(async (values: object[]) => values),
    };
    const files = {
      findDocumentFile: jest.fn(async () => ({ id: 31, documentId: 3 })),
    };
    const access = {
      checkAndLockDraftDoc: jest.fn(async () => ({
        id: 3,
        status: 'draft',
        createdByUserId: 7,
      })),
    };
    const validation = { assertSourceIntegrity: jest.fn() };
    const service = new EsignFieldService(
      {
        transaction: (callback: (value: typeof manager) => unknown) =>
          callback(manager),
      } as never,
      signers as never,
      fields as never,
      files as never,
      access as never,
      validation as never,
      {
        validatePersistedPdf: jest.fn(async () => ({
          pageCount: 2,
          sha256: 'a'.repeat(64),
        })),
      } as never,
      {
        openReadStream: jest.fn(async () =>
          Readable.from([Buffer.from('pdf')]),
        ),
      } as never,
    );
    return { service, fields, access };
  }

  it('未帶簽署人的草稿欄位存成未指派，有帶的對應本文件簽署人', async () => {
    const { service, fields } = setup();

    const result = await service.buildFields(
      document,
      7,
      [
        { ...placement, type: 'signature' },
        { ...placement, type: 'date', signerPublicId: null },
        { ...placement, type: 'signature', page: 2, signerPublicId },
      ],
      manager,
    );

    expect(result.source).toMatchObject({ id: 31, documentId: 3 });
    expect(result.sourceMetadata).toMatchObject({
      pageCount: 2,
      sha256: 'a'.repeat(64),
    });
    expect(result.fields).toHaveLength(3);
    expect(fields.deleteDraftFields).toHaveBeenCalledWith(3, manager);
    expect(fields.save).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          fieldType: 'signature',
          signerId: undefined,
        }),
        expect.objectContaining({ fieldType: 'date', signerId: undefined }),
        expect.objectContaining({ fieldType: 'signature', signerId: 11 }),
      ],
      manager,
    );
  });

  it('指定不屬於本文件的簽署人時拒絕，且不刪除既有欄位', async () => {
    const { service, fields } = setup();

    await expect(
      service.buildFields(
        document,
        7,
        [
          {
            ...placement,
            type: 'signature',
            signerPublicId: '7d444840-9dc0-41d8-8b3e-1c1d8f5b2a90',
          },
        ],
        manager,
      ),
    ).rejects.toBeInstanceOf(AppException);
    expect(fields.deleteDraftFields).not.toHaveBeenCalled();
  });
  it('交易內共用方法沿用已驗證文件，不重查或重複驗證', async () => {
    const { service, access } = setup();
    await service.buildFields(document, 7, [], manager);
    expect(access.checkAndLockDraftDoc).not.toHaveBeenCalled();
  });

  it('獨立儲存欄位先鎖定並驗證文件，再委派交易內方法', async () => {
    const { service, access } = setup();
    const replace = jest.spyOn(service, 'buildFields').mockResolvedValue({
      fields: [],
      source: {} as never,
      sourceMetadata: {} as never,
    });
    await service.replace(3, 7, []);
    expect(access.checkAndLockDraftDoc).toHaveBeenCalledWith(3, 7, manager);
    expect(replace).toHaveBeenCalledWith(document, 7, [], manager);
    expect(
      access.checkAndLockDraftDoc.mock.invocationCallOrder[0],
    ).toBeLessThan(replace.mock.invocationCallOrder[0]);
  });

  it('獨立儲存的鎖定驗證失敗時不得寫入欄位', async () => {
    const { service, fields, access } = setup();
    access.checkAndLockDraftDoc.mockRejectedValue(new Error('驗證失敗'));
    await expect(service.replace(3, 7, [])).rejects.toThrow('驗證失敗');
    expect(fields.deleteDraftFields).not.toHaveBeenCalled();
    expect(fields.save).not.toHaveBeenCalled();
  });
  it('回傳已儲存欄位依頁碼、排序與 ID 排序，供發起快照直接使用', async () => {
    const { service, fields } = setup();
    const savedFields = [
      { id: 24, pageNumber: 2, sortOrder: 0 },
      { id: 23, pageNumber: 1, sortOrder: 1 },
      { id: 22, pageNumber: 1, sortOrder: 0 },
      { id: 21, pageNumber: 1, sortOrder: 0 },
    ];
    fields.save.mockResolvedValueOnce(savedFields);
    const result = await service.buildFields(document, 7, [], manager);
    expect(result.fields.map((field) => field.id)).toEqual([21, 22, 23, 24]);
  });
});
