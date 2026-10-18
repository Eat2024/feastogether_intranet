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
  const placement = {
    page: 1,
    xPercent: 10,
    yPercent: 20,
    widthPercent: 30,
    heightPercent: 15,
    sortOrder: 0,
  };

  function setup() {
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

  it('共用欄位無須簽署人即可保存，且不建立個人歸屬', async () => {
    const { service, fields } = setup();

    const result = await service.buildFields(
      document,
      7,
      [
        { ...placement, type: 'signature' },
        { ...placement, type: 'date' },
        { ...placement, type: 'signature', page: 2 },
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
    expect(result.fields.map((field) => field.fieldType)).toEqual([
      'signature',
      'date',
      'signature',
    ]);
    for (const field of result.fields)
      expect(field).not.toHaveProperty('signerId');
  });

  it('欄位超出 PDF 頁數時拒絕，且不刪除既有欄位', async () => {
    const { service, fields } = setup();

    await expect(
      service.buildFields(
        document,
        7,
        [
          {
            ...placement,
            type: 'signature',
            page: 3,
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
