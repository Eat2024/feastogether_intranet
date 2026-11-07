import { AppException } from '#app/common/errors/app.exception';
import { AppErrors } from '#app/common/errors/app-errors';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { EsignDocumentQueryService } from './esign-document-query.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignViewMapper } from './esign-view.mapper';

const now = new Date();
const document = (overrides: Partial<EsignDocument> = {}) =>
  Object.assign(new EsignDocument(), {
    id: 10,
    docNumber: 'synthetic',
    title: '合成文件',
    status: 'draft',
    createdByUserId: 1,
    createdByDepartmentCode: 'A001',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
const signer = () =>
  Object.assign(new EsignSigner(), {
    id: 30,
    documentId: 10,
    publicId: 'signer-public',
    nameSnapshot: '合成簽署人',
    signerType: 'user',
    userId: 3,
    status: 'pending',
    email: 'private@example.test',
    empidSnapshot: 'PRIVATE',
    note: '管理備註',
    rejectReason: '個別理由',
  });
function setup(doc = document()) {
  const manager = {} as never;
  const documents = {
    findById: jest.fn(() => Promise.resolve(doc)),
    findListCreatedByUser: jest.fn(() => Promise.resolve([doc])),
    findListByIds: jest.fn<Promise<EsignDocument[]>, [number[], unknown]>(() =>
      Promise.resolve([]),
    ),
    findByDepartment: jest.fn(() => Promise.resolve([doc])),
  };
  const signers = {
    findByDocument: jest.fn(() => Promise.resolve([signer()])),
    countsByDocumentIds: jest.fn(() =>
      Promise.resolve(new Map([[doc.id, { pendingCount: 1, signedCount: 0 }]])),
    ),
    findAssignedToUser: jest.fn<Promise<EsignSigner[]>, [number, unknown]>(() =>
      Promise.resolve([]),
    ),
  };
  const fields = { findByDocument: jest.fn(() => Promise.resolve([])) };
  const notifications = { findBySignerIds: jest.fn(() => Promise.resolve([])) };
  const records = { findBySignerIds: jest.fn(() => Promise.resolve([])) };
  const policy = {
    requireDepartment: jest.fn(() =>
      Promise.resolve({ departmentCode: 'A001' }),
    ),
    readableForActor: jest.fn(() => Promise.resolve(doc)),
    checkDepartmentDocument: jest.fn(() => Promise.resolve(doc)),
    exportDocument: jest.fn(() => Promise.resolve(doc)),
    checkEsignCreator: jest.fn(),
    canManageDocument: jest.fn(
      (doc: EsignDocument, actor: { userId: number }) =>
        Promise.resolve(doc.createdByUserId === actor.userId),
    ),
  };
  const exports = { documentSummary: jest.fn(() => Promise.resolve(null)) };
  const users = {
    findById: jest.fn(() =>
      Promise.resolve(
        Object.assign(new User(), { id: 1, name: '建立人', empid: '001' }),
      ),
    ),
    findByIds: jest.fn(() =>
      Promise.resolve([
        Object.assign(new User(), { id: 1, name: '建立人', empid: '001' }),
      ]),
    ),
  };
  const service = new EsignDocumentQueryService(
    {
      getManager: () => manager,
      transaction: (run: (m: typeof manager) => Promise<unknown>) =>
        run(manager),
    } as never,
    documents as never,
    signers as never,
    fields as never,
    { findDocumentFile: jest.fn(() => Promise.resolve(null)) } as never,
    notifications as never,
    policy as never,
    new EsignDocumentValidationService(),
    new EsignViewMapper({ verificationUrl: () => null } as never),
    {} as never,
    {} as never,
    users as never,
    records as never,
    {} as never,
    exports as never,
    { requirePermissions: () => Promise.resolve() } as never,
  );
  return {
    service,
    users,
    exports,
    documents,
    signers,
    fields,
    notifications,
    records,
    policy,
    manager,
  };
}

describe('部門文件查詢', () => {
  it('受理摘要與舊草稿期間及正式統計分開，不改寫文件', async () => {
    const doc = Object.assign(
      document({
        signStartAt: new Date('2026-10-01T00:00:00Z'),
        signEndAt: new Date('2026-10-02T00:00:00Z'),
      }),
      {
        isInitiating: true,
        initiation: {
          signStartAt: '2026-11-03T16:00:00.000Z',
          signEndAt: '2026-11-30T15:59:59.999Z',
          totalCount: 5213,
        },
      },
    );
    const result = await setup(doc).service.list(
      { kind: 'employee', userId: 1 },
      'dep',
    );
    expect(result[0]).toMatchObject({
      status: 'initiating',
      signStartAt: '2026-10-01T00:00:00.000Z',
      signEndAt: '2026-10-02T00:00:00.000Z',
      signedCount: 0,
      pendingCount: 1,
      initiation: {
        signStartAt: '2026-11-03T16:00:00.000Z',
        signEndAt: '2026-11-30T15:59:59.999Z',
        totalCount: 5213,
      },
    });
    expect(doc.status).toBe('draft');
    expect(doc.signStartAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it.each(['draft', 'active'])(
    '沒有有效工作時 %s 不回傳受理摘要',
    async (status) => {
      const result = await setup(document({ status })).service.list(
        { kind: 'employee', userId: 1 },
        'dep',
      );
      expect(result[0]).toHaveProperty('initiation', null);
    },
  );
  it('背景發起期間顯示發起中且可篩選，原始草稿狀態不變', async () => {
    const doc = Object.assign(document(), { isInitiating: true });
    const s = setup(doc);
    expect(
      await s.service.list(
        { kind: 'employee', userId: 1 },
        'dep',
        'initiating',
      ),
    ).toEqual([expect.objectContaining({ id: '10', status: 'initiating' })]);
    expect(
      await s.service.list({ kind: 'employee', userId: 1 }, 'dep', 'draft'),
    ).toEqual([]);
    expect(doc.status).toBe('draft');
  });
  it('背景任務結束後依文件狀態顯示草稿或簽署中', async () => {
    for (const status of ['draft', 'active']) {
      const s = setup(
        Object.assign(document({ status }), { isInitiating: false }),
      );
      expect(
        await s.service.list({ kind: 'employee', userId: 1 }, 'dep'),
      ).toEqual([expect.objectContaining({ status })]);
    }
  });
  it('dep 使用可信部門 repository，保留狀態推導且回傳 isCreator', async () => {
    const s = setup(document({ status: 'active', signEndAt: new Date(0) }));
    const result = await s.service.list(
      { kind: 'employee', userId: 2 },
      'dep',
      'expired',
    );
    expect(s.documents.findByDepartment).toHaveBeenCalledWith(
      'A001',
      s.manager,
    );
    expect(s.documents.findListCreatedByUser).not.toHaveBeenCalled();
    expect(s.signers.findAssignedToUser).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({
        id: '10',
        status: 'expired',
        isCreator: false,
      }),
    ]);
  });
  it.each(['created', 'assigned', undefined] as const)(
    '個人範圍 %s 不要求部門',
    async (role) => {
      const s = setup();
      await s.service.list({ kind: 'employee', userId: 1 }, role);
      expect(s.policy.requireDepartment).not.toHaveBeenCalled();
      expect(s.documents.findByDepartment).not.toHaveBeenCalled();
    },
  );
  it('列表批次取得建立人與統計，無簽署人回傳零且不讀完整簽署人', async () => {
    const s = setup();
    s.documents.findByDepartment.mockResolvedValue([
      document(),
      document({ id: 11 }),
    ]);
    const result = await s.service.list({ kind: 'employee', userId: 2 }, 'dep');
    expect(s.users.findByIds).toHaveBeenCalledWith([1], s.manager);
    expect(s.signers.countsByDocumentIds).toHaveBeenCalledWith(
      [11, 10],
      s.manager,
    );
    expect(s.signers.findByDocument).not.toHaveBeenCalled();
    expect(s.users.findById).not.toHaveBeenCalled();
    expect(
      result.map((row) => [row.id, row.pendingCount, row.signedCount]),
    ).toEqual([
      ['11', 0, 0],
      ['10', 1, 0],
    ]);
  });

  it('本人合併列表批次查指派文件，排除草稿、去重並維持排序', async () => {
    const s = setup(document({ status: 'active' }));
    s.signers.findAssignedToUser.mockResolvedValue([
      signer(),
      Object.assign(signer(), { documentId: 11 }),
      Object.assign(signer(), { documentId: 12 }),
    ]);
    s.documents.findListByIds.mockResolvedValue([
      document({ status: 'active' }),
      document({ id: 11 }),
      document({ id: 12, status: 'completed' }),
    ]);
    const result = await s.service.list({ kind: 'employee', userId: 1 });
    expect(s.documents.findListByIds).toHaveBeenCalledWith(
      [10, 11, 12],
      s.manager,
    );
    expect(s.documents.findById).not.toHaveBeenCalled();
    expect(result.map((row) => row.id)).toEqual(['12', '10']);
  });

  it('同部門詳情只回進度白名單，且不讀管理資料', async () => {
    const s = setup();
    const result = await s.service.detail(10, { kind: 'employee', userId: 2 });
    expect(result).toMatchObject({
      isCreator: false,
      canExport: true,
      signers: [
        {
          publicId: 'signer-public',
          name: '合成簽署人',
          status: 'pending',
          signedAt: null,
          rejectedAt: null,
        },
      ],
    });
    expect(result.signers[0]).toEqual({
      publicId: 'signer-public',
      name: '合成簽署人',
      status: 'pending',
      signedAt: null,
      rejectedAt: null,
    });
    expect(result).not.toHaveProperty('fields');
    expect(s.fields.findByDocument).not.toHaveBeenCalled();
    expect(s.notifications.findBySignerIds).not.toHaveBeenCalled();
    expect(s.records.findBySignerIds).not.toHaveBeenCalled();
  });
  it('建立人詳情保留管理欄位；匯出能力獨立判斷', async () => {
    const s = setup();
    s.policy.exportDocument.mockRejectedValue(
      new AppException(...AppErrors.AUTHORIZATION_DENIED),
    );
    const result = await s.service.detail(10, { kind: 'employee', userId: 1 });
    expect(result).toMatchObject({
      isCreator: true,
      canExport: false,
      exportSummary: null,
      signers: [{ note: '管理備註', email: 'private@example.test' }],
    });
    expect(result).toHaveProperty('fields');
    expect(s.exports.documentSummary).not.toHaveBeenCalled();
  });
  it('export 視角先嚴格部門授權，使用完整 Excel DTO 而非管理詳情', async () => {
    const s = setup(document({ status: 'active' }));
    const result = await s.service.exportDocument(10, {
      kind: 'employee',
      userId: 2,
    });
    expect(s.policy.exportDocument).toHaveBeenCalledWith(
      expect.any(EsignDocument),
      { kind: 'employee', userId: 2 },
      'esign.export.read',
      s.manager,
    );
    expect(result.signers[0]).toMatchObject({
      email: 'private@example.test',
      employeeNo: 'PRIVATE',
      rejectReason: '個別理由',
    });
    expect(result.signers[0]).not.toHaveProperty('note');
    expect(s.notifications.findBySignerIds).not.toHaveBeenCalled();
  });
  it('草稿即使同部門亦不可藉匯出視角取得完整個資', async () => {
    const s = setup();
    await expect(
      s.service.exportDocument(10, { kind: 'employee', userId: 2 }),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(s.signers.findByDocument).not.toHaveBeenCalled();
  });
});
