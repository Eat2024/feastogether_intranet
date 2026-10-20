import { EsignExpiryService } from '#app/features/esign/services/esign-expiry.service';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { esignTestPng } from './esign-test-png';
import { createPrivateKey, createHash, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { getQueueToken } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import type { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { apiData, apiError } from './api-response.helper';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { ESIGN_DOCUMENT_FINALIZATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { WorkerModule } from '#app/worker.module';
import { DocumentFinalizationProcessor } from '#app/worker/esign/document-finalization.processor';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
import {
  esignRowCounts,
  getSignatureVerification,
  type SignatureVerification,
  VERIFICATION_URL,
} from './signature-verification.helper';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

interface LaunchView {
  launchUrl: string;
}

interface DocumentDetail {
  id: string;
  status: string;
  sourceFile: { pageCount: number; sha256: string };
  signers: Array<{ publicId: string; verificationUrl: string | null }>;
}

interface SigningTask {
  signerPublicId: string;
  signer: {
    status: string;
    verificationUrl: string | null;
    completion: { status: string | null };
  };
  fields: Array<{ id: string; type: string }>;
  consent: { version: string };
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
  const personalEmpids = Array.from(
    { length: 10 },
    (_, i) => `E2E003P${String(i).padStart(2, '0')}`,
  );

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
        'DELETE FROM esign_verification_records WHERE document_id = ?',
        [documentId],
      );
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
    for (const empid of personalEmpids) {
      await db.query(
        'DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE empid = ?)',
        [empid],
      );
      await db.query('DELETE FROM users WHERE empid = ?', [empid]);
    }
    await closeSecurityE2eApp(ctx);
  });

  it('一次發起可從空草稿完成設定；失敗完整回滾既有名單、欄位與通知', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '原子發起測試')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'atomic.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    const id = Number(created.id);
    documentIds.push(id);
    const field = {
      type: 'signature',
      page: 1,
      xPercent: 10,
      yPercent: 10,
      widthPercent: 25,
      heightPercent: 10,
      sortOrder: 0,
    };
    const input = {
      signers: [
        { type: 'email', name: '原子測試', email: 'atomic@example.test' },
      ],
      fields: [field],
      signStartAt: new Date(Date.now() - 60_000).toISOString(),
      signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
      watermark: false,
      allowReject: false,
    };
    const initiate = (body: object, cookie = creatorCookie) =>
      request(ctx.server)
        .post(`/api/esign/documents/${id}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000')
        .send(body);
    const detail = async () =>
      apiData<DocumentDetail>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}`)
          .set('Cookie', creatorCookie)
          .expect(200),
      );
    const empty = await detail();
    await initiate({
      signStartAt: input.signStartAt,
      signEndAt: input.signEndAt,
    }).expect(400);
    await initiate(input, outsiderCookie).expect(404);
    await initiate({ ...input, fields: [{ ...field, type: 'date' }] }).expect(
      400,
    );
    expect(await detail()).toEqual(empty);
    // 先存一份草稿設定，後續發起失敗不得刪掉這份設定。
    apiData<Array<{ publicId: string }>>(
      await request(ctx.server)
        .put(`/api/esign/documents/${id}/draftSave`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ signers: input.signers })
        .expect(200),
    );
    const placement = field;
    await request(ctx.server)
      .put(`/api/esign/documents/${id}/fields`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ fields: [{ ...placement }] })
      .expect(200);
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
    const saveLogs = jest
      .spyOn(ctx.app.get(NotificationRepository), 'saveLogs')
      .mockRejectedValueOnce(new Error('測試通知寫入失敗'));
    try {
      await initiate(input).expect(500);
    } finally {
      saveLogs.mockRestore();
    }
    expect(await detail()).toEqual(before);
    const batches = await db.query<Array<{ count: number }>>(
      'SELECT COUNT(*) count FROM esign_notification_batches WHERE document_id = ?',
      [id],
    );
    expect(Number(batches[0].count)).toBe(0);
    const results = await Promise.all([initiate(input), initiate(input)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const active = await detail();
    expect(active.status).toBe('active');
    expect(active.signers).toHaveLength(1);
    const activeBatches = await db.query<Array<{ count: number }>>(
      'SELECT COUNT(*) count FROM esign_notification_batches WHERE document_id = ?',
      [id],
    );
    expect(Number(activeBatches[0].count)).toBe(1);
    const fresh = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '不先儲存設定')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'fresh.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    documentIds.push(Number(fresh.id));
    const freshResult = apiData<DocumentDetail>(
      await request(ctx.server)
        .post(`/api/esign/documents/${fresh.id}/initiations`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ ...input, watermark: true, allowReject: true })
        .expect(201),
    );
    expect(freshResult.status).toBe('active');
    expect(freshResult.signers).toHaveLength(1);
    const options = await db.query<
      Array<{ id: number; watermark_enabled: number; allow_reject: number }>
    >(
      'SELECT id, watermark_enabled, allow_reject FROM esign_documents WHERE id IN (?, ?) ORDER BY id',
      [id, Number(fresh.id)],
    );
    expect(
      options.map((row) => [
        Number(row.watermark_enabled),
        Number(row.allow_reject),
      ]),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('刪除草稿：軟刪除並寫入稽核，之後查無此文件；已發起的文件不可刪除', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const create = async (title: string) =>
      Number(
        apiData<{ id: string }>(
          await request(ctx.server)
            .post('/api/esign/documents')
            .set('Cookie', creatorCookie)
            .set('Origin', 'http://localhost:3000')
            .field('title', title)
            .attach('file', bytes, {
              filename: 'delete.pdf',
              contentType: 'application/pdf',
            })
            .expect(201),
        ).id,
      );
    const remove = (id: number) =>
      request(ctx.server)
        .delete(`/api/esign/documents/${id}`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000');

    const draftId = await create('刪除草稿測試');
    documentIds.push(draftId);
    await remove(draftId).expect(204);
    await request(ctx.server)
      .get(`/api/esign/documents/${draftId}`)
      .set('Cookie', creatorCookie)
      .expect(404);
    const events = await db.query<Array<{ event_type: string }>>(
      'SELECT event_type FROM esign_audit_events WHERE document_id = ? ORDER BY id',
      [draftId],
    );
    expect(events.map((event) => event.event_type)).toEqual([
      'document.created',
      'document.draft_deleted',
    ]);

    const activeId = await create('已發起不可刪除');
    documentIds.push(activeId);
    await request(ctx.server)
      .post(`/api/esign/documents/${activeId}/initiations`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: [
          {
            type: 'email',
            name: '刪除測試',
            email: 'delete-test@example.test',
          },
        ],
        fields: [
          {
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 10,
            widthPercent: 25,
            heightPercent: 10,
            sortOrder: 0,
          },
        ],
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      })
      .expect(201);
    await remove(activeId).expect(409);
  });

  it('簽署人候選：本地沒有的完整員編改查饗賓人 API 並建立帳號，之後直接由本地取得', async () => {
    await db.query('DELETE FROM users WHERE empid = ?', [importedEmpid]);
    const hr = ctx.app.get<{ lookupEligibleStaff: jest.Mock }>(
      FeastogetherHrService,
    );
    hr.lookupEligibleStaff.mockClear();
    const search = async (q: string) =>
      apiData<Array<{ id: string; employeeNo: string; name: string }>>(
        await request(ctx.server)
          .get('/api/esign/signer-candidates')
          .query({ q })
          .set('Cookie', creatorCookie)
          .expect(200),
      );

    const first = await search(importedEmpid);
    expect(first).toEqual([
      expect.objectContaining({
        employeeNo: importedEmpid,
        name: '未參與員工',
      }),
    ]);
    expect(hr.lookupEligibleStaff).toHaveBeenCalledWith(importedEmpid);
    const rows = await db.query<Array<{ is_active: number }>>(
      'SELECT is_active FROM users WHERE empid = ?',
      [importedEmpid],
    );
    expect(rows.map((row) => Number(row.is_active))).toEqual([1]);

    // 已匯入的帳號由本地取得；不是完整員編的查詢也不呼叫饗賓人 API
    expect((await search(importedEmpid)).map((c) => c.id)).toEqual([
      first[0].id,
    ]);
    await search(importedEmpid.slice(0, 5));
    expect(hr.lookupEligibleStaff).toHaveBeenCalledTimes(1);
  });

  it('共用簽名與日期欄位可先存，更換名單及發起後均不複製', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '先放欄位測試')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'fields-first.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    const id = Number(created.id);
    documentIds.push(id);
    type FieldView = { type: string; page: number };
    const detail = async () =>
      apiData<DocumentDetail & { fields: FieldView[] }>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}`)
          .set('Cookie', creatorCookie)
          .expect(200),
      );
    const placements = [
      {
        type: 'signature',
        page: 1,
        xPercent: 10,
        yPercent: 10,
        widthPercent: 25,
        heightPercent: 10,
        sortOrder: 0,
      },
      {
        type: 'date',
        page: 1,
        xPercent: 40,
        yPercent: 10,
        widthPercent: 20,
        heightPercent: 5,
        sortOrder: 1,
      },
      {
        type: 'signature',
        page: 2,
        xPercent: 10,
        yPercent: 60,
        widthPercent: 25,
        heightPercent: 10,
        sortOrder: 2,
      },
    ];
    const savedFields = apiData<FieldView[]>(
      await request(ctx.server)
        .put(`/api/esign/documents/${id}/fields`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ fields: placements })
        .expect(200),
    );
    expect(savedFields).toHaveLength(3);
    savedFields.forEach((field) =>
      expect(field).not.toHaveProperty('signerPublicId'),
    );

    const signers = [
      {
        type: 'email',
        name: '先放欄位甲',
        email: 'fields-first-a@example.test',
      },
      {
        type: 'email',
        name: '先放欄位乙',
        email: 'fields-first-b@example.test',
      },
    ];
    await request(ctx.server)
      .put(`/api/esign/documents/${id}/draftSave`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ signers })
      .expect(200);
    const draft = await detail();
    expect(draft.fields.map(({ type, page }) => ({ type, page }))).toEqual([
      { type: 'signature', page: 1 },
      { type: 'date', page: 1 },
      { type: 'signature', page: 2 },
    ]);

    const initiate = (fields: object[]) =>
      request(ctx.server)
        .post(`/api/esign/documents/${id}/initiations`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          signers,
          fields,
          signStartAt: new Date(Date.now() - 60_000).toISOString(),
          signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
          watermark: false,
          allowReject: false,
        });
    await initiate(placements).expect(201);
    const active = await detail();
    expect(active.status).toBe('active');
    expect(active).toMatchObject({
      createdBy: { name: '建立人', employeeNo: creatorEmpid },
    });
    expect(active.fields).toHaveLength(3);
    active.fields.forEach((field) =>
      expect(field).not.toHaveProperty('signerPublicId'),
    );

    // 列表帶出簽署期間與建立人
    const list = apiData<
      Array<{
        id: string;
        signStartAt: string | null;
        signEndAt: string | null;
        createdBy: unknown;
      }>
    >(
      await request(ctx.server)
        .get('/api/esign/documents')
        .query({ role: 'created' })
        .set('Cookie', creatorCookie)
        .expect(200),
    );
    const item = list.find((d) => d.id === String(id));
    expect(item).toMatchObject({
      createdBy: { name: '建立人', employeeNo: creatorEmpid },
    });
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
      {
        type: 'signature',
        page: 2,
        xPercent: 10,
        yPercent: 60,
        widthPercent: 25,
        heightPercent: 10,
        sortOrder: 0,
      },
      {
        type: 'date',
        page: 2,
        xPercent: 40,
        yPercent: 60,
        widthPercent: 20,
        heightPercent: 5,
        sortOrder: 1,
      },
    ];
    const upload = (title: string, fields: object[]) =>
      request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', title)
        .field('fields', JSON.stringify(fields))
        .attach('file', twoPageBytes, {
          filename: 'with-fields.pdf',
          contentType: 'application/pdf',
        });

    const rejectedTitle = `欄位不合法-${randomUUID()}`;
    await upload(rejectedTitle, [{ ...placements[0], page: 3 }]).expect(400);
    const leaked = await db.query<Array<{ count: number }>>(
      'SELECT COUNT(*) count FROM esign_documents WHERE title = ?',
      [rejectedTitle],
    );
    expect(Number(leaked[0].count)).toBe(0);

    const created = apiData<{ id: string }>(
      await upload('一次上傳含欄位', placements).expect(201),
    );
    const id = Number(created.id);
    documentIds.push(id);
    type FieldView = { type: string; page: number };
    const detail = async () =>
      apiData<DocumentDetail & { fields: FieldView[] }>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}`)
          .set('Cookie', creatorCookie)
          .expect(200),
      );
    const summary = (fields: FieldView[]) =>
      fields.map(({ type, page }) => ({ type, page }));
    expect(summary((await detail()).fields)).toEqual([
      { type: 'signature', page: 2 },
      { type: 'date', page: 2 },
    ]);

    const patch = () =>
      request(ctx.server)
        .patch(`/api/esign/documents/${id}`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000');
    await patch()
      .field('fields', JSON.stringify([placements[1]]))
      .expect(200);
    expect(summary((await detail()).fields)).toEqual([
      { type: 'date', page: 2 },
    ]);

    const before = await detail();
    await patch()
      .field('fields', JSON.stringify([{ ...placements[0], page: 3 }]))
      .expect(400);
    // 新 PDF 只有 1 頁，第 2 頁的欄位不合法：PDF 與欄位都不得替換
    await patch()
      .field('fields', JSON.stringify(placements))
      .attach('file', onePageBytes, {
        filename: 'one-page.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    expect(await detail()).toEqual(before);

    await patch()
      .field('fields', JSON.stringify([{ ...placements[0], page: 1 }]))
      .attach('file', onePageBytes, {
        filename: 'one-page.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);
    const replaced = await detail();
    expect(replaced.sourceFile.pageCount).toBe(1);
    expect(summary(replaced.fields)).toEqual([{ type: 'signature', page: 1 }]);
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
    const created = apiData<DocumentDetail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${createdId}`)
        .set('Cookie', creatorCookie)
        .expect(200),
    );
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
        signers: [
          {
            type: 'email',
            name: '外部簽署人',
            email: 'Candidate@Example.test',
          },
        ],
        fields: Array.from({ length: 1 }, (_, index) => ({
          type: 'signature',
          page: 1,
          xPercent: 10,
          yPercent: 10 + index * 20,
          widthPercent: 25,
          heightPercent: 10,
          sortOrder: index,
        })),
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      })
      .expect(201);
    expect(apiData<DocumentDetail>(initiatedResponse).status).toBe('active');
    signers[0].publicId =
      apiData<DocumentDetail>(initiatedResponse).signers[0].publicId;

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
      .expect('Content-Type', /^text\/html/)
      .expect('Cache-Control', 'no-store')
      .expect('Referrer-Policy', 'no-referrer');
    expect(bridge.headers['set-cookie']).toBeUndefined();
    expect(bridge.text).toContain('電子簽署邀請</h1>');
    expect(bridge.text).toContain('開啟電子簽署文件</button>');
    // 只開啟邀請連結不記錄開啟
    expect(
      await db.query(
        'SELECT event_type, signer_id, metadata_json FROM esign_audit_events WHERE document_id = ? ORDER BY id',
        [documentId],
      ),
    ).toEqual(initiatedAudits);

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
    const task = apiData<SigningTask>(taskResponse);
    const signatureField = task.fields.find(
      (field) => field.type === 'signature',
    );
    expect(signatureField).toBeDefined();
    expect(task.signer.verificationUrl).toBeNull();

    const signatureRequestId = randomUUID();
    const signatureSubmission = {
      signerPublicId: task.signerPublicId,
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
    // 同一 requestId 併發：一筆成功簽署，另一筆拿回既有結果
    expect(repeatedCalls.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    const signed = repeatedCalls.find((response) => response.status === 201)!;
    const signedBody = apiData<Record<string, unknown>>(signed);
    expect(
      apiData(repeatedCalls.find((response) => response.status === 200)!),
    ).toEqual(signedBody);
    expect(signedBody).toMatchObject({
      documentStatus: 'finalizing',
      completion: { status: 'pending', readyAt: null },
    });
    expect(signedBody).not.toHaveProperty('receiptToken');
    const verificationUrl = String(signedBody.verificationUrl);
    expect(verificationUrl).toMatch(VERIFICATION_URL);
    const storedCodes = await db.query<Array<{ verification_code: string }>>(
      `SELECT r.verification_code FROM esign_signature_records r
       JOIN esign_signers s ON s.id = r.signer_id WHERE s.public_id = ?`,
      [signers[0].publicId],
    );
    expect(storedCodes).toEqual([
      { verification_code: VERIFICATION_URL.exec(verificationUrl)![1] },
    ]);

    expect(verificationUrl).not.toMatch(
      new RegExp(`candidate|外部簽署人|Spec 03|${signers[0].publicId}`, 'i'),
    );
    const detailAfterSign = apiData<DocumentDetail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}`)
        .set('Cookie', creatorCookie)
        .expect(200),
    );
    expect(detailAfterSign.signers[0].verificationUrl).toBe(verificationUrl);
    expect(
      apiData<SignatureVerification>(
        await getSignatureVerification(ctx.server, verificationUrl).expect(200),
      ),
    ).toEqual({
      signature: {
        signerName: '外部簽署人',
        signedAt: signedBody.signedAt,
        authenticationMethod: 'email_invitation',
      },
      document: {
        title: 'Spec 03 測試文件',
        status: 'finalizing',
        signedSourceSha256: created.sourceFile.sha256,
        completedAt: null,
        stoppedAt: null,
        completedPdfSha256: null,
      },
    });
    // 簽署成功（含重送）不清除存取，改以同一 token 設為 session cookie（不設期限）
    for (const response of repeatedCalls) {
      const cookie = firstCookie(response.headers['set-cookie']);
      // 以布林比對，失敗訊息不印出 token
      expect(
        cookie.startsWith(`FT_ESIGN_EXTERNAL_ACCESS=${invitationToken};`),
      ).toBe(true);
      expect(cookie).toContain('Path=/api/external-signing-task');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).not.toMatch(/Expires=|Max-Age=/i);
    }
    expect(String(signed.headers['set-cookie'])).not.toContain(
      'FT_ESIGN_EXTERNAL_RECEIPT=',
    );
    // 簽署寫入不變：保留 digest 作為簽後存取依據，清除密文與期限
    const [credential] = await db.query<
      Array<{
        invitation_token_sha256: string | null;
        invitation_token_ciphertext: string | null;
        invitation_expires_at: Date | null;
      }>
    >(
      `SELECT invitation_token_sha256, invitation_token_ciphertext, invitation_expires_at
       FROM esign_signers WHERE public_id = ?`,
      [signers[0].publicId],
    );
    expect(credential).toEqual({
      invitation_token_sha256: tokenService.digest(invitationToken),
      invitation_token_ciphertext: null,
      invitation_expires_at: null,
    });

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

    // 網路重試送出同一次簽名：回既有結果，不重複建立簽署
    expect(
      apiData(
        await request(ctx.server)
          .post('/api/external-signing-task/signatures')
          .set('Cookie', externalCookie)
          .set('Origin', 'http://localhost:3000')
          .send(signatureSubmission)
          .expect(200),
      ),
    ).toEqual(signedBody);
    // 已簽者以新的請求再次簽署：拒絕
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', externalCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ ...signatureSubmission, requestId: randomUUID() })
      .expect(401);

    // 已簽者仍可開啟任務；完成頁以唯讀 GET 輪詢副本狀態，不寫入稽核
    const reopened = apiData<SigningTask>(
      await request(ctx.server)
        .post('/api/external-signing-task')
        .set('Cookie', externalCookie)
        .set('Origin', 'http://localhost:3000')
        .expect(200),
    );
    expect(reopened.signer).toMatchObject({
      status: 'signed',
      completion: { status: 'pending' },
    });
    const auditCount = async () =>
      Number(
        (
          await db.query<Array<{ count: number }>>(
            'SELECT COUNT(*) count FROM esign_audit_events WHERE document_id = ?',
            [documentId],
          )
        )[0].count,
      );
    const auditsBeforePolling = await auditCount();
    const polled = await request(ctx.server)
      .get('/api/external-signing-task')
      .set('Cookie', externalCookie)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(apiData<SigningTask>(polled)).toMatchObject({
      signerPublicId: signers[0].publicId,
      signer: { status: 'signed', completion: { status: 'pending' } },
    });
    expect(await auditCount()).toBe(auditsBeforePolling);
    // 副本尚未產生：下載回 409，不回傳檔案
    const notReady = await request(ctx.server)
      .get('/api/external-signing-task/completed-file')
      .set('Cookie', externalCookie)
      .expect(409);
    expect(apiError(notReady)).toMatchObject({
      code: 'ESIGN_STATE_CONFLICT',
      message: '個人副本尚未產生',
    });

    // 暫停 queue，避免 worker 的 BullMQ consumer 與下方直接呼叫競爭 lease
    const finalizationQueue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_FINALIZATION_QUEUE),
    );
    await finalizationQueue.pause();
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      const processor = worker.get(DocumentFinalizationProcessor);
      const [owner] = await db.query<Array<{ id: number }>>(
        'SELECT id FROM esign_signers WHERE document_id = ?',
        [documentId],
      );
      const job = { data: { documentId, signerId: Number(owner.id) } } as Job<{
        documentId: number;
        signerId: number;
      }>;
      // 以同文件既有快照觸發 unique 衝突：快照寫入失敗時整筆結案 rollback，可安全重試
      await db.query(
        `INSERT INTO esign_verification_records
           (document_id, public_id, manifest_json, manifest_sha256,
            final_pdf_sha256, audit_root_hash, issued_at)
         VALUES (?, UUID(), JSON_OBJECT(), REPEAT('0', 64), REPEAT('0', 64),
           REPEAT('0', 64), UTC_TIMESTAMP(6))`,
        [documentId],
      );
      await expect(processor.process(job)).rejects.toThrow();
      const rolledBack = await db.query<
        Array<{ status: string; file_count: number; event_count: number }>
      >(
        `SELECT d.status,
          (SELECT COUNT(*) FROM esign_file_objects f JOIN esign_signature_records r ON r.id = f.signature_record_id JOIN esign_signers s ON s.id = r.signer_id WHERE s.document_id = d.id AND f.file_purpose = 'completed_pdf') file_count,
          (SELECT COUNT(*) FROM esign_audit_events a WHERE a.document_id = d.id AND a.event_type = 'document.completed') event_count
         FROM esign_documents d WHERE d.id = ?`,
        [documentId],
      );
      expect(rolledBack[0].status).toBe('finalizing');
      expect(Number(rolledBack[0].file_count)).toBe(1);
      expect(Number(rolledBack[0].event_count)).toBe(0);
      await db.query(
        'DELETE FROM esign_verification_records WHERE document_id = ?',
        [documentId],
      );
      await processor.process(job);
    } finally {
      await worker.close();
      await finalizationQueue.resume();
    }
    const snapshotCount = await db.query<Array<{ count: number }>>(
      'SELECT COUNT(*) count FROM esign_verification_records WHERE document_id = ?',
      [documentId],
    );
    expect(Number(snapshotCount[0].count)).toBe(1);

    const completed = await db.query<Array<{ status: string }>>(
      'SELECT status FROM esign_documents WHERE id = ?',
      [documentId],
    );
    expect(completed[0]?.status).toBe('completed');
    const creatorCopy = await request(ctx.server)
      .get(
        `/api/esign/documents/${documentId}/signers/${signers[0].publicId}/completed-file`,
      )
      .set('Cookie', creatorCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    // 副本產生後外部簽署人下載本人副本，內容與建立人下載的同一人副本相同
    expect(
      apiData<SigningTask>(
        await request(ctx.server)
          .get('/api/external-signing-task')
          .set('Cookie', externalCookie)
          .expect(200),
      ).signer.completion.status,
    ).toBe('ready');
    const auditsBeforeDownload = await auditCount();
    const externalCopy = await request(ctx.server)
      .get('/api/external-signing-task/completed-file')
      .set('Cookie', externalCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect('Content-Disposition', 'attachment; filename="completed.pdf"')
      .expect('Cache-Control', 'private, no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    expect(
      Buffer.compare(externalCopy.body as Buffer, creatorCopy.body as Buffer),
    ).toBe(0);
    expect(await auditCount()).toBe(auditsBeforeDownload);
    await request(ctx.server)
      .get(
        `/api/esign/documents/${documentId}/signers/${signers[0].publicId}/completed-file`,
      )
      .set('Cookie', outsiderCookie)
      .expect(404);
    await request(ctx.server)
      .get(`/api/external-completions/${signers[0].publicId}`)
      .expect(404);
    const completedFiles = await db.query<Array<{ sha256: string }>>(
      `SELECT f.sha256 FROM esign_file_objects f JOIN esign_signature_records r ON r.id = f.signature_record_id JOIN esign_signers s ON s.id = r.signer_id
       WHERE s.document_id = ? AND f.file_purpose = 'completed_pdf'`,
      [documentId],
    );
    const rowsBeforeVerification = await esignRowCounts(db);
    const completedVerification = await getSignatureVerification(
      ctx.server,
      verificationUrl,
    )
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Referrer-Policy', 'no-referrer');
    expect(completedVerification.headers['set-cookie']).toBeUndefined();
    expect(await esignRowCounts(db)).toEqual(rowsBeforeVerification);
    expect(
      apiData<SignatureVerification>(completedVerification).document,
    ).toMatchObject({
      status: 'completed',
      completedAt: expect.any(String),
      stoppedAt: null,
      completedPdfSha256: completedFiles[0].sha256,
    });
    await request(ctx.server)
      .get(`/api/external-completions/${signers[0].publicId}/completed-file`)
      .expect(404);

    // 快照與完成文件摘要不一致時，驗證失敗而非顯示有效
    await db.query(
      `UPDATE esign_verification_records SET final_pdf_sha256 = REPEAT('0', 64)
       WHERE document_id = ?`,
      [documentId],
    );
    const tampered = await getSignatureVerification(
      ctx.server,
      verificationUrl,
    ).expect(409);
    expect(apiError(tampered).code).toBe('ESIGN_INTEGRITY_FAILED');
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
    const created = apiData<DocumentDetail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${createdId}`)
        .set('Cookie', creatorCookie)
        .expect(200),
    );
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
        signers: [
          { type: 'email', name: '已簽人', email: 'signed@example.test' },
          { type: 'email', name: '待簽人', email: 'pending@example.test' },
        ],
        fields: Array.from({ length: 2 }, (_, index) => ({
          type: 'signature',
          page: 1,
          xPercent: 10,
          yPercent: 10 + index * 20,
          widthPercent: 25,
          heightPercent: 10,
          sortOrder: index,
        })),
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
    const task = apiData<SigningTask>(taskResponse);
    const firstSigned = apiData<{ verificationUrl: string }>(
      await request(ctx.server)
        .post('/api/external-signing-task/signatures')
        .set('Cookie', accessCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          signerPublicId: task.signerPublicId,
          requestId: randomUUID(),
          consentVersion: task.consent.version,
          accepted: true,
          signatures: task.fields
            .filter((field) => field.type === 'signature')
            .map((field) => ({ fieldId: field.id, pngDataUrl: PNG_DATA_URL })),
        })
        .expect(201),
    );
    // 已簽者有驗證網址，尚未簽署者為 null
    expect(
      apiData<DocumentDetail>(
        await request(ctx.server)
          .get(`/api/esign/documents/${stoppedDocumentId}`)
          .set('Cookie', creatorCookie)
          .expect(200),
      ).signers.map((signer) => signer.verificationUrl),
    ).toEqual([firstSigned.verificationUrl, null]);

    const pendingSession = await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token: pendingToken })
      .expect(303);
    const pendingCookie = firstCookie(pendingSession.headers['set-cookie']);
    const pendingTask = apiData<SigningTask>(
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
          signerPublicId: pendingTask.signerPublicId,
          requestId: randomUUID(),
          consentVersion: pendingTask.consent.version,
          accepted: true,
          signatures: pendingTask.fields
            .filter((field) => field.type === 'signature')
            .map((field) => ({ fieldId: field.id, pngDataUrl: PNG_DATA_URL })),
        }),
    ]);
    expect([201, 401, 409]).toContain(racedSignature.status);
    expect(
      apiData<{ status: string; stopReason: string }>(stoppedResponse),
    ).toMatchObject({
      status: 'stopped',
      stopReason: '內容需要更正',
    });
    // 競態中簽署成功者已是已簽者，停止後仍可重新開啟；未簽成者邀請失效
    await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token: pendingToken })
      .expect(racedSignature.status === 201 ? 303 : 401);
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
    const stoppedLogs = await db.query<Array<{ id: number }>>(
      'SELECT l.id FROM esign_notification_logs l JOIN esign_signers s ON s.id=l.signer_id WHERE s.document_id=?',
      [stoppedDocumentId],
    );
    for (const log of stoppedLogs) {
      const eligible = await ctx.app
        .get(NotificationRepository)
        .findEligibleInvitationLogIds(
          new Date(),
          new Date(Date.now() - 300_000),
          db.manager,
          Number(log.id) - 1,
        );
      expect(eligible.some((row) => Number(row.id) === Number(log.id))).toBe(
        false,
      );
    }

    expect(
      apiData<SignatureVerification>(
        await getSignatureVerification(
          ctx.server,
          firstSigned.verificationUrl,
        ).expect(200),
      ).document,
    ).toMatchObject({
      title: '待停止文件',
      status: 'stopped',
      completedAt: null,
      stoppedAt: expect.any(String),
      completedPdfSha256: null,
    });

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
    const replacement = apiData<DocumentDetail>(
      await request(ctx.server)
        .get(`/api/esign/documents/${replacementResult.id}`)
        .set('Cookie', creatorCookie)
        .expect(200),
    );
    expect(replacement.id).not.toBe(created.id);
    expect(replacement.sourceFile.sha256).not.toBe(created.sourceFile.sha256);
    expect(replacement.status).toBe('draft');
  });

  it('已簽者關閉瀏覽器後重新開啟邀請：以 session cookie 進入完成頁並可下載；文件停止後仍可下載，同文件待簽者被拒', async () => {
    const { documentId, signedToken, pendingToken } =
      await signedAndPendingDocument('簽後重新開啟文件');
    // 待簽者仍取得帶邀請期限的 cookie
    expect(await openExternalSession(pendingToken)).toMatch(/Expires=/);

    // 沒有 cookie 的新請求（另一個瀏覽器或關閉後）重新開啟：不設期限，任務為已簽署
    const reopened = await openExternalSession(signedToken);
    expect(reopened).not.toMatch(/Expires=|Max-Age=/i);
    expect(
      apiData<SigningTask>(
        await request(ctx.server)
          .post('/api/external-signing-task')
          .set('Cookie', reopened)
          .set('Origin', 'http://localhost:3000')
          .expect(200),
      ).signer,
    ).toMatchObject({ status: 'signed', completion: { status: 'ready' } });
    const copy = await downloadPersonalCopy(reopened);

    await request(ctx.server)
      .post(`/api/esign/documents/${documentId}/stoppages`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({ reason: '簽後停止' })
      .expect(201);
    const afterStop = await downloadPersonalCopy(
      await openExternalSession(signedToken),
    );
    expect(Buffer.compare(afterStop, copy)).toBe(0);
    // 停止後的待簽者與竄改的 token 顯示相同失效頁：不揭露原因、不回顯 token
    const stoppedPage = await rejectedInvitationPage(pendingToken);
    const tamperedToken =
      pendingToken.slice(0, -1) + (pendingToken.endsWith('A') ? 'B' : 'A');
    expect(stoppedPage).toContain('邀請連結無效或已到期</h1>');
    expect(stoppedPage).toBe(await rejectedInvitationPage(tamperedToken));
    expect(stoppedPage).not.toContain(pendingToken);
  });

  it('簽署期限過後：已簽者仍可重新開啟並下載本人副本，同文件待簽者被拒', async () => {
    const { signedToken, pendingToken } =
      await signedAndPendingDocument('期限後重新開啟文件');
    useFakeNow(new Date(Date.now() + 2 * 86_400_000));
    try {
      await downloadPersonalCopy(await openExternalSession(signedToken));
      await rejectedInvitationPage(pendingToken);
    } finally {
      jest.useRealTimers();
    }
  });

  it('簽署尚未開始：建立存取回 409 尚未開始頁、不設 cookie 不記開啟，開始後同一連結可建立存取', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const { id } = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '未來開始文件')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'not-started.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    documentIds.push(Number(id));
    const start = new Date(Date.now() + 3_600_000);
    await request(ctx.server)
      .post(`/api/esign/documents/${id}/initiations`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: [
          { type: 'email', name: '未來簽署人', email: 'future@example.test' },
        ],
        fields: [
          {
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 10,
            widthPercent: 25,
            heightPercent: 10,
            sortOrder: 0,
          },
        ],
        signStartAt: start.toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      })
      .expect(201);
    const [credential] = await db.query<
      Array<{ invitation_token_ciphertext: string }>
    >(
      'SELECT invitation_token_ciphertext FROM esign_signers WHERE document_id = ?',
      [id],
    );
    const invitationToken = tokenService.decrypt(
      credential.invitation_token_ciphertext,
    );
    const openedEvents = async () =>
      (
        await db.query<Array<{ event_type: string }>>(
          `SELECT event_type FROM esign_audit_events
           WHERE document_id = ? AND event_type IN ('external_invitation.opened', 'document.opened')
           ORDER BY id`,
          [id],
        )
      ).map((event) => event.event_type);
    // 台北固定 UTC+8、無日光節約時間
    const taipeiStart = new Date(start.getTime() + 8 * 3_600_000)
      .toISOString()
      .replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}).*$/, '$1/$2/$3 $4');

    const notStarted = await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token: invitationToken })
      .expect(409)
      .expect('Content-Type', /^text\/html/)
      .expect('Cache-Control', 'no-store')
      .expect('Referrer-Policy', 'no-referrer');
    expect(notStarted.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(notStarted.headers['set-cookie']).toBeUndefined();
    expect(notStarted.text).toContain('簽署尚未開始</h1>');
    expect(notStarted.text).toContain(`請於 ${taipeiStart}（台北時間）後簽署`);
    expect(notStarted.text).not.toContain(invitationToken);
    expect(notStarted.text).not.toContain('未來開始文件');
    // 其他外部 API 遇到相同情況回相同錯誤，不回文件內容
    const taskBeforeStart = await request(ctx.server)
      .post('/api/external-signing-task')
      .set('Cookie', `FT_ESIGN_EXTERNAL_ACCESS=${invitationToken}`)
      .set('Origin', 'http://localhost:3000')
      .expect(409);
    expect(apiError(taskBeforeStart)).toEqual({
      code: 'ESIGN_STATE_CONFLICT',
      message: `簽署尚未開始，請於 ${taipeiStart}（台北時間）後簽署`,
      details: { startAt: start.toISOString() },
    });
    expect(await openedEvents()).toEqual([]);

    jest.useFakeTimers({
      now: start,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    try {
      const session = await request(ctx.server)
        .post('/api/external-signature-session')
        .set('Origin', 'http://localhost:3000')
        .type('form')
        .send({ token: invitationToken })
        .expect(303);
      expect(firstCookie(session.headers['set-cookie'])).toContain(
        'FT_ESIGN_EXTERNAL_ACCESS=',
      );
      expect(await openedEvents()).toEqual(['external_invitation.opened']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('到期掃描跨越 100 筆批次且重複執行不新增事件，舊候選不得覆蓋新期限', async () => {
    const [creator] = await db.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE empid=?',
      [creatorEmpid],
    );
    const ids: number[] = [];
    const now = new Date();
    for (let i = 0; i < 101; i++) {
      const docNumber = randomUUID();
      await db.query(
        "INSERT INTO esign_documents (doc_number,title,created_by_user_id,status,sign_start_at,sign_end_at) VALUES (?,'批次到期測試',?,'active',?,?)",
        [
          docNumber,
          creator.id,
          new Date(now.getTime() - 120000),
          new Date(now.getTime() - 60000),
        ],
      );
      const [row] = await db.query<Array<{ id: number }>>(
        'SELECT id FROM esign_documents WHERE doc_number=?',
        [docNumber],
      );
      ids.push(Number(row.id));
      documentIds.push(Number(row.id));
      await db.query(
        "INSERT INTO esign_signers (public_id,document_id,signer_type,user_id,empid_snapshot,name_snapshot) VALUES (?,?,'user',?,?,'批次待簽者')",
        [randomUUID(), row.id, creator.id, creatorEmpid],
      );
    }
    const expiry = new EsignExpiryService(
      ctx.app.get(MysqlService),
      ctx.app.get(DocumentRepository),
      ctx.app.get(SignerRepository),
      ctx.app.get(EsignAuditService),
    );
    // 掃描後期限已更新，鎖內必須以最新期限判定。
    await db.query('UPDATE esign_documents SET sign_end_at=? WHERE id=?', [
      new Date(now.getTime() + 60000),
      ids[0],
    ]);
    expect(await expiry.expireByDeadline(ids[0])).toBe(false);
    await db.query('UPDATE esign_documents SET sign_end_at=? WHERE id=?', [
      new Date(now.getTime() - 60000),
      ids[0],
    ]);
    await expiry.reconcile(now);
    const list = apiData<Array<{ id: string; status: string }>>(
      await request(ctx.server)
        .get('/api/esign/documents?role=created&status=expired')
        .set('Cookie', creatorCookie)
        .expect(200),
    );
    expect(
      ids.every((id) =>
        list.some((doc) => doc.id === String(id) && doc.status === 'expired'),
      ),
    ).toBe(true);
    const before = await esignRowCounts(db);
    await expiry.reconcile(now);
    expect(await esignRowCounts(db)).toEqual(before);
  });

  it('截止當下查詢呈現已到期，並發到期僅一次且已簽證據與個人副本保留', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const { id } = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '到期保留證據')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'expiry.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    documentIds.push(Number(id));
    const [signedUser] = await db.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE empid=?',
      [signerEmpid],
    );
    const [pendingUser] = await db.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE empid=?',
      [creatorEmpid],
    );
    const end = new Date(Date.now() + 60_000);
    const active = apiData<DocumentDetail>(
      await request(ctx.server)
        .post(`/api/esign/documents/${id}/initiations`)
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          signers: [
            { type: 'user', userId: String(signedUser.id) },
            { type: 'user', userId: String(pendingUser.id) },
            { type: 'email', name: '外部待簽', email: 'expiry@example.test' },
          ],
          fields: [
            {
              type: 'signature',
              page: 1,
              xPercent: 10,
              yPercent: 10,
              widthPercent: 25,
              heightPercent: 10,
              sortOrder: 0,
            },
          ],
          signStartAt: new Date(Date.now() - 60_000).toISOString(),
          signEndAt: end.toISOString(),
          watermark: false,
          allowReject: false,
        })
        .expect(201),
    );
    const task = apiData<SigningTask>(
      await request(ctx.server)
        .post(`/api/esign/signing-tasks/${active.signers[0].publicId}`)
        .set('Cookie', signerCookie)
        .set('Origin', 'http://localhost:3000')
        .expect(201),
    );
    const submission = {
      requestId: randomUUID(),
      consentVersion: task.consent.version,
      accepted: true,
      signatures: task.fields.map((field) => ({
        fieldId: field.id,
        pngDataUrl: PNG_DATA_URL,
      })),
    };
    const signed = apiData<{ verificationUrl: string }>(
      await request(ctx.server)
        .post(
          `/api/esign/signing-tasks/${active.signers[0].publicId}/signatures`,
        )
        .set('Cookie', signerCookie)
        .set('Origin', 'http://localhost:3000')
        .send(submission)
        .expect(201),
    );
    const snapshot = () =>
      db.query(
        'SELECT signing_payload_json, signing_payload_sha256 FROM esign_documents WHERE id=?',
        [id],
      );
    const evidence = () =>
      db.query(
        'SELECT r.* FROM esign_signature_records r JOIN esign_signers s ON s.id=r.signer_id WHERE s.document_id=?',
        [id],
      );
    const beforeSnapshot: unknown = await snapshot();
    const beforeEvidence: unknown = await evidence();
    const beforeCounts = await esignRowCounts(db);
    jest.useFakeTimers({
      now: end,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    try {
      const detail = apiData<Record<string, unknown>>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}`)
          .set('Cookie', creatorCookie)
          .expect(200),
      );
      expect(detail).toMatchObject({
        status: 'expired',
        signEndAt: end.toISOString(),
        originalSignEndAt: end.toISOString(),
        isReopened: false,
        stopReason: null,
      });
      const expiredList = apiData<Array<{ id: string }>>(
        await request(ctx.server)
          .get('/api/esign/documents?status=expired')
          .set('Cookie', creatorCookie)
          .expect(200),
      );
      expect(expiredList.map((d) => d.id)).toContain(id);
      const activeList = apiData<Array<{ id: string }>>(
        await request(ctx.server)
          .get('/api/esign/documents?status=active')
          .set('Cookie', creatorCookie)
          .expect(200),
      );
      expect(activeList.map((d) => d.id)).not.toContain(id);
      const pending = apiData<
        Array<{ document: { id: string; status: string } }>
      >(
        await request(ctx.server)
          .get('/api/esign/signing-tasks?status=pending')
          .set('Cookie', creatorCookie)
          .expect(200),
      );
      expect(pending.find((t) => t.document.id === id)?.document.status).toBe(
        'expired',
      );
      expect(await esignRowCounts(db)).toEqual(beforeCounts);
      expect(
        await db.query('SELECT status FROM esign_documents WHERE id=?', [id]),
      ).toEqual([{ status: 'active' }]);
      await request(ctx.server)
        .post(
          `/api/esign/signing-tasks/${active.signers[1].publicId}/signatures`,
        )
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({ ...submission, requestId: randomUUID() })
        .expect(409);
      expect(
        apiData<{ documentStatus: string }>(
          await request(ctx.server)
            .post(
              `/api/esign/signing-tasks/${active.signers[0].publicId}/signatures`,
            )
            .set('Cookie', signerCookie)
            .set('Origin', 'http://localhost:3000')
            .send(submission)
            .expect(200),
        ).documentStatus,
      ).toBe('expired');
      const expiry = new EsignExpiryService(
        ctx.app.get(MysqlService),
        ctx.app.get(DocumentRepository),
        ctx.app.get(SignerRepository),
        ctx.app.get(EsignAuditService),
      );
      expect(
        await Promise.all([
          expiry.expireByDeadline(Number(id)),
          expiry.expireByDeadline(Number(id)),
        ]),
      ).toEqual(expect.arrayContaining([true, false]));
      const history = apiData<Array<{ type: string }>>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}/history`)
          .set('Cookie', creatorCookie)
          .expect(200),
      );
      expect(history.filter((e) => e.type === 'document.expired')).toHaveLength(
        1,
      );
      const signerHistory = apiData<Array<{ type: string }>>(
        await request(ctx.server)
          .get(`/api/esign/documents/${id}/history`)
          .set('Cookie', signerCookie)
          .expect(200),
      );
      expect(
        signerHistory.some((event) => event.type === 'document.expired'),
      ).toBe(true);
      expect(
        history.some((e) => e.type === 'document.stopped_by_deadline'),
      ).toBe(false);
      expect(await snapshot()).toEqual(beforeSnapshot);
      expect(await evidence()).toEqual(beforeEvidence);
      await request(ctx.server)
        .get(
          `/api/esign/signing-tasks/${active.signers[0].publicId}/source-file`,
        )
        .set('Cookie', signerCookie)
        .expect(200);
      await request(ctx.server)
        .get(
          `/api/esign/signing-tasks/${active.signers[1].publicId}/source-file`,
        )
        .set('Cookie', creatorCookie)
        .expect(409);
      expect(
        apiData<SignatureVerification>(
          await getSignatureVerification(
            ctx.server,
            signed.verificationUrl,
          ).expect(200),
        ).document.status,
      ).toBe('expired');
      const [external] = await db.query<
        Array<{ invitation_token_sha256: string | null }>
      >(
        "SELECT invitation_token_sha256 FROM esign_signers WHERE document_id=? AND signer_type='email'",
        [id],
      );
      expect(external.invitation_token_sha256).toBeNull();
    } finally {
      jest.useRealTimers();
    }
    const queue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_FINALIZATION_QUEUE),
    );
    await queue.pause();
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      const [owner] = await db.query<Array<{ id: number }>>(
        "SELECT id FROM esign_signers WHERE document_id=? AND status='signed'",
        [id],
      );
      await worker.get(DocumentFinalizationProcessor).process({
        data: { documentId: Number(id), signerId: Number(owner.id) },
      } as Job<{ documentId: number; signerId: number }>);
      await request(ctx.server)
        .get(
          `/api/esign/signing-tasks/${active.signers[0].publicId}/completed-file`,
        )
        .set('Cookie', signerCookie)
        .expect(200);
      expect(
        apiData<{ status: string }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${id}`)
            .set('Cookie', creatorCookie)
            .expect(200),
        ).status,
      ).toBe('expired');
    } finally {
      await worker.close();
      await queue.resume();
    }
    expect(
      apiData<{ status: string }>(
        await request(ctx.server)
          .post(`/api/esign/documents/${id}/stoppages`)
          .set('Cookie', creatorCookie)
          .set('Origin', 'http://localhost:3000')
          .send({ reason: '不再需要補簽' })
          .expect(201),
      ).status,
    ).toBe('stopped');
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
        fields: Array.from({ length: 1 }, (_, index) => ({
          type: 'signature',
          page: 1,
          xPercent: 10,
          yPercent: 10 + index * 20,
          widthPercent: 25,
          heightPercent: 10,
          sortOrder: index,
        })),
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      })
      .expect(201);
    assigned[0].publicId =
      apiData<DocumentDetail>(initiated).signers[0].publicId;

    // 內部簽署人的任務列表帶出簽署期間與發起人
    const myTasks = apiData<
      Array<{ signerPublicId: string; document: object }>
    >(
      await request(ctx.server)
        .get('/api/esign/signing-tasks')
        .set('Cookie', signerCookie)
        .expect(200),
    );
    expect(
      myTasks.find((task) => task.signerPublicId === assigned[0].publicId)
        ?.document,
    ).toMatchObject({
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

    // 內部簽署：簽署前無驗證網址，簽署後任務、重開與建立人詳情回同一網址
    const taskPath = `/api/esign/signing-tasks/${assigned[0].publicId}`;
    const openTask = () =>
      request(ctx.server)
        .post(taskPath)
        .set('Cookie', signerCookie)
        .set('Origin', 'http://localhost:3000')
        .expect(201);
    const internalTask = apiData<SigningTask>(await openTask());
    expect(internalTask.signer.verificationUrl).toBeNull();
    const internalSigned = apiData<{ verificationUrl: string }>(
      await request(ctx.server)
        .post(`${taskPath}/signatures`)
        .set('Cookie', signerCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          requestId: randomUUID(),
          consentVersion: internalTask.consent.version,
          accepted: true,
          signatures: [
            { fieldId: internalTask.fields[0].id, pngDataUrl: PNG_DATA_URL },
          ],
        })
        .expect(201),
    );
    expect(internalSigned.verificationUrl).toMatch(VERIFICATION_URL);
    const tasksAfterSign = apiData<SigningTask[]>(
      await request(ctx.server)
        .get('/api/esign/signing-tasks')
        .set('Cookie', signerCookie)
        .expect(200),
    );
    expect(
      tasksAfterSign.find(
        (task) => task.signerPublicId === assigned[0].publicId,
      )?.signer.verificationUrl,
    ).toBe(internalSigned.verificationUrl);
    expect(apiData<SigningTask>(await openTask()).signer.verificationUrl).toBe(
      internalSigned.verificationUrl,
    );
    expect(
      apiData<DocumentDetail>(
        await request(ctx.server)
          .get(`/api/esign/documents/${documentId}`)
          .set('Cookie', creatorCookie)
          .expect(200),
      ).signers[0].verificationUrl,
    ).toBe(internalSigned.verificationUrl);
    expect(
      apiData<SignatureVerification>(
        await getSignatureVerification(
          ctx.server,
          internalSigned.verificationUrl,
        ).expect(200),
      ).signature.authenticationMethod,
    ).toBe('employee_session');
  });

  it('10 人共用 3 欄位各產一份 PDF，先簽先下載、跨人拒絕、全 ready 才結案', async () => {
    const cookies: string[] = [],
      userIds: number[] = [];
    for (const empid of personalEmpids) {
      cookies.push(await login(empid));
      const [user] = await db.query<Array<{ id: number }>>(
        'SELECT id FROM users WHERE empid = ?',
        [empid],
      );
      userIds.push(Number(user.id));
    }
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', '10 人個人副本')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'personal.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    const id = Number(created.id);
    documentIds.push(id);
    const fields = ['signature', 'date', 'signature'].map((type, i) => ({
      type,
      page: 1,
      xPercent: 10,
      yPercent: 10 + i * 20,
      widthPercent: 25,
      heightPercent: 10,
      sortOrder: i,
    }));
    const active = apiData<DocumentDetail>(
      await request(ctx.server)
        .post('/api/esign/documents/' + id + '/initiations')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          signers: userIds.map((userId) => ({
            type: 'user',
            userId: String(userId),
          })),
          fields,
          signStartAt: new Date(Date.now() - 60_000).toISOString(),
          signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
          watermark: false,
          allowReject: false,
        })
        .expect(201),
    );
    const owners = await db.query<Array<{ id: number; public_id: string }>>(
      'SELECT id, public_id FROM esign_signers WHERE document_id = ? ORDER BY sort_order',
      [id],
    );
    const queue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_FINALIZATION_QUEUE),
    );
    await queue.pause();
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    const processor = worker.get(DocumentFinalizationProcessor);
    const process = (i: number) =>
      processor.process({
        data: { documentId: id, signerId: Number(owners[i].id) },
      } as Job<{ documentId: number; signerId: number }>);
    const taskIds: string[][] = [];
    const sign = async (i: number) => {
      const publicId = active.signers[i].publicId;
      const task = apiData<SigningTask>(
        await request(ctx.server)
          .post('/api/esign/signing-tasks/' + publicId)
          .set('Cookie', cookies[i])
          .set('Origin', 'http://localhost:3000')
          .expect(201),
      );
      taskIds[i] = task.fields.map((field) => field.id);
      const submission = {
        requestId: randomUUID(),
        consentVersion: task.consent.version,
        accepted: true,
        signatures: task.fields
          .filter((field) => field.type === 'signature')
          .map((field) => ({
            fieldId: field.id,
            pngDataUrl:
              'data:image/png;base64,' + esignTestPng(i + 1).toString('base64'),
          })),
      };
      await request(ctx.server)
        .post('/api/esign/signing-tasks/' + publicId + '/signatures')
        .set('Cookie', cookies[i])
        .set('Origin', 'http://localhost:3000')
        .send(submission)
        .expect(201);
      // 同 request 重送只回既有證據，不再保存 PNG。
      await request(ctx.server)
        .post('/api/esign/signing-tasks/' + publicId + '/signatures')
        .set('Cookie', cookies[i])
        .set('Origin', 'http://localhost:3000')
        .send(submission)
        .expect(200);
    };
    try {
      const firstTask = apiData<SigningTask>(
        await request(ctx.server)
          .post('/api/esign/signing-tasks/' + active.signers[0].publicId)
          .set('Cookie', cookies[0])
          .set('Origin', 'http://localhost:3000')
          .expect(201),
      );
      const firstField = firstTask.fields.find(
        (field) => field.type === 'signature',
      )!;
      await db.query(
        'UPDATE esign_document_fields SET x_percent=x_percent+1 WHERE id=?',
        [firstField.id],
      );
      const tampered = await request(ctx.server)
        .post(
          '/api/esign/signing-tasks/' +
            active.signers[0].publicId +
            '/signatures',
        )
        .set('Cookie', cookies[0])
        .set('Origin', 'http://localhost:3000')
        .send({
          requestId: randomUUID(),
          consentVersion: firstTask.consent.version,
          accepted: true,
          signatures: firstTask.fields
            .filter((field) => field.type === 'signature')
            .map((field) => ({
              fieldId: field.id,
              pngDataUrl:
                'data:image/png;base64,' + esignTestPng(1).toString('base64'),
            })),
        })
        .expect(409);
      expect(apiError(tampered).code).toBe('ESIGN_INTEGRITY_FAILED');
      await db.query(
        'UPDATE esign_document_fields SET x_percent=x_percent-1 WHERE id=?',
        [firstField.id],
      );
      await sign(0);
      await process(0);
      const [progress] = await db.query<Array<{ status: string }>>(
        'SELECT status FROM esign_documents WHERE id = ?',
        [id],
      );
      expect(progress.status).toBe('active');
      const ownPath =
        '/api/esign/signing-tasks/' + owners[0].public_id + '/completed-file';
      await request(ctx.server)
        .get(ownPath)
        .set('Cookie', cookies[0])
        .expect(200);
      await request(ctx.server)
        .get(ownPath)
        .set('Cookie', cookies[1])
        .expect(404);
      await request(ctx.server)
        .get(
          '/api/esign/signing-tasks/' + owners[1].public_id + '/completed-file',
        )
        .set('Cookie', cookies[1])
        .expect(409);
      for (let i = 1; i < 8; i += 1) {
        await sign(i);
        await process(i);
      }
      await Promise.all([sign(8), sign(9)]);
      const [waiting] = await db.query<Array<{ status: string }>>(
        'SELECT status FROM esign_documents WHERE id = ?',
        [id],
      );
      expect(waiting.status).toBe('finalizing');
      await Promise.all([process(8), process(9)]);
      for (const ids of taskIds) expect(ids).toEqual(taskIds[0]);
      expect(taskIds[0]).toHaveLength(3);
      const files = await db.query<
        Array<{
          signer_id: number;
          public_id: string;
          sha256: string;
          document_id: number | null;
        }>
      >(
        "SELECT r.signer_id, s.public_id, f.sha256, f.document_id FROM esign_file_objects f JOIN esign_signature_records r ON r.id = f.signature_record_id JOIN esign_signers s ON s.id = r.signer_id WHERE s.document_id = ? AND f.file_purpose = 'completed_pdf' ORDER BY s.sort_order",
        [id],
      );
      expect(files).toHaveLength(10);
      expect(new Set(files.map((file) => file.sha256)).size).toBe(10);
      for (let i = 0; i < files.length; i += 1) {
        expect(files[i].document_id).toBeNull();
        expect(Number(files[i].signer_id)).toBe(Number(owners[i].id));
        const response = await request(ctx.server)
          .get(
            '/api/esign/documents/' +
              id +
              '/signers/' +
              files[i].public_id +
              '/completed-file',
          )
          .set('Cookie', creatorCookie)
          .expect(200);
        expect(
          createHash('sha256')
            .update(response.body as Buffer)
            .digest('hex'),
        ).toBe(files[i].sha256);
        expect(
          (await PDFDocument.load(response.body as Buffer)).getPageCount(),
        ).toBe(1);
      }
      await process(0);
      const [result] = await db.query<
        Array<{
          status: string;
          events: number;
          records: number;
          fields: number;
        }>
      >(
        "SELECT d.status, (SELECT COUNT(*) FROM esign_audit_events a WHERE a.document_id = d.id AND a.event_type = 'document.completed') events, (SELECT COUNT(*) FROM esign_signature_records r JOIN esign_signers s ON s.id = r.signer_id WHERE s.document_id = d.id) records, (SELECT COUNT(*) FROM esign_document_fields f WHERE f.document_id = d.id) fields FROM esign_documents d WHERE d.id = ?",
        [id],
      );
      expect(result).toMatchObject({
        status: 'completed',
        events: 1,
        records: 10,
        fields: 3,
      });
    } finally {
      await worker.close();
      await queue.resume();
    }
  }, 30_000);

  it('同一瀏覽器先後開啟兩份文件的邀請：舊分頁送出的簽署人與新 cookie 不符時拒絕，兩份都不簽署', async () => {
    const first = await initiateEmailDocument(
      '先開啟的邀請',
      'tab-a@example.test',
    );
    const second = await initiateEmailDocument(
      '後開啟的邀請',
      'tab-b@example.test',
    );
    const firstAccess = await openExternalSession(first.token);
    const firstTask = apiData<SigningTask>(
      await request(ctx.server)
        .post('/api/external-signing-task')
        .set('Cookie', firstAccess)
        .set('Origin', 'http://localhost:3000')
        .expect(200),
    );
    // 同名同 path 的 cookie：後開啟的邀請覆蓋先前的存取
    const secondAccess = await openExternalSession(second.token);
    const rejected = await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', secondAccess)
      .set('Origin', 'http://localhost:3000')
      .send({
        signerPublicId: firstTask.signerPublicId,
        requestId: randomUUID(),
        consentVersion: firstTask.consent.version,
        accepted: true,
        signatures: firstTask.fields
          .filter((field) => field.type === 'signature')
          .map((field) => ({ fieldId: field.id, pngDataUrl: PNG_DATA_URL })),
      })
      .expect(409);
    expect(apiError(rejected).message).toBe(
      '此頁面的簽署對象已變更，請重新開啟邀請信中的連結',
    );
    const statuses = await db.query<Array<{ status: string }>>(
      'SELECT status FROM esign_signers WHERE document_id IN (?, ?) ORDER BY id',
      [first.documentId, second.documentId],
    );
    expect(statuses).toEqual([{ status: 'pending' }, { status: 'pending' }]);
  });

  it('同一文件兩位外部簽署人：cookie 被覆蓋後舊分頁送出的簽署人不符時拒絕，兩人都維持未簽', async () => {
    const { documentId, tokens } = await initiateEmailDocument(
      '兩位外部簽署人',
      'signer-a@example.test',
      'signer-b@example.test',
    );
    const firstAccess = await openExternalSession(tokens[0]);
    const firstTask = apiData<SigningTask>(
      await request(ctx.server)
        .post('/api/external-signing-task')
        .set('Cookie', firstAccess)
        .set('Origin', 'http://localhost:3000')
        .expect(200),
    );
    // 同一瀏覽器再開啟第二位的邀請：cookie 被覆蓋，第一位的舊分頁仍開著
    const secondAccess = await openExternalSession(tokens[1]);
    const submitFromFirstTab = (body: { signerPublicId?: string }) =>
      request(ctx.server)
        .post('/api/external-signing-task/signatures')
        .set('Cookie', secondAccess)
        .set('Origin', 'http://localhost:3000')
        .send({
          ...body,
          requestId: randomUUID(),
          consentVersion: firstTask.consent.version,
          accepted: true,
          signatures: firstTask.fields
            .filter((field) => field.type === 'signature')
            .map((field) => ({ fieldId: field.id, pngDataUrl: PNG_DATA_URL })),
        });
    await submitFromFirstTab({}).expect(400);
    await submitFromFirstTab({ signerPublicId: 'not-a-uuid' }).expect(400);
    const rejected = await submitFromFirstTab({
      signerPublicId: firstTask.signerPublicId,
    }).expect(409);
    expect(apiError(rejected)).toMatchObject({
      code: 'ESIGN_STATE_CONFLICT',
      message: '此頁面的簽署對象已變更，請重新開啟邀請信中的連結',
    });
    const statuses = await db.query<Array<{ status: string }>>(
      'SELECT status FROM esign_signers WHERE document_id = ? ORDER BY sort_order',
      [documentId],
    );
    expect(statuses).toEqual([{ status: 'pending' }, { status: 'pending' }]);
  });

  /** 發起 email 簽署人共用一個簽名欄位的文件，回傳第一位與依名單順序的所有邀請 token */
  async function initiateEmailDocument(title: string, ...emails: string[]) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', 'http://localhost:3000')
        .field('title', title)
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'invitation.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    const documentId = Number(created.id);
    documentIds.push(documentId);
    await request(ctx.server)
      .post(`/api/esign/documents/${documentId}/initiations`)
      .set('Cookie', creatorCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signers: emails.map((email) => ({ type: 'email', name: title, email })),
        fields: [
          {
            type: 'signature',
            page: 1,
            xPercent: 10,
            yPercent: 10,
            widthPercent: 25,
            heightPercent: 10,
            sortOrder: 0,
          },
        ],
        signStartAt: new Date(Date.now() - 60_000).toISOString(),
        signEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        watermark: false,
        allowReject: false,
      })
      .expect(201);
    const credentials = await db.query<
      Array<{ invitation_token_ciphertext: string }>
    >(
      'SELECT invitation_token_ciphertext FROM esign_signers WHERE document_id = ? ORDER BY sort_order',
      [documentId],
    );
    const tokens = credentials.map((credential) =>
      tokenService.decrypt(credential.invitation_token_ciphertext),
    );
    return { documentId, token: tokens[0], tokens };
  }

  async function openExternalSession(token: string): Promise<string> {
    const session = await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token })
      .expect(303);
    return firstCookie(session.headers['set-cookie']);
  }

  /** 建立存取被拒：401 失效頁、不設 cookie，回傳頁面內容 */
  async function rejectedInvitationPage(token: string): Promise<string> {
    const page = await request(ctx.server)
      .post('/api/external-signature-session')
      .set('Origin', 'http://localhost:3000')
      .type('form')
      .send({ token })
      .expect(401)
      .expect('Content-Type', /^text\/html/);
    expect(page.headers['set-cookie']).toBeUndefined();
    return page.text;
  }

  /** 以外部存取 cookie 開啟任務並簽署所有簽名欄位 */
  async function signAsExternal(accessCookie: string): Promise<void> {
    const task = apiData<SigningTask>(
      await request(ctx.server)
        .post('/api/external-signing-task')
        .set('Cookie', accessCookie)
        .set('Origin', 'http://localhost:3000')
        .expect(200),
    );
    await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', accessCookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        signerPublicId: task.signerPublicId,
        requestId: randomUUID(),
        consentVersion: task.consent.version,
        accepted: true,
        signatures: task.fields
          .filter((field) => field.type === 'signature')
          .map((field) => ({ fieldId: field.id, pngDataUrl: PNG_DATA_URL })),
      })
      .expect(201);
  }

  /** 兩名 email 簽署人的文件：第一位已簽署且本人副本已產生，第二位待簽 */
  async function signedAndPendingDocument(title: string) {
    const {
      documentId,
      tokens: [signedToken, pendingToken],
    } = await initiateEmailDocument(
      title,
      'reopen-signed@example.test',
      'reopen-pending@example.test',
    );
    await signAsExternal(await openExternalSession(signedToken));
    const [signer] = await db.query<Array<{ id: number }>>(
      "SELECT id FROM esign_signers WHERE document_id = ? AND status = 'signed'",
      [documentId],
    );
    await producePersonalCopy(documentId, Number(signer.id));
    return { documentId, signedToken, pendingToken };
  }

  /** 直接執行本人副本產製；先暫停 queue，避免 worker 的 consumer 競爭 lease */
  async function producePersonalCopy(documentId: number, signerId: number) {
    const queue = ctx.app.get<Queue>(
      getQueueToken(ESIGN_DOCUMENT_FINALIZATION_QUEUE),
    );
    await queue.pause();
    const worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    try {
      await worker.get(DocumentFinalizationProcessor).process({
        data: { documentId, signerId },
      } as Job<{ documentId: number; signerId: number }>);
    } finally {
      await worker.close();
      await queue.resume();
    }
  }

  async function downloadPersonalCopy(accessCookie: string): Promise<Buffer> {
    const copy = await request(ctx.server)
      .get('/api/external-signing-task/completed-file')
      .set('Cookie', accessCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    return copy.body as Buffer;
  }

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

/** 只假造目前時間；計時器維持真實，HTTP、DB 與 queue 照常運作 */
function useFakeNow(now: Date): void {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

function firstCookie(value: unknown): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (typeof cookie !== 'string') throw new Error('缺少 cookie');
  return cookie;
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
