import { AuthorizationUserRole } from '#app/features/authorization/entities/authorization-user-role.entity';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { In } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { AuthSession } from '#app/features/auth/entities/auth-session.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import type {
  EsignDocumentDetailDto,
  EsignDocumentListItemDto,
} from '#app/features/esign/dto/esign-common.dto';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
  type StoredPrivateFile,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { createDepartmentFixtures } from './department-visibility.helper';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('電子簽部門列表與唯讀內容', () => {
  let ctx: SecurityE2eContext;
  let f: Awaited<ReturnType<typeof createDepartmentFixtures>>;
  let storage: PrivateFileStorage;
  let stored: StoredPrivateFile;
  let sourceBytes: Buffer;
  let draft: EsignDocument;
  let assigned: EsignDocument;
  let old: EsignDocument;
  let deleted: EsignDocument;
  let privateSigner: EsignSigner;
  const documentIds: number[] = [];
  const aDocuments: EsignDocument[] = [];
  const bDocuments: EsignDocument[] = [];

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    f = await createDepartmentFixtures(ctx, 'document_creator');
    storage = ctx.app.get(PRIVATE_FILE_STORAGE);
    const create = async (
      creator: User,
      overrides: Partial<EsignDocument> = {},
    ) => {
      const doc = await f.createDocument(creator, overrides);
      documentIds.push(doc.id);
      return doc;
    };
    const now = Date.now();
    for (const creator of [f.users.a1, f.users.a2, f.users.b1, f.users.b2]) {
      for (const status of [
        'draft',
        'active',
        'expired',
        'finalizing',
        'completed',
        'stopped',
      ]) {
        const doc = await create(creator, {
          status,
          signStartAt: new Date(now - 86_400_000),
          signEndAt: new Date(now + 86_400_000),
        });
        (creator.departmentCode === 'A001' ? aDocuments : bDocuments).push(doc);
      }
    }
    draft = aDocuments[0];
    old = await create(f.users.a1, { createdByDepartmentCode: null });
    deleted = await create(f.users.a1, { deletedAt: new Date() });
    await create(f.users.sameName);
    assigned = bDocuments[1];
    privateSigner = await f.manager.save(
      EsignSigner,
      f.manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: draft.id,
        signerType: 'user',
        userId: f.users.b1.id,
        empidSnapshot: f.users.b1.empid,
        nameSnapshot: '合成進度姓名',
        email: 'private@example.test',
        departmentSnapshot: '簽署人部門',
        titleSnapshot: '簽署人職稱',
        note: '管理備註',
        status: 'pending',
      }),
    );
    await f.manager.save(
      EsignSigner,
      f.manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: assigned.id,
        signerType: 'user',
        userId: f.users.a2.id,
        empidSnapshot: f.users.a2.empid,
        nameSnapshot: '跨部門本人',
        status: 'pending',
      }),
    );
    await f.manager.save(
      EsignSigner,
      f.manager.create(EsignSigner, {
        publicId: randomUUID(),
        documentId: aDocuments[1].id,
        signerType: 'user',
        userId: f.users.b1.id,
        empidSnapshot: f.users.b1.empid,
        nameSnapshot: '合成匯出姓名',
        email: 'private@example.test',
        departmentSnapshot: '簽署人部門',
        titleSnapshot: '簽署人職稱',
        note: '管理備註',
        status: 'pending',
      }),
    );
    const pdf = await PDFDocument.create();
    pdf.addPage();
    sourceBytes = Buffer.from(await pdf.save());
    stored = await storage.store({
      directory: `spec017/${randomUUID()}`,
      extension: 'pdf',
      mimeType: 'application/pdf',
      bytes: sourceBytes,
    });
    await f.manager.save(
      EsignFileObject,
      f.manager.create(EsignFileObject, {
        ...stored,
        documentId: draft.id,
        filePurpose: 'source_pdf',
        originalFileName: '合成來源.pdf',
        archiveStatus: 'active',
      }),
    );
  });

  afterAll(async () => {
    if (f) {
      await f.manager.delete(EsignFileObject, { documentId: In(documentIds) });
      await f.manager.delete(EsignSigner, { documentId: In(documentIds) });
      await f.manager.delete(EsignDocument, { id: In(documentIds) });
      const ids = Object.values(f.users).map((user) => user.id);
      await f.manager.delete(AuthSession, { userId: In(ids) });
      await f.manager.delete(AuthorizationUserRole, { userId: In(ids) });
      await f.manager.delete(User, { id: In(ids) });
    }
    if (stored) await storage.delete(stored);
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  const get = (path: string, cookie: string) =>
    request(ctx.server)
      .get(`/api/esign/documents${path}`)
      .set('Cookie', cookie);

  it('兩部門每部門兩位建立人、六種狀態精確隔離；NULL、軟刪除、同名大小寫異碼皆不混入', async () => {
    for (const [actor, expected] of [
      [f.cookies.a1, aDocuments],
      [f.cookies.a2, aDocuments],
      [f.cookies.b1, bDocuments],
      [f.cookies.b2, bDocuments],
    ] as const) {
      const docs = apiData<EsignDocumentListItemDto[]>(
        await get('?role=dep', actor).expect(200),
      );
      expect(docs.map((d) => d.id).sort()).toEqual(
        expected.map((d) => String(d.id)).sort(),
      );
      expect(new Set(docs.map((d) => d.status))).toEqual(
        new Set([
          'draft',
          'active',
          'expired',
          'finalizing',
          'completed',
          'stopped',
        ]),
      );
    }
    const a1 = apiData<EsignDocumentListItemDto[]>(
      await get('?role=dep', f.cookies.a1).expect(200),
    );
    expect(a1.find((d) => d.id === String(draft.id))?.isCreator).toBe(true);
    const a2 = apiData<EsignDocumentListItemDto[]>(
      await get('?role=dep', f.cookies.a2).expect(200),
    );
    expect(a2.find((d) => d.id === String(draft.id))?.isCreator).toBe(false);
  });

  it('保留 created／assigned／未帶 role 個人範圍，指定部門狀態只縮小結果', async () => {
    const assignedList = apiData<EsignDocumentListItemDto[]>(
      await get('?role=assigned', f.cookies.a2).expect(200),
    );
    expect(assignedList.map((d) => d.id)).toEqual([String(assigned.id)]);
    const created = apiData<EsignDocumentListItemDto[]>(
      await get('?role=created', f.cookies.a2).expect(200),
    );
    expect(created).toHaveLength(6);
    expect(created.every((d) => d.isCreator)).toBe(true);
    const combined = apiData<EsignDocumentListItemDto[]>(
      await get('', f.cookies.a2).expect(200),
    );
    expect(combined.map((d) => d.id).sort()).toEqual(
      [...created.map((d) => d.id), String(assigned.id)].sort(),
    );
    const status = apiData<EsignDocumentListItemDto[]>(
      await get('?role=dep&status=draft', f.cookies.a2).expect(200),
    );
    expect(status).toHaveLength(2);
  });

  it('同部門草稿回唯讀 DTO 與來源；建立人仍保有管理 DTO', async () => {
    const readonly = apiData<EsignDocumentDetailDto>(
      await get(`/${draft.id}`, f.cookies.a2).expect(200),
    );
    expect(readonly).toMatchObject({
      isCreator: false,
      canManage: false,
      canExport: true,
      sourceFile: { pageCount: 1 },
    });
    expect(readonly.signers).toEqual([
      {
        publicId: privateSigner.publicId,
        name: '合成進度姓名',
        status: 'pending',
        signedAt: null,
        rejectedAt: null,
      },
    ]);
    for (const key of ['fields', 'watermark', 'allowReject'])
      expect(readonly).not.toHaveProperty(key);
    const creator = apiData<EsignDocumentDetailDto>(
      await get(`/${draft.id}`, f.cookies.a1).expect(200),
    );
    expect(creator).toMatchObject({
      isCreator: true,
      canManage: true,
      signers: [{ email: 'private@example.test', note: '管理備註' }],
    });
    const source = await get(`/${draft.id}/source-file`, f.cookies.a2).expect(
      200,
    );
    expect(source.headers['cache-control']).toBe('private, no-store');
    expect(
      createHash('sha256')
        .update(source.body as Buffer)
        .digest('hex'),
    ).toBe(stored.sha256);
  });

  it('已停用歷程 API，建立人、同部門與簽署人均回 404', async () => {
    for (const cookie of [f.cookies.a1, f.cookies.a2, f.cookies.b1])
      await get(`/${draft.id}/history`, cookie).expect(404);
  });

  it('export 視角提供完整 Excel 欄位但沒有管理憑證；跨部門與缺碼拒絕', async () => {
    const result = apiData<{
      status: string;
      signers: Array<Record<string, unknown>>;
    }>(await get(`/${aDocuments[1].id}?view=export`, f.cookies.a2).expect(200));
    expect(result.status).toBe('active');
    await get(`/${draft.id}?view=export`, f.cookies.a2).expect(404);
    expect(result.signers[0]).toMatchObject({
      email: 'private@example.test',
      employeeNo: f.users.b1.empid,
      department: '簽署人部門',
      title: '簽署人職稱',
    });
    for (const key of [
      'note',
      'verificationUrl',
      'invitationDelivery',
      'publicId',
    ])
      expect(result.signers[0]).not.toHaveProperty(key);
    await get(`/${draft.id}?view=export`, f.cookies.b1).expect(404);
    await get(`/${draft.id}?view=export`, f.cookies.missing).expect(409);
    await get(`/${draft.id}?view=all`, f.cookies.a2).expect(400);
  });

  it('既有 session 讀 DB 新部門；調職建立人可管理舊文件，但無一般匯出能力', async () => {
    await f.manager.update(
      User,
      { id: f.users.a1.id },
      { departmentCode: 'B001' },
    );
    try {
      const docs = apiData<EsignDocumentListItemDto[]>(
        await get('?role=dep', f.cookies.a1).expect(200),
      );
      expect(docs.map((d) => d.id).sort()).toEqual(
        bDocuments.map((d) => String(d.id)).sort(),
      );
      const detail = apiData<EsignDocumentDetailDto>(
        await get(`/${draft.id}`, f.cookies.a1).expect(200),
      );
      expect(detail).toMatchObject({ isCreator: true, canExport: false });
      await get(`/${draft.id}?view=export`, f.cookies.a1).expect(404);
    } finally {
      await f.manager.update(
        User,
        { id: f.users.a1.id },
        { departmentCode: 'A001' },
      );
    }
  });

  it('已刪除／跨部門／未知快照的直接來源與詳情均拒絕，原建立人可讀NULL舊文件', async () => {
    for (const path of [`/${draft.id}`, `/${draft.id}/source-file`])
      await get(path, f.cookies.sameName).expect(404);
    for (const path of [
      `/${deleted.id}`,
      `/${deleted.id}/history`,
      `/${deleted.id}/source-file`,
    ])
      await get(path, f.cookies.a1).expect(404);
    await get(`/${old.id}`, f.cookies.a2).expect(404);
    expect(
      apiData<EsignDocumentDetailDto>(
        await get(`/${old.id}`, f.cookies.a1).expect(200),
      ),
    ).toMatchObject({ isCreator: true, canExport: false });
  });
});
