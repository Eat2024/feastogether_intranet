import { AuthorizationUserRole } from '#app/features/authorization/entities/authorization-user-role.entity';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { In } from 'typeorm';
import request from 'supertest';
import { User } from '#app/features/users/entities/user.entity';
import { AuthSession } from '#app/features/auth/entities/auth-session.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignFileObject } from '#app/features/esign/entities/esign-file-object.entity';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { createDepartmentFixtures } from './department-visibility.helper';
import { apiData, apiError } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('建立文件固定部門快照', () => {
  let ctx: SecurityE2eContext;
  let f: Awaited<ReturnType<typeof createDepartmentFixtures>>;
  let storage: PrivateFileStorage;
  let pdfBytes: Buffer;
  const origin = 'http://localhost:3000';

  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    f = await createDepartmentFixtures(ctx, 'document_creator');
    storage = ctx.app.get(PRIVATE_FILE_STORAGE);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdfBytes = Buffer.from(await pdf.save());
  });

  afterAll(async () => {
    if (f) {
      const ids = Object.values(f.users).map((user) => user.id);
      const documents = await f.manager.find(EsignDocument, {
        where: { createdByUserId: In(ids) },
        withDeleted: true,
      });
      const files = await f.manager.find(EsignFileObject, {
        where: { documentId: In(documents.map((doc) => doc.id)) },
      });
      for (const file of files) await storage.delete(file);
      await f.manager.delete(EsignFileObject, {
        id: In(files.map((file) => file.id)),
      });
      await f.manager.delete(EsignDocument, {
        id: In(documents.map((doc) => doc.id)),
      });
      await f.manager.delete(AuthSession, { userId: In(ids) });
      await f.manager.delete(AuthorizationUserRole, { userId: In(ids) });
      await f.manager.delete(User, { id: In(ids) });
    }
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  const upload = (cookie: string) =>
    request(ctx.server)
      .post('/api/esign/documents')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .field('title', '合成建立快照')
      .attach('file', pdfBytes, {
        filename: '合成.pdf',
        contentType: 'application/pdf',
      });
  const get = (id: number, cookie: string) =>
    request(ctx.server).get(`/api/esign/documents/${id}`).set('Cookie', cookie);
  async function create(cookie: string) {
    const response = await upload(cookie).expect(201);
    const data = apiData<{ id: string }>(response);
    expect(Object.keys(data)).toEqual(['id']);
    const id = Number(data.id);
    return f.manager.findOneByOrFail(EsignDocument, { id });
  }

  it('multipart 建立保存可信快照，回應僅含 ID，來源 PDF bytes 不變', async () => {
    const document = await create(f.cookies.a1);
    expect(document).toMatchObject({
      createdByUserId: f.users.a1.id,
      createdByDepartmentCode: 'A001',
      createdByDepartmentName: '合成同名部門',
    });
    const source = await f.manager.findOneByOrFail(EsignFileObject, {
      documentId: document.id,
    });
    expect(source.sha256).toBe(
      createHash('sha256').update(pdfBytes).digest('hex'),
    );
    await get(document.id, f.cookies.a2).expect(200);
    await get(document.id, f.cookies.b1).expect(404);
  });

  it.each([null, '', '   '])(
    '缺少有效代碼 %p 回 409，無文件／稽核且清除上傳檔',
    async (code) => {
      await f.manager.update(User, f.users.missing.id, {
        departmentCode: code,
      });
      const before = await f.manager.count(EsignDocument, {
        where: { createdByUserId: f.users.missing.id },
      });
      const store = jest.spyOn(storage, 'store');
      const remove = jest.spyOn(storage, 'delete');
      try {
        const response = await upload(f.cookies.missing).expect(409);
        expect(apiError(response).code).toBe('ESIGN_DEPARTMENT_UNAVAILABLE');
        expect(
          await f.manager.count(EsignDocument, {
            where: { createdByUserId: f.users.missing.id },
          }),
        ).toBe(before);
        expect(store).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        const [uploaded] = remove.mock.calls[0];
        await expect(store.mock.results[0].value).resolves.toMatchObject(
          uploaded,
        );
        if (storage.stat)
          await expect(storage.stat(uploaded)).rejects.toThrow();
      } finally {
        store.mockRestore();
        remove.mockRestore();
      }
    },
  );

  it.each([
    'departmentCode',
    'departmentId',
    'createdByDepartmentCode',
    'createdByDepartmentName',
  ])('拒絕 multipart 偽造欄位 %s，不新增文件', async (field) => {
    const before = await f.manager.count(EsignDocument, {
      where: { createdByUserId: f.users.a1.id },
    });
    await upload(f.cookies.a1).field(field, 'FORGED').expect(400);
    expect(
      await f.manager.count(EsignDocument, {
        where: { createdByUserId: f.users.a1.id },
      }),
    ).toBe(before);
  });

  it('代碼有效且名稱缺漏可建立，名稱不參與授權', async () => {
    await f.manager.update(User, f.users.b2.id, { departmentName: null });
    const document = await create(f.cookies.b2);
    expect(document).toMatchObject({
      createdByDepartmentCode: 'B001',
      createdByDepartmentName: null,
    });
    await get(document.id, f.cookies.b1).expect(200);
  });

  it('調職與改名不搬移舊文件；舊 session 建立採 DB 新值、原發起人仍可管理', async () => {
    const old = await create(f.cookies.a1);
    await f.manager.update(User, f.users.a1.id, {
      departmentCode: 'B001',
      departmentName: '調職後部門',
    });
    const current = await create(f.cookies.a1);
    expect(current).toMatchObject({
      createdByDepartmentCode: 'B001',
      createdByDepartmentName: '調職後部門',
    });
    await f.manager.update(User, f.users.a1.id, {
      departmentName: '改名後部門',
    });
    await request(ctx.server)
      .patch(`/api/esign/documents/${old.id}`)
      .set('Cookie', f.cookies.a1)
      .set('Origin', origin)
      .field('title', '調職後改標題')
      .expect(200);
    expect(
      await f.manager.findOneByOrFail(EsignDocument, { id: old.id }),
    ).toMatchObject({
      createdByUserId: f.users.a1.id,
      createdByDepartmentCode: 'A001',
      createdByDepartmentName: '合成同名部門',
    });
    expect(
      await f.manager.findOneByOrFail(EsignDocument, { id: current.id }),
    ).toMatchObject({
      createdByDepartmentCode: 'B001',
      createdByDepartmentName: '調職後部門',
    });
    await get(old.id, f.cookies.a2).expect(200);
    await get(old.id, f.cookies.b1).expect(404);
    await get(current.id, f.cookies.a2).expect(404);
    await get(current.id, f.cookies.b1).expect(200);
    const source = await request(ctx.server)
      .get(`/api/esign/documents/${old.id}/source-file`)
      .set('Cookie', f.cookies.a1)
      .expect(200);
    expect(
      createHash('sha256')
        .update(source.body as Buffer)
        .digest('hex'),
    ).toBe(createHash('sha256').update(pdfBytes).digest('hex'));
  });
});
