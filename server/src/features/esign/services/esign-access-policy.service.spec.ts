import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';

describe('EsignAccessPolicyService', () => {
  const policy = new EsignAccessPolicyService(
    new EsignDocumentValidationService(),
    {} as never,
    {} as never,
    {
      active: jest.fn().mockResolvedValue(null),
      activeIdentity: jest.fn().mockResolvedValue(null),
    } as never,
  );
  const now = new Date('2026-10-13T12:00:00.000Z');
  const document = () =>
    Object.assign(new EsignDocument(), {
      id: 1,
      createdByUserId: 10,
      status: 'active',
      signStartAt: new Date('2026-10-13T00:00:00.000Z'),
      signEndAt: new Date('2026-10-14T00:00:00.000Z'),
    });

  describe('checkEsignDraftCreator', () => {
    it('本人草稿可通過，且不需要查詢或鎖定文件', () => {
      const doc = Object.assign(document(), { status: 'draft' });
      expect(() => policy.checkEsignDraftCreator(doc, 10)).not.toThrow();
    });

    it.each([
      { name: '不存在', found: () => null, userId: 10 },
      { name: '非建立人且非草稿', found: document, userId: 11 },
      {
        name: '已刪除',
        found: () => Object.assign(document(), { deletedAt: now }),
        userId: 10,
      },
    ])('$name 優先回 404，不洩漏文件狀態', ({ found, userId }) => {
      expect(() => policy.checkEsignDraftCreator(found(), userId)).toThrow(
        '找不到電子簽資源',
      );
    });

    it('本人的非草稿文件回 409', () => {
      expect(() => policy.checkEsignDraftCreator(document(), 10)).toThrow(
        '文件已發起，無法修改草稿',
      );
    });
  });

  describe('checkAndLockDraftDoc', () => {
    const manager = {} as never;
    const setup = (found: EsignDocument | null) => {
      const documents = {
        findInitiationAccess: jest.fn().mockResolvedValue(found),
        findByIdForUpdate: jest.fn(async () => found),
      };
      const locking = new EsignAccessPolicyService(
        new EsignDocumentValidationService(),
        documents as never,
        {} as never,
        {
          active: jest.fn().mockResolvedValue(null),
          activeIdentity: jest.fn().mockResolvedValue(null),
        } as never,
      );
      return { locking, documents };
    };
    const draft = () =>
      Object.assign(new EsignDocument(), {
        id: 1,
        createdByUserId: 10,
        status: 'draft',
      });

    it('在呼叫端交易內鎖定並回傳本人草稿', async () => {
      const doc = draft();
      const { locking, documents } = setup(doc);
      await expect(locking.checkAndLockDraftDoc(1, 10, manager)).resolves.toBe(
        doc,
      );
      expect(documents.findByIdForUpdate).toHaveBeenCalledWith(1, manager);
    });

    it.each([
      { name: '不存在', found: () => null, userId: 10 },
      { name: '非建立人', found: draft, userId: 11 },
    ])('$name 時回 404', async ({ found, userId }) => {
      const { locking } = setup(found());
      await expect(
        locking.checkAndLockDraftDoc(1, userId, manager),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('已發起的文件回 409', async () => {
      const { locking } = setup(Object.assign(draft(), { status: 'active' }));
      await expect(
        locking.checkAndLockDraftDoc(1, 10, manager),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  it('creator 與 internal signer 越權統一為 404', () => {
    const doc = document();
    expect(() => policy.checkEsignCreator(doc, 10)).not.toThrow();
    expect(() => policy.checkEsignCreator(doc, 11)).toThrow('找不到電子簽資源');

    const signer = Object.assign(new EsignSigner(), {
      signerType: 'user',
      userId: 20,
      documentId: 1,
    });
    expect(() => policy.assertInternalSigner(doc, signer, 20)).not.toThrow();
    expect(() => policy.assertInternalSigner(doc, signer, 21)).toThrow(
      '找不到電子簽資源',
    );
  });

  it('完成 PDF 只允許 creator 或已簽署 internal signer', () => {
    const doc = document();
    const signer = Object.assign(new EsignSigner(), {
      signerType: 'user',
      userId: 20,
      documentId: 1,
      status: 'signed',
    });
    expect(() =>
      policy.assertCreatorOrSignedInternalSigner(doc, null, 10),
    ).not.toThrow();
    expect(() =>
      policy.assertCreatorOrSignedInternalSigner(doc, signer, 20),
    ).not.toThrow();
    signer.status = 'pending';
    expect(() =>
      policy.assertCreatorOrSignedInternalSigner(doc, signer, 20),
    ).toThrow('找不到電子簽資源');
  });

  it('外部送出新簽名限邀請期限內的待簽者，已簽者統一 401', () => {
    const doc = document();
    const signer = Object.assign(new EsignSigner(), {
      signerType: 'email',
      email: 'recipient@example.test',
      invitationTokenSha256: 'a'.repeat(64),
      documentId: 1,
      status: 'pending',
      invitationExpiresAt: new Date('2026-10-14T00:00:00.000Z'),
    });
    expect(() =>
      policy.assertExternalInvitation({ document: doc, signer }, now),
    ).not.toThrow();
    signer.status = 'signed';
    expect(() =>
      policy.assertExternalInvitation({ document: doc, signer }, now),
    ).toThrow('外部簽署存取已失效');
  });

  describe('assertExternalAccess', () => {
    it.each(['pending', 'signed', 'rejected'])(
      '舊內部 %s 指派一律要求 Portal 登入，即使邀請仍有效',
      (status) => {
        const signer = Object.assign(new EsignSigner(), {
          signerType: 'user',
          userId: 20,
          documentId: 1,
          status,
          email: 'employee@example.test',
          invitationTokenSha256: 'a'.repeat(64),
          invitationExpiresAt: new Date('2026-10-14T00:00:00.000Z'),
        });
        expect(() =>
          policy.assertExternalAccess({ document: document(), signer }, now),
        ).toThrow('請登入入口網，至我的電子簽完成操作');
      },
    );
    const emailSigner = (status: 'pending' | 'signed') =>
      Object.assign(new EsignSigner(), {
        signerType: 'email',
        email: 'recipient@example.test',
        invitationTokenSha256: 'a'.repeat(64),
        documentId: 1,
        status,
        // 簽署成功時期限清為 null（esign-signing.service 的簽署寫入）
        invitationExpiresAt:
          status === 'pending' ? new Date('2026-10-14T00:00:00.000Z') : null,
      });

    it('待簽者在簽署期間內可存取', () => {
      expect(() =>
        policy.assertExternalAccess(
          { document: document(), signer: emailSigner('pending') },
          now,
        ),
      ).not.toThrow();
    });

    it.each([
      {
        name: '邀請期限已過',
        at: new Date('2026-10-14T00:00:00.000Z'),
        doc: document,
      },
      {
        name: '文件已停止',
        at: now,
        doc: () => Object.assign(document(), { status: 'stopped' }),
      },
      {
        name: '文件已到期',
        at: now,
        doc: () => Object.assign(document(), { status: 'expired' }),
      },
      {
        name: '超過簽署期間',
        at: now,
        doc: () =>
          Object.assign(document(), {
            signEndAt: new Date('2026-10-13T06:00:00.000Z'),
          }),
      },
    ])('待簽者$name時回 401', ({ at, doc }) => {
      expect(() =>
        policy.assertExternalAccess(
          { document: doc(), signer: emailSigner('pending') },
          at,
        ),
      ).toThrow('外部簽署存取已失效');
    });

    it.each(['active', 'stopped', 'expired', 'finalizing', 'completed'])(
      '已簽者在文件 %s 且超過簽署期間時仍可存取',
      (status) => {
        const afterWindow = new Date('2027-01-01T00:00:00.000Z');
        expect(() =>
          policy.assertExternalAccess(
            {
              document: Object.assign(document(), { status }),
              signer: emailSigner('signed'),
            },
            afterWindow,
          ),
        ).not.toThrow();
      },
    );

    it.each([
      {
        name: '缺固定 email 的外部簽署人',
        tamper: (signer: EsignSigner) => {
          signer.email = undefined;
        },
      },
      {
        name: '簽署人屬於其他文件',
        tamper: (signer: EsignSigner) => {
          signer.documentId = 2;
        },
      },
      {
        name: '簽署人已刪除',
        tamper: (signer: EsignSigner) => {
          signer.deletedAt = now;
        },
      },
    ])('已簽者$name時回 401', ({ tamper }) => {
      const signer = emailSigner('signed');
      tamper(signer);
      expect(() =>
        policy.assertExternalAccess({ document: document(), signer }, now),
      ).toThrow('外部簽署存取已失效');
    });

    it('文件已刪除時已簽者回 401', () => {
      expect(() =>
        policy.assertExternalAccess(
          {
            document: Object.assign(document(), { deletedAt: now }),
            signer: emailSigner('signed'),
          },
          now,
        ),
      ).toThrow('外部簽署存取已失效');
    });

    it('找不到簽署人或文件時回 401', () => {
      expect(() =>
        policy.assertExternalAccess(
          { document: null, signer: emailSigner('signed') },
          now,
        ),
      ).toThrow('外部簽署存取已失效');
      expect(() =>
        policy.assertExternalAccess(
          { document: document(), signer: null },
          now,
        ),
      ).toThrow('外部簽署存取已失效');
    });
  });

  describe('簽署期間尚未開始', () => {
    const startAt = new Date('2026-10-14T16:00:00.000Z');
    const pendingSigner = () =>
      Object.assign(new EsignSigner(), {
        signerType: 'email',
        email: 'recipient@example.test',
        invitationTokenSha256: 'a'.repeat(64),
        documentId: 1,
        status: 'pending',
        invitationExpiresAt: new Date('2026-10-20T00:00:00.000Z'),
      });
    const futureDocument = () =>
      Object.assign(document(), {
        signStartAt: startAt,
        signEndAt: new Date('2026-10-20T00:00:00.000Z'),
      });

    it('有效憑證的待簽者在開始前收到尚未開始錯誤，以台北時間告知開始時間', () => {
      expect(() =>
        policy.assertExternalInvitation(
          { document: futureDocument(), signer: pendingSigner() },
          new Date(startAt.getTime() - 1),
        ),
      ).toThrow('簽署尚未開始，請於 2026/10/15 00:00（台北時間）後簽署');
    });

    it.each([
      ['開始當下', startAt],
      ['期間內', new Date('2026-10-17T00:00:00.000Z')],
    ])('%s可以存取', (_name, at) => {
      expect(() =>
        policy.assertExternalInvitation(
          { document: futureDocument(), signer: pendingSigner() },
          at,
        ),
      ).not.toThrow();
    });

    it.each([
      {
        name: '期間結束後',
        doc: futureDocument,
        at: new Date('2026-10-20T00:00:00.000Z'),
      },
      {
        name: '文件已停止',
        doc: () => Object.assign(futureDocument(), { status: 'stopped' }),
        at: new Date('2026-10-14T00:00:00.000Z'),
      },
    ])('$name時一律回通用失效，不揭露開始時間', ({ doc, at }) => {
      expect(() =>
        policy.assertExternalInvitation(
          { document: doc(), signer: pendingSigner() },
          at,
        ),
      ).toThrow('外部簽署存取已失效');
    });
  });
});

describe('部門文件授權', () => {
  const manager = {} as never;
  const user = () =>
    Object.assign(new User(), {
      id: 10,
      isActive: true,
      departmentCode: '00Aa',
      departmentName: '合成部門',
    });
  const document = () =>
    Object.assign(new EsignDocument(), {
      id: 1,
      createdByUserId: 20,
      createdByDepartmentCode: '00Aa',
      status: 'draft',
    });
  const setup = (employee: User | null = user()) => {
    const users = {
      findById: jest.fn().mockResolvedValue(employee),
      findByIdForUpdate: jest.fn().mockResolvedValue(employee),
    };
    return {
      users,
      policy: new EsignAccessPolicyService(
        new EsignDocumentValidationService(),
        {} as never,
        users as never,
        {
          active: jest.fn().mockResolvedValue(null),
          activeIdentity: jest.fn().mockResolvedValue(null),
        } as never,
      ),
    };
  };

  it('同部門可讀但不能修改，一般匯出須獨立檢查', async () => {
    const { policy } = setup();
    const doc = document();
    await expect(policy.readableDocument(doc, 10, manager)).resolves.toBe(doc);
    await expect(
      policy.checkDepartmentDocument(doc, 10, manager),
    ).resolves.toBe(doc);
    expect(() => policy.checkEsignCreator(doc, 10)).toThrow('找不到電子簽資源');
  });
  it('代碼精確比對，不以同名、前綴或大小寫放寬', async () => {
    const { policy } = setup();
    for (const code of ['00aa', '00Aa1', '00', null]) {
      const doc = Object.assign(document(), { createdByDepartmentCode: code });
      await expect(
        policy.readableDocument(doc, 10, manager),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        policy.checkDepartmentDocument(doc, 10, manager),
      ).rejects.toMatchObject({ status: 404 });
    }
  });
  it.each([null, undefined, '', '   '])(
    '缺部門 %p 不互相授權，仍保留建立人管理',
    async (departmentCode) => {
      const { policy } = setup(Object.assign(user(), { departmentCode }));
      const doc = Object.assign(document(), {
        createdByUserId: 10,
        createdByDepartmentCode: null,
      });
      await expect(policy.requireDepartment(10, manager)).rejects.toMatchObject(
        { status: 409, code: 'ESIGN_DEPARTMENT_UNAVAILABLE' },
      );
      await expect(policy.readableDocument(doc, 10, manager)).resolves.toBe(
        doc,
      );
      await expect(
        policy.checkDepartmentDocument(doc, 10, manager),
      ).rejects.toMatchObject({ status: 409 });
      await expect(policy.canExportDocument(doc, 10, manager)).resolves.toBe(
        false,
      );
    },
  );
  it('調職建立人可管理舊文件但不可一般匯出', async () => {
    const { policy, users } = setup();
    const doc = Object.assign(document(), { createdByUserId: 10 });
    users.findById.mockResolvedValue(
      Object.assign(user(), { departmentCode: 'NEW' }),
    );
    await expect(policy.readableDocument(doc, 10, manager)).resolves.toBe(doc);
    await expect(
      policy.checkDepartmentDocument(doc, 10, manager),
    ).rejects.toMatchObject({ status: 404 });
    await expect(policy.canExportDocument(doc, 10, manager)).resolves.toBe(
      false,
    );
  });
  it.each([
    null,
    Object.assign(user(), { isActive: false }),
    Object.assign(user(), { deletedAt: new Date() }),
  ])('無效員工不得因建立人身分讀取', async (employee) => {
    const { policy } = setup(employee);
    await expect(
      policy.readableDocument(
        Object.assign(document(), { createdByUserId: 10 }),
        10,
        manager,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(policy.requireDepartment(10, manager)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('已刪除與不存在的文件拒絕', async () => {
    const { policy } = setup();
    for (const doc of [
      null,
      Object.assign(document(), { deletedAt: new Date() }),
    ]) {
      await expect(
        policy.readableDocument(doc, 10, manager),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        policy.checkDepartmentDocument(doc, 10, manager),
      ).rejects.toMatchObject({ status: 404 });
    }
  });
  it('建立交易先鎖 User，回傳可信代碼且保留前導零', async () => {
    const { policy, users } = setup();
    await expect(
      policy.requireDepartment(10, manager, true),
    ).resolves.toMatchObject({ departmentCode: '00Aa' });
    expect(users.findByIdForUpdate).toHaveBeenCalledWith(10, manager);
    expect(users.findById).not.toHaveBeenCalled();
  });
});

describe('actor 精確能力與範圍', () => {
  const actor = { kind: 'employee' as const, userId: 20 };
  const manager = {} as never;
  const doc = Object.assign(new EsignDocument(), {
    id: 1,
    createdByUserId: 10,
    createdByDepartmentCode: 'A',
    status: 'draft',
  });
  const setup = (permissions: string[], currentDoc = { ...doc }) => {
    const granted = new Set(permissions);
    const policy = new EsignAccessPolicyService(
      new EsignDocumentValidationService({} as never),
      { findByIdForUpdate: () => Promise.resolve(currentDoc) } as never,
      {
        findById: () =>
          Promise.resolve({ id: 20, isActive: true, departmentCode: 'B' }),
      } as never,
      { activeIdentity: () => Promise.resolve(null) } as never,
      {
        requirePermissions: (_actor: unknown, keys: string[]) =>
          keys.every((key) => granted.has(key))
            ? Promise.resolve()
            : Promise.reject(
                new AppException(...AppErrors.AUTHORIZATION_DENIED),
              ),
      } as never,
    );
    return { policy, granted };
  };
  it('read-all 只放寬讀範圍，不授予 manage；manage-all 仍需 manage', async () => {
    const { policy } = setup([
      'esign.document.read',
      'esign.document.read-all',
      'esign.document.manage-all',
    ]);
    await expect(policy.readableForActor(doc, actor, manager)).resolves.toBe(
      doc,
    );
    await expect(
      policy.manageableDocument(doc, actor, manager),
    ).rejects.toMatchObject({ status: 403 });
    await expect(policy.canManageDocument(doc, actor, manager)).resolves.toBe(
      false,
    );
  });
  it('manage 不放寬他人範圍；manage-all 不隱含 read-all', async () => {
    const { policy, granted } = setup([
      'esign.document.read',
      'esign.document.manage',
    ]);
    await expect(
      policy.manageableDocument(doc, actor, manager),
    ).rejects.toMatchObject({ status: 404 });
    granted.add('esign.document.manage-all');
    await expect(policy.manageableDocument(doc, actor, manager)).resolves.toBe(
      doc,
    );
    await expect(
      policy.readableForActor(doc, actor, manager),
    ).rejects.toMatchObject({ status: 404 });
    granted.delete('esign.document.manage');
    await expect(
      policy.lockManagedDraft(1, actor, manager),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('Super 也依操作能力授權，且範圍例外不跳過草稿狀態', async () => {
    const { policy, granted } = setup(
      ['esign.document.manage', 'esign.document.manage-all'],
      { ...doc, status: 'active' },
    );
    await expect(
      policy.lockManagedDraft(1, { kind: 'super_user' }, manager),
    ).rejects.toMatchObject({ status: 409 });
    granted.clear();
    await expect(
      policy.manageableDocument(doc, { kind: 'super_user' }, manager),
    ).rejects.toMatchObject({ status: 403 });
  });
});
