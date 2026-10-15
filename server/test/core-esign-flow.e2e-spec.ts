import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { NestFactory } from '@nestjs/core';
import type { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { apiData } from './api-response.helper';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { WorkerModule } from '#app/worker.module';
import { DocumentFinalizationProcessor } from '#app/worker/esign/document-finalization.processor';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

interface LaunchView {
  launchUrl: string;
}

interface DocumentDetail {
  id: string;
  status: string;
  sourceFile: { pageCount: number; sha256: string };
  signers: Array<{ publicId: string }>;
}

describe('核心電子簽 US1', () => {
  const creatorEmpid = 'E2E00301';
  const outsiderEmpid = 'E2E00302';
  const signerEmpid = 'E2E00303';
  // 本地沒有、由饗賓人 API（測試中為 stub）匯入的完整八碼員編
  const importedEmpid = '99030401';
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let storage: PrivateFileStorage;
  let tokenService: EsignTokenService;
  let creatorCookie: string;
  let outsiderCookie: string;
  let signerCookie: string;
  const documentIds: number[] = [];

  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        lookupEligibleStaff: jest.fn(async (empid: string) => ({
          person_empid: empid,
          person_name: empid === creatorEmpid ? '建立人' : '未參與員工',
          person_status: 1,
          person_status_name: '正式',
          department_id: 'D003',
          department_name: '測試部',
          title: '測試員工',
        })),
      }),
    );
    db = ctx.app.get<DataSource>(MYSQL_MAIN);
    storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    tokenService = ctx.app.get(EsignTokenService);
    creatorCookie = await login(creatorEmpid);
    outsiderCookie = await login(outsiderEmpid);
    signerCookie = await login(signerEmpid);
  });

  afterAll(async () => {
    for (const documentId of documentIds) {
      const files = await db.query<
        Array<{ object_key: string; object_version?: string }>
      >(
        `SELECT f.object_key, f.object_version FROM esign_file_objects f
         LEFT JOIN esign_signature_records r ON r.id = f.signature_record_id
         LEFT JOIN esign_signers s ON s.id = r.signer_id
         WHERE f.document_id = ? OR s.document_id = ?`,
        [documentId, documentId],
      );
      await db.query('DELETE FROM esign_audit_events WHERE document_id = ?', [
        documentId,
      ]);
      await db.query(
        'DELETE FROM esign_notification_logs WHERE batch_id IN (SELECT id FROM esign_notification_batches WHERE document_id = ?)',
        [documentId],
      );
      await db.query(
        'DELETE FROM esign_notification_batches WHERE document_id = ?',
        [documentId],
      );
      await db.query(
        `DELETE f FROM esign_file_objects f
         LEFT JOIN esign_signature_records r ON r.id = f.signature_record_id
         LEFT JOIN esign_signers s ON s.id = r.signer_id
         WHERE f.document_id = ? OR s.document_id = ?`,
        [documentId, documentId],
      );
      await db.query(
        'DELETE FROM esign_signature_records WHERE signer_id IN (SELECT id FROM esign_signers WHERE document_id = ?)',
        [documentId],
      );
      await db.query(
        'DELETE FROM esign_document_fields WHERE document_id = ?',
        [documentId],
      );
      await db.query('DELETE FROM esign_signers WHERE document_id = ?', [
        documentId,
      ]);
      await db.query('DELETE FROM esign_documents WHERE id = ?', [documentId]);
      await Promise.all(
        files.map((file) =>
          storage.delete({
            objectKey: file.object_key,
            objectVersion: file.object_version,
          }),
        ),
      );
    }
    await db.query(
      'DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE empid IN (?, ?, ?))',
      [creatorEmpid, outsiderEmpid, signerEmpid],
    );
    await db.query('DELETE FROM users WHERE empid IN (?, ?, ?, ?)', [
      creatorEmpid,
      outsiderEmpid,
      signerEmpid,
      importedEmpid,
    ]);
    await closeSecurityE2eApp(ctx);
  });

  it('一次發起可從空草稿完成設定；失敗完整回滾既有名單、欄位與通知', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(await request(ctx.server)
      .post('/api/esign/documents').set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000').field('title', '原子發起測試')
      .attach('file', Buffer.from(await pdf.save()), { filename: 'atomic.pdf', contentType: 'application/pdf' }).expect(201));
    const id = Number(created.id);
    documentIds.push(id);
    const field = { signerIndex: 0, type: 'signature', page: 1, xPercent: 10, yPercent: 10, widthPercent: 25, heightPercent: 10, sortOrder: 0 };
    const input = {
      signers: [{ type: 'email', name: '原子測試', email: 'atomic@example.test' }], fields: [field],
      signStartAt: new Date(Date.now() - 60_000).toISOString(), signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
      watermark: false, allowReject: false,
    };
    const initiate = (body: object, cookie = creatorCookie) => request(ctx.server)
      .post(`/api/esign/documents/${id}/initiations`).set('Cookie', cookie).set('Origin', 'http://localhost:3000').send(body);
    const detail = async () => apiData<DocumentDetail>(await request(ctx.server).get(`/api/esign/documents/${id}`).set('Cookie', creatorCookie).expect(200));
    const empty = await detail();
    await initiate({ signStartAt: input.signStartAt, signEndAt: input.signEndAt }).expect(400);
    await initiate(input, outsiderCookie).expect(404);
    await initiate({ ...input, fields: [{ ...field, type: 'date' }] }).expect(400);
    expect(await detail()).toEqual(empty);
    // 先存一份草稿設定，後續發起失敗不得刪掉這份設定。
    const saved = apiData<Array<{ publicId: string }>>(await request(ctx.server)
      .put(`/api/esign/documents/${id}/draftSave`).set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000')
      .send({ signers: input.signers }).expect(200));
    const { signerIndex: _index, ...placement } = field;
    await request(ctx.server).put(`/api/esign/documents/${id}/fields`).set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000')
      .send({ fields: [{ ...placement, signerPublicId: saved[0].publicId }] }).expect(200);
    const before = await detail();
    for (const invalid of [
      { ...input, fields: [{ ...field, signerIndex: 1 }] },
      { ...input, fields: [{ ...field, page: 2 }] },
      { ...input, fields: [{ ...field, type: 'date' }] },
      { ...input, signers: [input.signers[0], input.signers[0]] },
      { ...input, watermark: 'true' },
    ]) {
      await initiate(invalid).expect(400);
      expect(await detail()).toEqual(before);
    }
    const saveLogs = jest.spyOn(ctx.app.get(NotificationRepository), 'saveLogs')
      .mockRejectedValueOnce(new Error('測試通知寫入失敗'));
    try {
      await initiate(input).expect(500);
    } finally {
      saveLogs.mockRestore();
    }
    expect(await detail()).toEqual(before);
    const batches = await db.query<Array<{ count: number }>>('SELECT COUNT(*) count FROM esign_notification_batches WHERE document_id = ?', [id]);
    expect(Number(batches[0].count)).toBe(0);
    const results = await Promise.all([initiate(input), initiate(input)]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const active = await detail();
    expect(active.status).toBe('active');
    expect(active.signers).toHaveLength(1);
    const activeBatches = await db.query<Array<{ count: number }>>('SELECT COUNT(*) count FROM esign_notification_batches WHERE document_id = ?', [id]);
    expect(Number(activeBatches[0].count)).toBe(1);
    const fresh = apiData<{ id: string }>(await request(ctx.server)
      .post('/api/esign/documents').set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000')
      .field('title', '不先儲存設定').attach('file', Buffer.from(await pdf.save()), { filename: 'fresh.pdf', contentType: 'application/pdf' }).expect(201));
    documentIds.push(Number(fresh.id));
    const freshResult = apiData<DocumentDetail>(await request(ctx.server)
      .post(`/api/esign/documents/${fresh.id}/initiations`).set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000').send({ ...input, watermark: true, allowReject: true }).expect(201));
    expect(freshResult.status).toBe('active');
    expect(freshResult.signers).toHaveLength(1);
    const options = await db.query<Array<{ id: number; watermark_enabled: number; allow_reject: number }>>(
      'SELECT id, watermark_enabled, allow_reject FROM esign_documents WHERE id IN (?, ?) ORDER BY id', [id, Number(fresh.id)]);
    expect(options.map((row) => [Number(row.watermark_enabled), Number(row.allow_reject)])).toEqual([[0, 0], [1, 1]]);
  });

  it('刪除草稿：軟刪除並寫入稽核，之後查無此文件；已發起的文件不可刪除', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const create = async (title: string) => Number(apiData<{ id: string }>(await request(ctx.server)
      .post('/api/esign/documents').set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000')
      .field('title', title).attach('file', bytes, { filename: 'delete.pdf', contentType: 'application/pdf' }).expect(201)).id);
    const remove = (id: number) => request(ctx.server)
      .delete(`/api/esign/documents/${id}`).set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000');

    const draftId = await create('刪除草稿測試');
    documentIds.push(draftId);
    await remove(draftId).expect(204);
    await request(ctx.server).get(`/api/esign/documents/${draftId}`).set('Cookie', creatorCookie).expect(404);
    const events = await db.query<Array<{ event_type: string }>>(
      'SELECT event_type FROM esign_audit_events WHERE document_id = ? ORDER BY id', [draftId]);
    expect(events.map((event) => event.event_type)).toEqual(['document.created', 'document.draft_deleted']);

    const activeId = await create('已發起不可刪除');
    documentIds.push(activeId);
    await request(ctx.server).post(`/api/esign/documents/${activeId}/initiations`).set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000').send({
        signers: [{ type: 'email', name: '刪除測試', email: 'delete-test@example.test' }],
        fields: [{ signerIndex: 0, type: 'signature', page: 1, xPercent: 10, yPercent: 10, widthPercent: 25, heightPercent: 10, sortOrder: 0 }],
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      }).expect(201);
    await remove(activeId).expect(409);
  });

  it('簽署人候選：本地沒有的完整員編改查饗賓人 API 並建立帳號，之後直接由本地取得', async () => {
    await db.query('DELETE FROM users WHERE empid = ?', [importedEmpid]);
    const hr = ctx.app.get<{ lookupEligibleStaff: jest.Mock }>(FeastogetherHrService);
    hr.lookupEligibleStaff.mockClear();
    const search = async (q: string) => apiData<Array<{ id: string; employeeNo: string; name: string }>>(
      await request(ctx.server).get('/api/esign/signer-candidates').query({ q }).set('Cookie', creatorCookie).expect(200));

    const first = await search(importedEmpid);
    expect(first).toEqual([expect.objectContaining({ employeeNo: importedEmpid, name: '未參與員工' })]);
    expect(hr.lookupEligibleStaff).toHaveBeenCalledWith(importedEmpid);
    const rows = await db.query<Array<{ is_active: number }>>('SELECT is_active FROM users WHERE empid = ?', [importedEmpid]);
    expect(rows.map((row) => Number(row.is_active))).toEqual([1]);

    // 已匯入的帳號由本地取得；不是完整員編的查詢也不呼叫饗賓人 API
    expect((await search(importedEmpid)).map((c) => c.id)).toEqual([first[0].id]);
    await search(importedEmpid.slice(0, 5));
    expect(hr.lookupEligibleStaff).toHaveBeenCalledTimes(1);
  });

  it('先存未指派的簽名與日期欄位，設定簽署人後欄位保留，發起時再指派', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const created = apiData<{ id: string }>(await request(ctx.server)
      .post('/api/esign/documents').set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000').field('title', '先放欄位測試')
      .attach('file', Buffer.from(await pdf.save()), { filename: 'fields-first.pdf', contentType: 'application/pdf' }).expect(201));
    const id = Number(created.id);
    documentIds.push(id);
    type FieldView = { signerPublicId: string | null; type: string; page: number };
    const detail = async () => apiData<DocumentDetail & { fields: FieldView[] }>(await request(ctx.server)
      .get(`/api/esign/documents/${id}`).set('Cookie', creatorCookie).expect(200));
    const placements = [
      { type: 'signature', page: 1, xPercent: 10, yPercent: 10, widthPercent: 25, heightPercent: 10, sortOrder: 0 },
      { type: 'date', page: 1, xPercent: 40, yPercent: 10, widthPercent: 20, heightPercent: 5, sortOrder: 1 },
      { type: 'signature', page: 2, xPercent: 10, yPercent: 60, widthPercent: 25, heightPercent: 10, sortOrder: 2 },
    ];
    const savedFields = apiData<FieldView[]>(await request(ctx.server)
      .put(`/api/esign/documents/${id}/fields`).set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000')
      .send({ fields: placements }).expect(200));
    expect(savedFields.map((field) => field.signerPublicId)).toEqual([null, null, null]);

    const signers = [
      { type: 'email', name: '先放欄位甲', email: 'fields-first-a@example.test' },
      { type: 'email', name: '先放欄位乙', email: 'fields-first-b@example.test' },
    ];
    await request(ctx.server).put(`/api/esign/documents/${id}/draftSave`).set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000').send({ signers }).expect(200);
    const draft = await detail();
    expect(draft.fields.map(({ type, page, signerPublicId }) => ({ type, page, signerPublicId }))).toEqual([
      { type: 'signature', page: 1, signerPublicId: null },
      { type: 'date', page: 1, signerPublicId: null },
      { type: 'signature', page: 2, signerPublicId: null },
    ]);

    const initiate = (fields: object[]) => request(ctx.server)
      .post(`/api/esign/documents/${id}/initiations`).set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000')
      .send({ signers, fields, signStartAt: new Date(Date.now() - 60_000).toISOString(), signEndAt: new Date(Date.now() + 86_400_000).toISOString(), watermark: false, allowReject: false });
    // 發起時每個欄位都必須指派簽署人
    await initiate(placements).expect(400);
    expect(await detail()).toEqual(draft);
    await initiate(placements.map((placement) => ({ ...placement, signerIndex: placement.page === 2 ? 1 : 0 }))).expect(201);
    const active = await detail();
    expect(active.status).toBe('active');
    expect(active).toMatchObject({ createdBy: { name: '建立人', employeeNo: creatorEmpid } });
    expect(active.fields.map((field) => field.signerPublicId)).toEqual([
      active.signers[0].publicId,
      active.signers[0].publicId,
      active.signers[1].publicId,
    ]);

    // 列表帶出簽署期間與建立人
    const list = apiData<Array<{ id: string; signStartAt: string | null; signEndAt: string | null; createdBy: unknown }>>(
      await request(ctx.server).get('/api/esign/documents').query({ role: 'created' }).set('Cookie', creatorCookie).expect(200));
    const item = list.find((d) => d.id === String(id));
    expect(item).toMatchObject({ createdBy: { name: '建立人', employeeNo: creatorEmpid } });
    expect(item?.signStartAt).toEqual(expect.any(String));
    expect(item?.signEndAt).toEqual(expect.any(String));
  });

  it('上傳 PDF 可一併帶欄位；PATCH 可只換欄位或連同新 PDF 一起換，欄位不合法時整筆不寫入', async () => {
    const twoPages = await PDFDocument.create();
    twoPages.addPage();
    twoPages.addPage();
    const twoPageBytes = Buffer.from(await twoPages.save());
    const onePage = await PDFDocument.create();
    onePage.addPage();
    const onePageBytes = Buffer.from(await onePage.save());
    const placements = [
      { type: 'signature', page: 2, xPercent: 10, yPercent: 60, widthPercent: 25, heightPercent: 10, sortOrder: 0 },
      { type: 'date', page: 2, xPercent: 40, yPercent: 60, widthPercent: 20, heightPercent: 5, sortOrder: 1 },
    ];
    const upload = (title: string, fields: object[]) => request(ctx.server)
      .post('/api/esign/documents').set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000')
      .field('title', title).field('fields', JSON.stringify(fields))
      .attach('file', twoPageBytes, { filename: 'with-fields.pdf', contentType: 'application/pdf' });

    const rejectedTitle = `欄位不合法-${randomUUID()}`;
    await upload(rejectedTitle, [{ ...placements[0], page: 3 }]).expect(400);
    const leaked = await db.query<Array<{ count: number }>>('SELECT COUNT(*) count FROM esign_documents WHERE title = ?', [rejectedTitle]);
    expect(Number(leaked[0].count)).toBe(0);

    const created = apiData<{ id: string }>(await upload('一次上傳含欄位', placements).expect(201));
    const id = Number(created.id);
    documentIds.push(id);
    type FieldView = { signerPublicId: string | null; type: string; page: number };
    const detail = async () => apiData<DocumentDetail & { fields: FieldView[] }>(await request(ctx.server)
      .get(`/api/esign/documents/${id}`).set('Cookie', creatorCookie).expect(200));
    const summary = (fields: FieldView[]) => fields.map(({ type, page, signerPublicId }) => ({ type, page, signerPublicId }));
    expect(summary((await detail()).fields)).toEqual([
      { type: 'signature', page: 2, signerPublicId: null },
      { type: 'date', page: 2, signerPublicId: null },
    ]);

    const patch = () => request(ctx.server).patch(`/api/esign/documents/${id}`).set('Cookie', creatorCookie).set('Origin', 'http://localhost:3000');
    await patch().field('fields', JSON.stringify([placements[1]])).expect(200);
    expect(summary((await detail()).fields)).toEqual([{ type: 'date', page: 2, signerPublicId: null }]);

    const before = await detail();
    await patch().field('fields', JSON.stringify([{ ...placements[0], page: 3 }])).expect(400);
    // 新 PDF 只有 1 頁，第 2 頁的欄位不合法：PDF 與欄位都不得替換
    await patch().field('fields', JSON.stringify(placements))
      .attach('file', onePageBytes, { filename: 'one-page.pdf', contentType: 'application/pdf' }).expect(400);
    expect(await detail()).toEqual(before);

    await patch().field('fields', JSON.stringify([{ ...placements[0], page: 1 }]))
      .attach('file', onePageBytes, { filename: 'one-page.pdf', contentType: 'application/pdf' }).expect(200);
    const replaced = await detail();
    expect(replaced.sourceFile.pageCount).toBe(1);
    expect(summary(replaced.fields)).toEqual([{ type: 'signature', page: 1, signerPublicId: null }]);
  });

  it('建立、設定外部 signer/field、發起與鎖定，且越權統一 404', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());

    const createdResponse = await request(ctx.server)
      .post('/api/esign/documents')
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .field('title', 'Spec 03 測試文件')
      .attach('file', bytes, {
        filename: 'source.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const createdId = apiData<{ id: string }>(createdResponse).id;
    expect(apiData(createdResponse)).toEqual({ id: createdId });
    const created = apiData<DocumentDetail>(await request(ctx.server)
      .get(`/api/esign/documents/${createdId}`)
      .set('Cookie', creatorCookie).expect(200));
    const documentId = Number(created.id);
    documentIds.push(documentId);
    expect(created.status).toBe('draft');
    expect(created.sourceFile.pageCount).toBe(1);

    const preview = await request(ctx.server)
      .get(`/api/esign/documents/${documentId}/source-file`)
      .set('Cookie', creatorCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    expect(preview.headers['x-frame-options']).toBeUndefined();
    expect(preview.headers['content-security-policy']).toContain(
      "frame-ancestors 'self'",
    );
    for (const origin of (process.env.AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .filter(Boolean)) {
      expect(preview.headers['content-security-policy']).toContain(
        new URL(origin.trim()).origin,
      );
    }
    await request(ctx.server)
      .get(`/api/esign/documents/${documentId}/source-file`)
      .expect(401)
      .expect('X-Frame-Options', 'DENY');
    await request(ctx.server)
      .get(`/api/esign/documents/${documentId}/source-file`)
      .set('Cookie', outsiderCookie)
      .expect(404)
      .expect('X-Frame-Options', 'DENY');

    await request(ctx.server)
      .get(`/api/esign/documents/${documentId}`)
      .set('Cookie', outsiderCookie)
      .expect(404);

    const signersResponse = await request(ctx.server)
      .put(`/api/esign/documents/${documentId}/draftSave`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: [
          {
            type: 'email',
            name: '外部簽署人',
            email: 'Candidate@Example.test',
          },
        ],
      })
      .expect(200);
    const signers =
      apiData<Array<{ publicId: string; email: string }>>(signersResponse);
    expect(signers[0].email).toBe('candidate@example.test');

    await request(ctx.server)
      .put(`/api/esign/documents/${documentId}/fields`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        fields: [
          {
            signerPublicId: signers[0].publicId,
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 10,
            widthPercent: 25,
            heightPercent: 10,
            sortOrder: 0,
          },
        ],
      })
      .expect(200);

    const initiatedResponse = await request(ctx.server)
      .post(`/api/esign/documents/${documentId}/initiations`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: [{ type: 'email', name: '外部簽署人', email: 'Candidate@Example.test' }],
        fields: Array.from({ length: 1 }, (_, index) => ({ signerIndex: index, type: 'signature', page: 1, xPercent: 10, yPercent: 10 + index * 20, widthPercent: 25, heightPercent: 10, sortOrder: index })),
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      })
      .expect(201);
    expect(apiData<DocumentDetail>(initiatedResponse).status).toBe('active');
    signers[0].publicId = apiData<DocumentDetail>(initiatedResponse).signers[0].publicId;

    await request(ctx.server)
      .patch(`/api/esign/documents/${documentId}`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .field('title', '不得修改')
      .expect(409);

    const rows = await db.query<
      Array<{ status: string; batch_count: number; log_count: number }>
    >(
      `SELECT d.status,
        (SELECT COUNT(*) FROM esign_notification_batches b WHERE b.document_id = d.id) batch_count,
        (SELECT COUNT(*) FROM esign_notification_logs l JOIN esign_signers s ON s.id = l.signer_id WHERE s.document_id = d.id) log_count
       FROM esign_documents d WHERE d.id = ?`,
      [documentId],
    );
    expect(rows[0]).toMatchObject({
      status: 'active',
      batch_count: 1,
      log_count: 1,
    });
    const initiatedAudits = await db.query<
      Array<{
        event_type: string;
        signer_id: number | null;
        metadata_json: Record<string, unknown> | null;
      }>
    >(
      `SELECT event_type, signer_id, metadata_json
       FROM esign_audit_events WHERE document_id = ? ORDER BY id`,
      [documentId],
    );
    expect(initiatedAudits.map((event) => event.event_type)).toEqual([
      'document.created',
      'signer.assigned',
      'document.initiated',
    ]);
    expect(initiatedAudits[1].signer_id).not.toBeNull();
    expect(JSON.stringify(initiatedAudits)).not.toMatch(
      /candidate@example|token|sourceIp|userAgent|pngDataUrl/i,
    );

    const credentials = await db.query<
      Array<{ invitation_token_ciphertext: string }>
    >(
      'SELECT invitation_token_ciphertext FROM esign_signers WHERE document_id = ?',
      [documentId],
    );
    const invitationToken = tokenService.decrypt(
      credentials[0].invitation_token_ciphertext,
    );
    const bridge = await request(ctx.server)
      .get(`/api/external-signature-invitations/${invitationToken}`)
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Referrer-Policy', 'no-referrer');
    expect(bridge.headers['set-cookie']).toBeUndefined();

    const session = await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token: invitationToken })
      .expect(303);
    const externalCookie = firstCookie(session.headers['set-cookie']);
    expect(externalCookie).toContain('FT_ESIGN_EXTERNAL_ACCESS=');
    expect(externalCookie).toContain('HttpOnly');
    expect(externalCookie).toContain('SameSite=Lax');

    const externalPreview = await request(ctx.server)
      .get('/api/external-signing-task/source-file')
      .set('Cookie', externalCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect('Cache-Control', 'private, no-store')
      .expect('Content-Security-Policy', "frame-ancestors 'self';");
    expect(externalPreview.headers['x-frame-options']).toBeUndefined();
    await request(ctx.server)
      .get('/api/external-signing-task/source-file')
      .expect(401)
      .expect('X-Frame-Options', 'DENY');

    const taskResponse = await request(ctx.server)
      .post('/api/external-signing-task')
      .set('Cookie', externalCookie)
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    const task = apiData<{
      fields: Array<{ id: string; type: string }>;
      consent: { version: string };
    }>(taskResponse);
    const signatureField = task.fields.find(
      (field) => field.type === 'signature',
    );
    expect(signatureField).toBeDefined();

    const signatureRequestId = randomUUID();
    const signatureSubmission = {
      requestId: signatureRequestId,
      consentVersion: task.consent.version,
      accepted: true,
      signatures: [
        {
          fieldId: signatureField!.id,
          pngDataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
        },
      ],
    };
    const repeatedCalls = await Promise.all(
      [0, 1].map(() =>
        request(ctx.server)
          .post('/api/external-signing-task/signatures')
          .set('Cookie', externalCookie)
          .set('Origin', 'http://localhost:3000')
          .send(signatureSubmission),
      ),
    );
    expect(repeatedCalls.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    const signed = repeatedCalls.find((response) => response.status === 201)!;
    const signedBody = apiData<Record<string, unknown>>(signed);
    expect(signedBody).toMatchObject({ documentStatus: 'active' });
    expect(signedBody).not.toHaveProperty('receiptToken');
    expect(firstCookie(signed.headers['set-cookie'])).toContain(
      'FT_ESIGN_EXTERNAL_ACCESS=;',
    );
    expect(String(signed.headers['set-cookie'])).toContain(
      'FT_ESIGN_EXTERNAL_RECEIPT=',
    );
    const receiptCookie = cookieNamed(
      signed.headers['set-cookie'],
      'FT_ESIGN_EXTERNAL_RECEIPT',
    );

    const signingAudits = await db.query<
      Array<{ event_type: string; request_id: string | null }>
    >(
      `SELECT event_type, request_id FROM esign_audit_events
       WHERE document_id = ? AND request_id = ? ORDER BY id`,
      [documentId, signatureRequestId],
    );
    expect(signingAudits).toEqual([
      { event_type: 'consent.accepted', request_id: signatureRequestId },
      { event_type: 'signature.submitted', request_id: signatureRequestId },
      { event_type: 'signature.completed', request_id: signatureRequestId },
    ]);
    const signingRows = await db.query<
      Array<{ record_count: number; file_count: number }>
    >(
      `SELECT
        (SELECT COUNT(*) FROM esign_signature_records WHERE signer_id IN (SELECT id FROM esign_signers WHERE document_id = ?)) record_count,
        (SELECT COUNT(*) FROM esign_file_objects WHERE signature_record_id IN (SELECT id FROM esign_signature_records WHERE signer_id IN (SELECT id FROM esign_signers WHERE document_id = ?))) file_count`,
      [documentId, documentId],
    );
    expect(Number(signingRows[0].record_count)).toBe(1);
    expect(Number(signingRows[0].file_count)).toBe(1);

    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', externalCookie)
      .set('Origin', 'http://localhost:3000')
      .send(signatureSubmission)
      .expect(200);

    await request(ctx.server)
      .post('/api/external-signing-task')
      .set('Cookie', externalCookie)
      .set('Origin', 'http://localhost:3000')
      .expect(401);

    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await worker.get(DocumentFinalizationProcessor).process({
        data: { documentId },
      } as Job<{ documentId: number }>);
    } finally {
      await worker.close();
    }

    const completed = await db.query<Array<{ status: string }>>(
      'SELECT status FROM esign_documents WHERE id = ?',
      [documentId],
    );
    expect(completed[0]?.status).toBe('completed');
    await request(ctx.server)
      .get(`/api/esign/documents/${documentId}/completed-file`)
      .set('Cookie', creatorCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    await request(ctx.server)
      .get(`/api/esign/documents/${documentId}/completed-file`)
      .set('Cookie', outsiderCookie)
      .expect(404);
    const completionStatus = await request(ctx.server)
      .get(`/api/external-completions/${signers[0].publicId}`)
      .set('Cookie', receiptCookie)
      .expect(200);
    expect(apiData<{ status: string }>(completionStatus).status).toBe(
      'completed',
    );
    await request(ctx.server)
      .get(`/api/external-completions/${signers[0].publicId}/completed-file`)
      .set('Cookie', receiptCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    const cleared = await request(ctx.server)
      .delete(`/api/external-completions/${signers[0].publicId}/session`)
      .set('Cookie', receiptCookie)
      .set('Origin', 'http://localhost:3000')
      .expect(204);
    expect(String(cleared.headers['set-cookie'])).toContain(
      'FT_ESIGN_EXTERNAL_RECEIPT=;',
    );
  });

  it('已有證據的 active 文件可停止；pending access 失效且重新發起只能建立全新文件', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const createdResponse = await request(ctx.server)
      .post('/api/esign/documents')
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .field('title', '待停止文件')
      .attach('file', bytes, {
        filename: 'stop-source.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const createdId = apiData<{ id: string }>(createdResponse).id;
    const created = apiData<DocumentDetail>(await request(ctx.server)
      .get(`/api/esign/documents/${createdId}`)
      .set('Cookie', creatorCookie).expect(200));
    const stoppedDocumentId = Number(created.id);
    documentIds.push(stoppedDocumentId);

    const signersResponse = await request(ctx.server)
      .put(`/api/esign/documents/${stoppedDocumentId}/draftSave`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: [
          { type: 'email', name: '已簽人', email: 'signed@example.test' },
          { type: 'email', name: '待簽人', email: 'pending@example.test' },
        ],
      })
      .expect(200);
    const signers = apiData<Array<{ publicId: string }>>(signersResponse);
    await request(ctx.server)
      .put(`/api/esign/documents/${stoppedDocumentId}/fields`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        fields: signers.map((signer, index) => ({
          signerPublicId: signer.publicId,
          type: 'signature',
          page: 1,
          xPercent: 10,
          yPercent: 10 + index * 20,
          widthPercent: 25,
          heightPercent: 10,
          sortOrder: index,
        })),
      })
      .expect(200);
    await request(ctx.server)
      .post(`/api/esign/documents/${stoppedDocumentId}/initiations`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: [{ type: 'email', name: '已簽人', email: 'signed@example.test' }, { type: 'email', name: '待簽人', email: 'pending@example.test' }],
        fields: Array.from({ length: 2 }, (_, index) => ({ signerIndex: index, type: 'signature', page: 1, xPercent: 10, yPercent: 10 + index * 20, widthPercent: 25, heightPercent: 10, sortOrder: index })),
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      })
      .expect(201);

    const credentials = await db.query<
      Array<{ public_id: string; invitation_token_ciphertext: string }>
    >(
      'SELECT public_id, invitation_token_ciphertext FROM esign_signers WHERE document_id = ? ORDER BY sort_order',
      [stoppedDocumentId],
    );
    const firstToken = tokenService.decrypt(
      credentials[0].invitation_token_ciphertext,
    );
    const pendingToken = tokenService.decrypt(
      credentials[1].invitation_token_ciphertext,
    );
    const session = await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token: firstToken })
      .expect(303);
    const accessCookie = firstCookie(session.headers['set-cookie']);
    const taskResponse = await request(ctx.server)
      .post('/api/external-signing-task')
      .set('Cookie', accessCookie)
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    const task = apiData<{
      fields: Array<{ id: string; type: string }>;
      consent: { version: string };
    }>(taskResponse);
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', accessCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        requestId: randomUUID(),
        consentVersion: task.consent.version,
        accepted: true,
        signatures: [
          {
            fieldId: task.fields.find((field) => field.type === 'signature')!
              .id,
            pngDataUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          },
        ],
      })
      .expect(201);

    const pendingSession = await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token: pendingToken })
      .expect(303);
    const pendingCookie = firstCookie(pendingSession.headers['set-cookie']);
    const pendingTask = apiData<{
      fields: Array<{ id: string; type: string }>;
      consent: { version: string };
    }>(
      await request(ctx.server)
        .post('/api/external-signing-task')
        .set('Cookie', pendingCookie)
        .set('Origin', 'http://localhost:3000')
        .expect(200),
    );
    const [stoppedResponse, racedSignature] = await Promise.all([
      request(ctx.server)
        .post(`/api/esign/documents/${stoppedDocumentId}/stoppages`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ reason: '內容需要更正' })
        .expect(201),
      request(ctx.server)
        .post('/api/external-signing-task/signatures')
        .set('Cookie', pendingCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          requestId: randomUUID(),
          consentVersion: pendingTask.consent.version,
          accepted: true,
          signatures: [
            {
              fieldId: pendingTask.fields.find(
                (field) => field.type === 'signature',
              )!.id,
              pngDataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            },
          ],
        }),
    ]);
    expect([201, 401, 409]).toContain(racedSignature.status);
    expect(
      apiData<{ status: string; stopReason: string }>(stoppedResponse),
    ).toMatchObject({
      status: 'stopped',
      stopReason: '內容需要更正',
    });
    await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token: pendingToken })
      .expect(401);
    const evidence = await db.query<Array<{ evidence_count: number }>>(
      'SELECT COUNT(*) evidence_count FROM esign_signature_records WHERE signer_id IN (SELECT id FROM esign_signers WHERE document_id = ?)',
      [stoppedDocumentId],
    );
    expect([1, 2]).toContain(Number(evidence[0].evidence_count));
    const stoppedRows = await db.query<
      Array<{ status: string; stop_count: number }>
    >(
      `SELECT d.status,
        (SELECT COUNT(*) FROM esign_audit_events a WHERE a.document_id = d.id AND a.event_type = 'document.stopped_by_creator') stop_count
       FROM esign_documents d WHERE d.id = ?`,
      [stoppedDocumentId],
    );
    expect(stoppedRows[0].status).toBe('stopped');
    expect(Number(stoppedRows[0].stop_count)).toBe(1);

    const replacementPdf = await PDFDocument.create();
    replacementPdf.addPage();
    replacementPdf.addPage();
    const replacementResult = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '更正後新文件')
        .attach('file', Buffer.from(await replacementPdf.save()), {
          filename: 'replacement.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    documentIds.push(Number(replacementResult.id));
    expect(Object.keys(replacementResult)).toEqual(['id']);
    expect(typeof replacementResult.id).toBe('string');
    const replacement = apiData<DocumentDetail>(await request(ctx.server)
      .get(`/api/esign/documents/${replacementResult.id}`)
      .set('Cookie', creatorCookie).expect(200));
    expect(replacement.id).not.toBe(created.id);
    expect(replacement.sourceFile.sha256).not.toBe(created.sourceFile.sha256);
    expect(replacement.status).toBe('draft');
  });

  it('文件清單依角色與狀態過濾，內部 signer 歷程只含本人與文件狀態事件', async () => {
    const users = await db.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE empid = ?',
      [signerEmpid],
    );
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());

    await request(ctx.server)
      .post('/api/esign/documents')
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .field('title', '不可接受額外欄位')
      .field('unexpected', 'secret')
      .attach('file', bytes, {
        filename: 'source.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);

    const created = apiData<DocumentDetail>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '內部歷程裁切文件')
        .attach('file', bytes, {
          filename: 'source.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    const documentId = Number(created.id);
    documentIds.push(documentId);
    await request(ctx.server)
      .put(`/api/esign/documents/${documentId}/draftSave`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ signers: [], unexpected: 'secret' })
      .expect(400);
    const assigned = apiData<Array<{ publicId: string }>>(
      await request(ctx.server)
        .put(`/api/esign/documents/${documentId}/draftSave`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          signers: [{ type: 'user', userId: String(users[0].id) }],
        })
        .expect(200),
    );
    await request(ctx.server)
      .put(`/api/esign/documents/${documentId}/fields`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        fields: [
          {
            signerPublicId: assigned[0].publicId,
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 10,
            widthPercent: 25,
            heightPercent: 10,
            sortOrder: 0,
          },
        ],
      })
      .expect(200);
    const initiated = await request(ctx.server)
      .post(`/api/esign/documents/${documentId}/initiations`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: [{ type: 'user', userId: String(users[0].id) }],
        fields: Array.from({ length: 1 }, (_, index) => ({ signerIndex: index, type: 'signature', page: 1, xPercent: 10, yPercent: 10 + index * 20, widthPercent: 25, heightPercent: 10, sortOrder: index })),
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      })
      .expect(201);
    assigned[0].publicId = apiData<DocumentDetail>(initiated).signers[0].publicId;

    // 內部簽署人的任務列表帶出簽署期間與發起人
    const myTasks = apiData<Array<{ signerPublicId: string; document: object }>>(
      await request(ctx.server).get('/api/esign/signing-tasks').set('Cookie', signerCookie).expect(200));
    expect(myTasks.find((task) => task.signerPublicId === assigned[0].publicId)?.document).toMatchObject({
      createdBy: { name: '建立人', employeeNo: creatorEmpid },
      signStartAt: expect.any(String),
      signEndAt: expect.any(String),
    });

    const signerPreview = await request(ctx.server)
      .get(`/api/esign/signing-tasks/${assigned[0].publicId}/source-file`)
      .set('Cookie', signerCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect('Cache-Control', 'private, no-store');
    expect(signerPreview.headers['x-frame-options']).toBeUndefined();
    expect(signerPreview.headers['content-security-policy']).toContain(
      "frame-ancestors 'self'",
    );
    for (const origin of (process.env.AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .filter(Boolean)) {
      expect(signerPreview.headers['content-security-policy']).toContain(
        new URL(origin.trim()).origin,
      );
    }
    await request(ctx.server)
      .get(`/api/esign/signing-tasks/${assigned[0].publicId}/source-file`)
      .set('Cookie', outsiderCookie)
      .expect(404)
      .expect('X-Frame-Options', 'DENY');

    const creatorList = apiData<Array<{ id: string }>>(
      await request(ctx.server)
        .get('/api/esign/documents?role=created&status=active')
        .set('Cookie', creatorCookie)
        .expect(200),
    );
    expect(creatorList.some((document) => document.id === created.id)).toBe(
      true,
    );
    const signerList = apiData<Array<{ id: string }>>(
      await request(ctx.server)
        .get('/api/esign/documents?role=assigned&status=active')
        .set('Cookie', signerCookie)
        .expect(200),
    );
    expect(signerList.map((document) => document.id)).toContain(created.id);
    await request(ctx.server)
      .get('/api/esign/documents?role=owner')
      .set('Cookie', creatorCookie)
      .expect(400);

    const signerHistory = apiData<
      Array<{ type: string; actor: string; reason: string | null }>
    >(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}/history`)
        .set('Cookie', signerCookie)
        .expect(200),
    );
    expect(signerHistory.map((event) => event.type)).toEqual([
      'document.created',
      'signer.assigned',
      'document.initiated',
    ]);
    expect(
      signerHistory.find((event) => event.type === 'signer.assigned'),
    ).toMatchObject({ actor: '本人', reason: null });
    await request(ctx.server)
      .get(`/api/esign/documents/${documentId}/history`)
      .set('Cookie', outsiderCookie)
      .expect(404);
  });

  async function login(empid: string): Promise<string> {
    const launched = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${createLaunchJwt(empid)}`)
      .expect(201);
    const code = new URL(
      apiData<LaunchView>(launched).launchUrl,
    ).searchParams.get('code');
    const activated = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303);
    const raw: unknown = activated.headers['set-cookie'];
    const cookie = Array.isArray(raw) ? raw[0] : raw;
    if (typeof cookie !== 'string') throw new Error('缺少 session cookie');
    return cookie;
  }
});

function firstCookie(value: unknown): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (typeof cookie !== 'string') throw new Error('缺少 cookie');
  return cookie;
}

function cookieNamed(value: unknown, name: string): string {
  const cookies = Array.isArray(value) ? value : [value];
  const raw = cookies.find(
    (cookie): cookie is string =>
      typeof cookie === 'string' && cookie.startsWith(`${name}=`),
  );
  if (!raw) throw new Error(`缺少 ${name} cookie`);
  return raw.split(';', 1)[0];
}

function createLaunchJwt(empid: string): string {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encoded({ alg: 'RS256', typ: 'FT-ESIGN-LAUNCH+JWT' });
  const payload = encoded({
    iss: 'e2e-main-platform',
    aud: 'e2e-esign',
    sub: empid,
    jti: randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 120,
  });
  const privateKey = createPrivateKey(
    Buffer.from(process.env.WEBVIEW_TEST_PRIVATE_KEY_B64!, 'base64').toString(
      'utf8',
    ),
  );
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
