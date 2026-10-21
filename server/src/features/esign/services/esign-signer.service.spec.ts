import { DocumentRepository } from '../repositories/document.repository';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignSignerService } from './esign-signer.service';
import { User } from '#app/features/users/entities/user.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import type { SignerInputDto } from '../dto/signer.dto';

describe('EsignSignerService', () => {
  const service = new EsignSignerService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    new DocumentRepository(),
  );

  it('外部簽署 Email 只做 trim + lowercase', () => {
    expect(service.normalizeEmail('  Candidate+HR@Example.COM ')).toBe(
      'candidate+hr@example.com',
    );
  });

  it('取代草稿簽署人不需修改共用欄位', async () => {
    const manager = {} as never;
    const calls: string[] = [];
    const document = Object.assign(new EsignDocument(), {
      id: 3,
      status: 'draft',
      createdByUserId: 7,
    });
    const access = { checkAndLockDraftDoc: jest.fn() };
    const signers = {
      create: jest.fn((value: object) => value),
      deleteDraftSigners: jest.fn(async () => {
        calls.push('deleteDraftSigners');
      }),
      saveMany: jest.fn(async (values: object[]) => values),
    };
    const replacing = new EsignSignerService(
      {} as never,
      signers as never,
      {} as never,
      access as never,
      { save: (value: EsignDocument) => Promise.resolve(value) } as never,
    );

    await replacing.updateSigners(
      document,
      7,
      [{ type: 'email', name: '外部簽署人', email: 'Signer@Example.test' }],
      manager,
    );

    expect(access.checkAndLockDraftDoc).not.toHaveBeenCalled();
    expect(calls).toEqual(['deleteDraftSigners']);
  });

  it.each([
    { owner: 8, status: 'draft' },
    { owner: 7, status: 'active' },
  ])('獨立更新入口拒絕越權或非草稿：%p', async ({ owner, status }) => {
    const manager = {};
    const document = Object.assign(new EsignDocument(), {
      id: 3,
      createdByUserId: owner,
      status,
    });
    const mysql = {
      transaction: (run: (manager: object) => Promise<unknown>) => run(manager),
    };
    const documents = {
      findByIdForUpdate: jest.fn().mockResolvedValue(document),
    };
    const service = new EsignSignerService(
      mysql as never,
      {} as never,
      {} as never,
      new EsignAccessPolicyService(
        new EsignDocumentValidationService(),
        documents as never,
      ),
      new DocumentRepository(),
    );
    const update = jest.spyOn(service, 'updateSigners');
    await expect(
      service.draftSave(3, 7, {
        signers: [
          { type: 'email', name: '測試', email: 'test@example.test' },
        ],
      }),
    ).rejects.toMatchObject({ status: owner !== 7 ? 404 : 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it('獨立更新入口先鎖定並驗證，再以同一交易更新', async () => {
    const manager = {};
    const document = Object.assign(new EsignDocument(), {
      id: 3,
      status: 'draft',
      createdByUserId: 7,
    });
    const events: string[] = [];
    const access = {
      checkAndLockDraftDoc: jest.fn(() => {
        events.push('lock');
        return Promise.resolve(document);
      }),
    };
    const service = new EsignSignerService(
      {
        transaction: (run: (manager: object) => Promise<unknown>) =>
          run(manager),
      } as never,
      {} as never,
      {} as never,
      access as never,
      { save: (value: EsignDocument) => Promise.resolve(value) } as never,
    );
    const update = jest
      .spyOn(service, 'updateSigners')
      .mockImplementation(() => {
        events.push('update');
        return Promise.resolve([]);
      });
    const inputs = [
      { type: 'email' as const, name: '測試', email: 'test@example.test' },
    ];
    await service.draftSave(3, 7, { signers: inputs });
    expect(access.checkAndLockDraftDoc).toHaveBeenCalledWith(3, 7, manager);
    expect(events).toEqual(['lock', 'update']);
    expect(update).toHaveBeenCalledWith(document, 7, inputs, manager);
  });
});

describe('簽署人批次查詢', () => {
  const setup = (usersFound: User[] = []) => {
    const manager = {} as never;
    const document = Object.assign(new EsignDocument(), { id: 3 });
    const users = {
      findByIds: jest.fn((ids: number[]) =>
        Promise.resolve(usersFound.filter((user) => ids.includes(user.id))),
      ),
      findById: jest.fn(),
    };
    const signers = {
      create: jest.fn((value: Partial<EsignSigner>) =>
        Object.assign(new EsignSigner(), value),
      ),
      deleteDraftSigners: jest.fn(),
      saveMany: jest.fn((values: EsignSigner[]) => Promise.resolve(values)),
    };
    const service = new EsignSignerService(
      {} as never,
      signers as never,
      users as never,
      {} as never,
      new DocumentRepository(),
    );
    const run = (inputs: SignerInputDto[]) =>
      service.updateSigners(document, 7, inputs, manager);
    return { run, users, signers, manager };
  };
  const user = (id: number) =>
    Object.assign(new User(), {
      id,
      empid: `EMP${id}`,
      name: `員工${id}`,
      isActive: true,
    });

  it('批次結果順序不同仍保留混合名單的原始順序與員工快照', async () => {
    const { run, users, manager } = setup([user(2), user(1)]);
    const result = await run([
      { type: 'user', userId: '1' },
      { type: 'email', name: ' 外部人員 ', email: ' External@Example.test ' },
      { type: 'user', userId: '2' },
    ]);
    expect(users.findByIds).toHaveBeenCalledTimes(1);
    expect(users.findByIds).toHaveBeenCalledWith([1, 2], manager);
    expect(users.findById).not.toHaveBeenCalled();
    expect(result).toMatchObject([
      { userId: 1, empidSnapshot: 'EMP1', nameSnapshot: '員工1', sortOrder: 0 },
      {
        email: 'external@example.test',
        nameSnapshot: '外部人員',
        sortOrder: 1,
      },
      { userId: 2, empidSnapshot: 'EMP2', nameSnapshot: '員工2', sortOrder: 2 },
    ]);
  });

  it('6,001 位員工分批查詢且完整保留名單', async () => {
    const found = Array.from({ length: 6001 }, (_, index) => user(index + 1));
    const { run, users } = setup(found);
    expect(
      await run(found.map(({ id }) => ({ type: 'user', userId: String(id) }))),
    ).toHaveLength(6001);
    expect(users.findByIds).toHaveBeenCalledTimes(13);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('全為外部人員時不查使用者資料庫', async () => {
    const { run, users } = setup();
    await run([
      { type: 'email', name: '外部人員', email: 'external@example.test' },
    ]);
    expect(users.findByIds).not.toHaveBeenCalled();
  });

  it.each<{ label: string; inputs: SignerInputDto[] }>([
    {
      label: '重複員工',
      inputs: [
        { type: 'user', userId: '1' },
        { type: 'user', userId: '1' },
      ],
    },
    {
      label: '無效員工 ID',
      inputs: [
        { type: 'user', userId: '1' },
        { type: 'user', userId: 'invalid' },
      ],
    },
    {
      label: '重複 Email',
      inputs: [
        { type: 'user', userId: '1' },
        { type: 'email', name: 'A', email: 'A@example.test' },
        { type: 'email', name: 'B', email: ' a@example.test ' },
      ],
    },
    {
      label: '無效 Email',
      inputs: [
        { type: 'user', userId: '1' },
        { type: 'email', name: 'A', email: 'invalid' },
      ],
    },
  ])('$label 在查詢前拒絕，不修改既有名單', async ({ inputs }) => {
    const { run, users, signers } = setup();
    await expect(run(inputs)).rejects.toMatchObject({ status: 400 });
    expect(users.findByIds).not.toHaveBeenCalled();
    expect(signers.deleteDraftSigners).not.toHaveBeenCalled();
    expect(signers.saveMany).not.toHaveBeenCalled();
  });

  it.each([
    { label: '不存在', found: [] },
    { label: '停用', found: [Object.assign(user(1), { isActive: false })] },
    {
      label: '軟刪除',
      found: [Object.assign(user(1), { deletedAt: new Date() })],
    },
  ])('員工$label仍拒絕，且不修改既有名單', async ({ found }) => {
    const { run, signers } = setup(found);
    await expect(run([{ type: 'user', userId: '1' }])).rejects.toMatchObject({
      status: 400,
    });
    expect(signers.deleteDraftSigners).not.toHaveBeenCalled();
    expect(signers.saveMany).not.toHaveBeenCalled();
  });
});

describe('草稿完整設定', () => {
  it('可保存單端與過去日期，未傳保留、null 清空', async () => {
    const document = Object.assign(new EsignDocument(), {
      id: 3,
      status: 'draft',
      createdByUserId: 7,
      signStartAt: null,
      signEndAt: null,
      watermarkEnabled: false,
      allowReject: false,
    });
    const manager = {
      findOne: () => Promise.resolve(document),
      save: (value: EsignDocument) => Promise.resolve(value),
    };
    const service = new EsignSignerService(
      {
        transaction: (run: (manager: object) => Promise<unknown>) =>
          run(manager),
      } as never,
      {} as never,
      {} as never,
      new EsignAccessPolicyService(
        new EsignDocumentValidationService(),
        new DocumentRepository(),
      ),
      new DocumentRepository(),
    );
    expect(
      await service.saveDraftSettings(3, 7, {
        signStartAt: '2020-01-01T00:00:00+08:00',
        watermark: true,
      }),
    ).toMatchObject({
      signStartAt: new Date('2019-12-31T16:00:00Z'),
      signEndAt: null,
      watermarkEnabled: true,
    });
    expect(
      await service.saveDraftSettings(3, 7, { allowReject: true }),
    ).toMatchObject({
      signStartAt: new Date('2019-12-31T16:00:00Z'),
      watermarkEnabled: true,
      allowReject: true,
    });
    expect(
      await service.saveDraftSettings(3, 7, { signStartAt: null }),
    ).toMatchObject({ signStartAt: null, watermarkEnabled: true });
  });
});
