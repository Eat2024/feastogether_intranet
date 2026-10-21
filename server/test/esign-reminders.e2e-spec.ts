import { ExternalReminders1792454402000 } from '#app/infrastructure/database/migrations/1792454402000-ExternalReminders';
import { openExternalSession, requestOtp } from './external-session.helper';
import type { Job } from 'bullmq';
import { ExternalInvitationProcessor } from '#app/worker/esign/external-invitation.processor';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { INVITATION_MAIL_SENDER } from '#app/infrastructure/mail/invitation-mail-sender.port';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { FeastogetherHrService } from '#app/infrastructure/http-client/feastogether/services/feastogether-hr.service';
import { apiData } from './api-response.helper';
import {
  closeSecurityE2eApp,
  createSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';
function launchJwt(empid: string) {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const prefix = `${encode({ alg: 'RS256', typ: 'FT-ESIGN-LAUNCH+JWT' })}.${encode({ iss: 'e2e-main-platform', aud: 'e2e-esign', sub: empid, jti: randomUUID(), iat: now, nbf: now, exp: now + 120 })}`;
  return `${prefix}.${sign('RSA-SHA256', Buffer.from(prefix), createPrivateKey(Buffer.from(process.env.WEBVIEW_TEST_PRIVATE_KEY_B64!, 'base64').toString())).toString('base64url')}`;
}

interface Detail {
  id: string;
  signers: { publicId: string }[];
}
interface Batch {
  batchId: string;
  queuedCount: number;
  notSentCount: number;
  items: {
    signerPublicId: string;
    status: string;
    reasonCode: string | null;
  }[];
}
describe('外部催簽 API', () => {
  let ctx: SecurityE2eContext;
  let db: DataSource;
  let cookie: string;
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(FeastogetherHrService).useValue({
        getStaffEmails: syntheticStaffEmails,
        lookupEligibleStaff: async (empid: string) => ({
          person_empid: empid,
          person_name: '催簽測試',
          person_status: 1,
          person_status_name: '正式',
          department_id: 'D009',
          department_name: '測試部',
          title: '測試員工',
        }),
      }),
    );
    db = ctx.app.get(MYSQL_MAIN);
    const launch = await request(ctx.server)
      .post('/api/auth/webview-launches')
      .set('Authorization', `Bearer ${launchJwt('E2E00905')}`)
      .expect(201);
    const code = new URL(
      apiData<{ launchUrl: string }>(launch).launchUrl,
    ).searchParams.get('code');
    const session = await request(ctx.server)
      .post('/api/auth/session')
      .type('form')
      .send({ code })
      .expect(303);
    cookie = String(session.headers['set-cookie'][0]);
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });
  async function create(
    signers: object[] = [
      { type: 'email', name: '外部測試', email: 'reminder@example.test' },
    ],
  ) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '催簽測試')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'reminder.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    return apiData<Detail>(
      await request(ctx.server)
        .post(`/api/esign/documents/${created.id}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({
          signers,
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
          signStartAt: new Date(Date.now() - 60000).toISOString(),
          signEndAt: new Date(Date.now() + 86400000).toISOString(),
          watermark: false,
          allowReject: true,
        })
        .expect(201),
    );
  }
  const post = (id: string, body: object) =>
    request(ctx.server)
      .post(`/api/esign/documents/${id}/notification-batches`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  it('單人申請受理並可追查，同請求重送重用批次，另一申請阻擋排隊中對象', async () => {
    const doc = await create();
    const body = {
      requestId: randomUUID(),
      selection: 'selected',
      signerPublicIds: [doc.signers[0].publicId],
    };
    const first = apiData<Batch>(await post(doc.id, body).expect(202));
    expect(first).toMatchObject({
      queuedCount: 1,
      notSentCount: 0,
      items: [
        {
          signerPublicId: doc.signers[0].publicId,
          status: 'pending',
          reasonCode: null,
        },
      ],
    });
    expect(apiData<Batch>(await post(doc.id, body).expect(202))).toEqual(first);
    const read = await request(ctx.server)
      .get(
        `/api/esign/documents/${doc.id}/notification-batches/${first.batchId}`,
      )
      .set('Cookie', cookie)
      .expect(200);
    expect(apiData<Batch>(read)).toEqual(first);
    await post(doc.id, { ...body, requestId: randomUUID() }).expect(409);
    await post(doc.id, {
      ...body,
      selection: 'all_pending',
      signerPublicIds: undefined,
    }).expect(409);
    expect(JSON.stringify(first)).not.toMatch(
      /ciphertext|sha256|invitationToken|recipientEmail/,
    );
  });
  it('寄出催簽並保留原邀請，提醒入口必須通過 OTP，成功不重寄', async () => {
    const doc = await create();
    const batch = apiData<Batch>(
      await post(doc.id, {
        requestId: randomUUID(),
        selection: 'selected',
        signerPublicIds: [doc.signers[0].publicId],
      }).expect(202),
    );
    const ids = await db.query<Array<{ id: number }>>(
      'SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.public_id=?',
      [batch.batchId],
    );
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    const processor = new ExternalInvitationProcessor(
      ctx.app.get(MysqlService),
      ctx.app.get(NotificationRepository),
      ctx.app.get(SignerRepository),
      ctx.app.get(EsignTokenService),
      ctx.app.get(EsignAuditService),
      mailer,
    );
    const before = mailer.deliveries.length;
    const job = { data: { notificationLogId: ids[0].id } } as Job<{
      notificationLogId: number;
    }>;
    await processor.process(job);
    const result = apiData<Batch>(
      await request(ctx.server)
        .get(
          `/api/esign/documents/${doc.id}/notification-batches/${batch.batchId}`,
        )
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(result.items[0]).toMatchObject({ status: 'delivered' });
    expect(mailer.deliveries.slice(before)).toHaveLength(1);
    const sent = mailer.deliveries[before];
    expect(sent.recipientEmail).toBe('reminder@example.test');
    await request(ctx.server)
      .get(`/api/external-signature-invitations/${sent.invitationToken}`)
      .expect(200);
    await processor.process(job);
    expect(mailer.deliveries.slice(before)).toHaveLength(1);
    await post(doc.id, {
      requestId: randomUUID(),
      selection: 'selected',
      signerPublicIds: [doc.signers[0].publicId],
    }).expect(409);
  });
  async function queueOne(doc: Detail) {
    const batch = apiData<Batch>(
      await post(doc.id, {
        requestId: randomUUID(),
        selection: 'selected',
        signerPublicIds: [doc.signers[0].publicId],
      }).expect(202),
    );
    const rows = await db.query<Array<{ id: number }>>(
      'SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.public_id=?',
      [batch.batchId],
    );
    return {
      batch,
      job: { data: { notificationLogId: rows[0].id } } as Job<{
        notificationLogId: number;
      }>,
    };
  }
  function worker(
    mailer = ctx.app.get<FakeInvitationMailSender>(INVITATION_MAIL_SENDER),
  ) {
    return new ExternalInvitationProcessor(
      ctx.app.get(MysqlService),
      ctx.app.get(NotificationRepository),
      ctx.app.get(SignerRepository),
      ctx.app.get(EsignTokenService),
      ctx.app.get(EsignAuditService),
      mailer,
    );
  }
  async function result(doc: Detail, batch: Batch) {
    return apiData<Batch>(
      await request(ctx.server)
        .get(
          `/api/esign/documents/${doc.id}/notification-batches/${batch.batchId}`,
        )
        .set('Cookie', cookie)
        .expect(200),
    );
  }
  it('補簽後舊排隊催簽略過，建立人可再主動寄送新輪次催簽', async () => {
    const doc = await create();
    const { batch, job } = await queueOne(doc);
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    await db.query('UPDATE esign_documents SET sign_end_at=? WHERE id=?', [
      new Date(expiredAt),
      doc.id,
    ]);
    await request(ctx.server)
      .post(`/api/esign/documents/${doc.id}/reopenings`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        expectedSignEndAt: expiredAt,
        signEndAt: new Date(Date.now() + 172800000).toISOString(),
        reason: '新輪次催簽',
      })
      .expect(201);
    expect((await result(doc, batch)).items[0].status).toBe('pending');
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    const sent = mailer.deliveries.length;
    await worker().process(job);
    expect(mailer.deliveries.length).toBe(sent);
    expect((await result(doc, batch)).items[0]).toMatchObject({
      status: 'skipped',
      reasonCode: 'INVITATION_GENERATION_CHANGED',
    });
    const next = await queueOne(doc);
    await worker().process(next.job);
    expect((await result(doc, next.batch)).items[0].status).toBe('delivered');
    expect(mailer.deliveries.length).toBe(sent + 1);
  });

  it('補簽保留催簽的未知寄送結果，不覆寫為失敗或再次寄出', async () => {
    const doc = await create();
    const { batch, job } = await queueOne(doc);
    await db.query(
      "UPDATE esign_notification_logs SET result='unknown', error_code='DELIVERY_OUTCOME_UNKNOWN', completed_at=UTC_TIMESTAMP(6), reminder_token_ciphertext=NULL WHERE id=?",
      [job.data.notificationLogId],
    );
    const before = await result(doc, batch);
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    await db.query('UPDATE esign_documents SET sign_end_at=? WHERE id=?', [
      new Date(expiredAt),
      doc.id,
    ]);
    await request(ctx.server)
      .post(`/api/esign/documents/${doc.id}/reopenings`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        expectedSignEndAt: expiredAt,
        signEndAt: new Date(Date.now() + 172800000).toISOString(),
        reason: '補簽保留通知證據',
      })
      .expect(201);
    expect(await result(doc, batch)).toEqual(before);
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    const sent = mailer.deliveries.length;
    await worker().process(job);
    expect(mailer.deliveries.length).toBe(sent);
    expect(await result(doc, batch)).toEqual(before);
  });

  it('原邀請已寄並清除密文後仍能催簽，新舊信均需 OTP，世代變更使舊催簽失效', async () => {
    const doc = await create();
    const initial = await db.query<Array<{ id: number }>>(
      "SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=? AND b.kind='invitation'",
      [doc.id],
    );
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    await worker().process({
      data: { notificationLogId: initial[0].id },
    } as Job<{ notificationLogId: number }>);
    const originalToken = mailer.deliveries.at(-1)!.invitationToken;
    const queued = await queueOne(doc);
    await worker().process(queued.job);
    const reminderToken = mailer.deliveries.at(-1)!.invitationToken;
    expect(reminderToken).not.toBe(originalToken);
    await request(ctx.server).get('/api/external-signing-task').expect(401);
    const reminderSession = await openExternalSession(ctx, reminderToken);
    expect(
      apiData<{ signerPublicId: string }>(
        await request(ctx.server)
          .get('/api/external-signing-task')
          .set('Cookie', reminderSession)
          .expect(200),
      ).signerPublicId,
    ).toBe(doc.signers[0].publicId);
    const originalSession = await openExternalSession(ctx, originalToken);
    await request(ctx.server)
      .get('/api/external-signing-task')
      .set('Cookie', originalSession)
      .expect(200);
    await db.query(
      'UPDATE esign_signers SET invitation_token_sha256=? WHERE public_id=?',
      [
        ctx.app.get(EsignTokenService).createInvitationToken().digest,
        doc.signers[0].publicId,
      ],
    );
    // HTML 邀請頁統一回 200，以無效內容避免洩漏；OTP 入口不得接受舊憑證。
    const denied = await requestOtp(ctx, reminderToken);
    expect(denied.status).toBe(401);
  });
  it('SMTP 未知結果不重寄、當日佔額度，回應不含原始錯誤或憑證', async () => {
    const doc = await create();
    const queued = await queueOne(doc);
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    const send = jest
      .spyOn(mailer, 'send')
      .mockRejectedValue(new Error('smtp secret@example.test token=secret'));
    try {
      await worker().process(queued.job);
      await worker().process(queued.job);
    } finally {
      send.mockRestore();
    }
    const view = await result(doc, queued.batch);
    expect(view.items[0]).toMatchObject({
      status: 'unknown',
      reasonCode: 'DELIVERY_OUTCOME_UNKNOWN',
      attemptCount: 1,
    });
    expect(JSON.stringify(view)).not.toMatch(/secret|token|smtp/);
    await post(doc.id, {
      requestId: randomUUID(),
      selection: 'selected',
      signerPublicIds: [doc.signers[0].publicId],
    }).expect(409);
  });
  it('明確未寄送最多三次，重試同一明細；終態不再投遞', async () => {
    const doc = await create();
    const queued = await queueOne(doc);
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    const send = jest
      .spyOn(mailer, 'send')
      .mockRejectedValue({ responseCode: 450 });
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        await db.query(
          'UPDATE esign_notification_logs SET next_attempt_at=NULL WHERE id=?',
          [queued.job.data.notificationLogId],
        );
        await worker().process(queued.job);
      }
    } finally {
      send.mockRestore();
    }
    expect((await result(doc, queued.batch)).items[0]).toMatchObject({
      status: 'failed',
      attemptCount: 3,
    });
    const before = mailer.deliveries.length;
    await worker().process(queued.job);
    expect(mailer.deliveries.slice(before)).toEqual([]);
  });
  it('寄出前停止則略過；processing 租約過期轉 unknown 而不重送', async () => {
    const doc = await create();
    const queued = await queueOne(doc);
    await request(ctx.server)
      .post(`/api/esign/documents/${doc.id}/stoppages`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ reason: '測試停止' })
      .expect(201);
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    const before = mailer.deliveries.length;
    await worker().process(queued.job);
    expect((await result(doc, queued.batch)).items[0]).toMatchObject({
      status: 'skipped',
      reasonCode: 'SIGNING_WINDOW_CLOSED',
    });
    const active = await create();
    const pending = await queueOne(active);
    await db.query(
      "UPDATE esign_notification_logs SET result='processing',attempt_count=1,processing_started_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 10 MINUTE),dispatch_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR)),lease_token=? WHERE id=?",
      [randomUUID(), pending.job.data.notificationLogId],
    );
    await worker().process(pending.job);
    expect((await result(active, pending.batch)).items[0]).toMatchObject({
      status: 'unknown',
      reasonCode: 'DELIVERY_OUTCOME_UNKNOWN',
    });
    expect(mailer.deliveries.slice(before)).toEqual([]);
  });
  it('並發申請只受理一批；跨文件識別整批拒絕，未登入與缺 Origin 不可催簽', async () => {
    const doc = await create();
    const other = await create();
    const body = {
      requestId: randomUUID(),
      selection: 'selected',
      signerPublicIds: [doc.signers[0].publicId],
    };
    await post(doc.id, {
      ...body,
      signerPublicIds: [doc.signers[0].publicId, other.signers[0].publicId],
    }).expect(404);
    const responses = await Promise.all([
      post(doc.id, body),
      post(doc.id, { ...body, requestId: randomUUID() }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
    await request(ctx.server)
      .post(`/api/esign/documents/${doc.id}/notification-batches`)
      .set('Origin', origin)
      .send(body)
      .expect(401);
    await request(ctx.server)
      .post(`/api/esign/documents/${doc.id}/notification-batches`)
      .set('Cookie', cookie)
      .send(body)
      .expect(403);
  });

  it('all_pending 包含跨頁全部外部名單；批次/明細分頁、類型篩選與敏感資料裁切', async () => {
    const doc = await create(
      Array.from({ length: 23 }, (_, i) => ({
        type: 'email',
        name: `跨頁 ${i}`,
        email: `batch${i}@example.test`,
      })),
    );
    const batch = apiData<
      Batch & { nextCursor: string | null; status: string }
    >(
      await post(doc.id, {
        requestId: randomUUID(),
        selection: 'all_pending',
      }).expect(202),
    );
    expect(batch.queuedCount).toBe(23);
    expect(batch.items).toHaveLength(20);
    expect(batch.status).toBe('queued');
    const base = `/api/esign/documents/${doc.id}/notification-batches`;
    const read = async (path: string) =>
      apiData<{
        items: Array<{ batchId: string; kind: string; signerPublicId: string }>;
        nextCursor: string | null;
      }>(await request(ctx.server).get(path).set('Cookie', cookie).expect(200));
    const first = await read(`${base}/${batch.batchId}?limit=7`);
    const ids = first.items.map((item) => item.signerPublicId);
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await read(
        `${base}/${batch.batchId}?limit=7&cursor=${cursor}`,
      );
      ids.push(...next.items.map((item) => item.signerPublicId));
      cursor = next.nextCursor;
    }
    expect(new Set(ids).size).toBe(23);
    expect(ids.sort()).toEqual(doc.signers.map((item) => item.publicId).sort());
    const list = await read(`${base}?limit=1`);
    expect(list.items[0]).toMatchObject({
      batchId: batch.batchId,
      kind: 'reminder',
      requestedBy: { name: '催簽測試' },
    });
    expect(list.items[0]).not.toHaveProperty('items');
    const older = await read(`${base}?limit=1&cursor=${list.nextCursor}`);
    expect(older.items[0].kind).toBe('invitation');
    expect(older.nextCursor).toBeNull();
    const invitations = await read(`${base}?kind=invitation`);
    expect(invitations.items).toHaveLength(1);
    const invitationDetail = await read(
      `${base}/${invitations.items[0].batchId}`,
    );
    expect(invitationDetail.items).toHaveLength(20);
    for (const query of ['limit=101', 'limit=0', 'cursor=bad', 'kind=otp'])
      await request(ctx.server)
        .get(`${base}?${query}`)
        .set('Cookie', cookie)
        .expect(400);
    expect(JSON.stringify([first, list, older, invitationDetail])).not.toMatch(
      /ciphertext|sha256|Token|recipientEmail|example.test/,
    );
    await post(doc.id, {
      requestId: randomUUID(),
      selection: 'all_pending',
    }).expect(409);
    expect((await read(base)).items).toHaveLength(2);
  });
  it('selected 去重，混合內部保留未支援原因；跨批併發僅寄一次且可追查初邀/催簽摘要', async () => {
    const [user] = await db.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE empid=?',
      ['E2E00905'],
    );
    const doc = await create([
      { type: 'user', userId: String(user.id) },
      ...Array.from({ length: 2 }, (_, i) => ({
        type: 'email',
        name: `外部 ${i}`,
        email: `mixed${i}@example.test`,
      })),
    ]);
    const allIds = doc.signers.map((signer) => signer.publicId);
    const batch = apiData<Batch>(
      await post(doc.id, {
        requestId: randomUUID(),
        selection: 'selected',
        signerPublicIds: [...allIds, ...allIds],
      }).expect(202),
    );
    expect(batch).toMatchObject({
      selectedCount: 3,
      queuedCount: 2,
      notSentCount: 1,
    });
    expect(batch.items.filter((item) => item.status === 'skipped')).toEqual([
      expect.objectContaining({ reasonCode: 'INTERNAL_REMINDER_UNSUPPORTED' }),
    ]);
    const rows = await db.query<Array<{ id: number }>>(
      'SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=? ORDER BY l.id',
      [doc.id],
    );
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    const before = mailer.deliveries.length;
    for (const row of rows)
      await worker().process({ data: { notificationLogId: row.id } } as Job<{
        notificationLogId: number;
      }>);
    expect(mailer.deliveries.slice(before)).toHaveLength(5);
    const detail = apiData<{
      signers: Array<{
        type: string;
        latestInvitation: { status: string };
        latestReminder: { status: string };
        deliveredReminderCount: number;
        reminderEligibility: { reasonCode: string };
      }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${doc.id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
    for (const signer of detail.signers.filter((s) => s.type === 'email'))
      expect(signer).toMatchObject({
        latestInvitation: { status: 'delivered' },
        latestReminder: { status: 'delivered' },
        deliveredReminderCount: 1,
        reminderEligibility: { reasonCode: 'REMINDER_DAILY_LIMIT' },
      });
    const responses = await Promise.all([
      post(doc.id, { requestId: randomUUID(), selection: 'all_pending' }),
      post(doc.id, {
        requestId: randomUUID(),
        selection: 'selected',
        signerPublicIds: allIds,
      }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([409, 409]);
    expect(mailer.deliveries.slice(before)).toHaveLength(5);
  });
  it('明確失敗仍待重試時不能另建批次，原明細成功後只寄出一次', async () => {
    const doc = await create();
    const queued = await queueOne(doc);
    const mailer = ctx.app.get<FakeInvitationMailSender>(
      INVITATION_MAIL_SENDER,
    );
    const send = jest
      .spyOn(mailer, 'send')
      .mockRejectedValueOnce({ responseCode: 450 });
    await worker().process(queued.job);
    send.mockRestore();
    expect(await result(doc, queued.batch)).toMatchObject({ status: 'queued' });
    const rejected = await post(doc.id, {
      requestId: randomUUID(),
      selection: 'all_pending',
    }).expect(409);
    expect(JSON.stringify(rejected.body)).toContain('REMINDER_IN_PROGRESS');
    await db.query(
      'UPDATE esign_notification_logs SET next_attempt_at=UTC_TIMESTAMP() WHERE id=?',
      [queued.job.data.notificationLogId],
    );
    const before = mailer.deliveries.length;
    await worker().process(queued.job);
    await worker().process(queued.job);
    expect(mailer.deliveries.slice(before)).toHaveLength(1);
    expect((await result(doc, queued.batch)).items[0]).toMatchObject({
      status: 'delivered',
      attemptCount: 2,
    });
  });

  it.each(['invitation', 'reminder'])(
    '%s 等待文件鎖時已停止，worker 使用最新鎖定狀態',
    async (kind) => {
      const doc = await create();
      let queued = await queueOne(doc);
      if (kind === 'invitation') {
        const [initial] = await db.query<
          Array<{ id: number; publicId: string }>
        >(
          "SELECT l.id, b.public_id AS publicId FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=? AND b.kind='invitation'",
          [doc.id],
        );
        queued = {
          batch: { ...queued.batch, batchId: initial.publicId },
          job: { data: { notificationLogId: initial.id } } as Job<{
            notificationLogId: number;
          }>,
        };
      }
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let pending: Promise<unknown> | undefined;
      const mailer = ctx.app.get<FakeInvitationMailSender>(
        INVITATION_MAIL_SENDER,
      );
      const before = mailer.deliveries.length;
      try {
        await runner.query(
          'SELECT id FROM esign_documents WHERE id=? FOR UPDATE',
          [doc.id],
        );
        pending = worker().process(queued.job);
        // 真 MySQL 鎖等待作同步點，確保 worker 已建立 REPEATABLE READ snapshot。
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const rows = await runner.query<Array<{ count: string }>>(
            "SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON w.REQUESTING_ENGINE_LOCK_ID=l.ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=DATABASE() AND l.OBJECT_NAME='esign_documents'",
          );
          if (Number(rows[0].count) > 0) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await runner.query(
          "UPDATE esign_documents SET status='stopped' WHERE id=?",
          [doc.id],
        );
        await runner.commitTransaction();
        await pending;
        expect((await result(doc, queued.batch)).items[0]).toMatchObject(
          kind === 'reminder'
            ? { status: 'skipped', reasonCode: 'SIGNING_WINDOW_CLOSED' }
            : { status: 'pending' },
        );
        expect(mailer.deliveries.slice(before)).toHaveLength(0);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await pending;
        await runner.release();
      }
    },
  );

  it('已有催簽紀錄時拒絕 schema 回滾，原紀錄仍可讀取', async () => {
    const doc = await create();
    const queued = await queueOne(doc);
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await expect(
        new ExternalReminders1792454402000().down(runner),
      ).rejects.toThrow('已有催簽紀錄與憑證');
    } finally {
      await runner.release();
    }
    expect((await result(doc, queued.batch)).batchId).toBe(
      queued.batch.batchId,
    );
  });
});
import { syntheticStaffEmails } from './synthetic-staff-emails.helper';
