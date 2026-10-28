import { HttpService } from '@nestjs/axios';
import { randomBytes, randomUUID } from 'node:crypto';
import { of, from, throwError } from 'rxjs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { ExternalInvitationProcessor } from '#app/worker/esign/external-invitation.processor';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { EsignExpiryService } from '#app/features/esign/services/esign-expiry.service';
import type { Job } from 'bullmq';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { esignTestPng } from './esign-test-png';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('Spec016 內部發起與邀請', () => {
  let ctx: SecurityE2eContext;
  let cookie: string;
  let users: User[];
  let documentId: string;
  const origin = 'http://localhost:3000';
  const http = { get: jest.fn(), post: jest.fn() };
  const detail = async () =>
    apiData<{
      status: string;
      signers: Array<{
        publicId: string;
        email: string | null;
        invitationDelivery: string | null;
        type: string;
      }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  const initiate = (
    signers: object[] = users.map((u) => ({
      type: 'user',
      userId: String(u.id),
    })),
    duration = 86400000,
  ) =>
    request(ctx.server)
      .post(`/api/esign/documents/${documentId}/initiations`)
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
            widthPercent: 20,
            heightPercent: 10,
            sortOrder: 0,
          },
        ],
        signStartAt: new Date(
          Date.now() + Math.min(3600000, duration / 2),
        ).toISOString(),
        signEndAt: new Date(Date.now() + duration).toISOString(),
        watermark: false,
        allowReject: true,
      });
  const externalSigners = () =>
    users.map((_, index) => ({
      type: 'email',
      name: `合成外部${index}`,
      email: `external${index}@example.test`,
    }));
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(HttpService).useValue(http),
    );
    const manager = ctx.app.get(MysqlService).getManager();
    const prefix = randomBytes(5).toString('hex');
    users = await manager.save(
      User,
      [0, 1].map((index) =>
        manager.create(User, {
          empid: `I${prefix}${index}`,
          name: `合成員工${index}`,
          isActive: true,
        }),
      ),
    );
    cookie = `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(users[0].id)).token}`;
  });
  beforeEach(async () => {
    http.post
      .mockReset()
      .mockImplementation((_url: string, body: { person_empids: string[] }) =>
        of({
          data: {
            success: true,
            data: body.person_empids.map((person_empid) => ({
              person_empid,
              email: 'shared@example.test',
            })),
          },
        }),
      );
    const pdf = await PDFDocument.create();
    pdf.addPage();
    documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '內部發起合成文件')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'init.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });
  afterEach(() => jest.useRealTimers());
  function atDeadline(end: Date) {
    jest.useFakeTimers({
      now: end,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    });
  }
  const invitations = async () =>
    apiData<Array<{ signerPublicId: string; invitationUrl: string }>>(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}/reopening-invitations`)
        .set('Cookie', cookie)
        .expect(200),
    );
  const reopen = (end: Date) =>
    request(ctx.server)
      .post(`/api/esign/documents/${documentId}/reopenings`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        expectedSignEndAt: end.toISOString(),
        signEndAt: new Date(end.getTime() + 86400000).toISOString(),
        reason: '合成補簽',
      });
  const notificationLogs = async () =>
    ctx.app
      .get(MysqlService)
      .getManager()
      .query<
        Array<{ id: number; batch_id: number }>
      >('SELECT l.id,l.batch_id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=? ORDER BY l.id', [documentId]);
  function invitationWorker(
    send: (input: { invitationToken: string }) => Promise<void>,
  ) {
    return new ExternalInvitationProcessor(
      ctx.app.get(MysqlService),
      ctx.app.get(NotificationRepository),
      ctx.app.get(SignerRepository),
      ctx.app.get(EsignTokenService),
      ctx.app.get(EsignAuditService),
      {
        send,
        sendInternalGroup: (input) =>
          Promise.resolve(
            input.recipientEmails.map((recipientEmail) => ({
              recipientEmail,
              status: 'accepted' as const,
              retryable: false,
            })),
          ),
      },
    );
  }
  const deliver = (worker: ExternalInvitationProcessor, id: number) =>
    worker.process({ data: { notificationLogId: id } } as Job<{
      notificationLogId: number;
    }>);
  it.each([false, true])(
    '補簽混合共用信箱逐人寄送，新世代狀態與清單一致（到期落盤=%s）',
    async (persistExpired) => {
      const initiated = apiData<{ signEndAt: string }>(
        await initiate(
          [
            ...users.map((u) => ({ type: 'user', userId: String(u.id) })),
            { type: 'email', name: '合成外部', email: 'shared@example.test' },
          ],
          60000,
        ).expect(201),
      );
      const oldLogs = await notificationLogs();
      const end = new Date(initiated.signEndAt);
      atDeadline(end);
      if (persistExpired)
        await ctx.app
          .get(EsignExpiryService)
          .expireByDeadline(Number(documentId));
      http.post.mockClear();
      await reopen(end).expect(201);
      expect(http.post).not.toHaveBeenCalled();
      expect((await detail()).signers.map((s) => s.invitationDelivery)).toEqual(
        ['pending', 'pending', 'pending'],
      );
      expect(await invitations()).toHaveLength(1);
      const sent: string[] = [];
      const worker = invitationWorker((input) => {
        sent.push(input.invitationToken);
        return Promise.resolve();
      });
      for (const log of oldLogs) await deliver(worker, log.id);
      expect(sent).toHaveLength(0);
      for (const log of (await notificationLogs()).filter(
        (row) => !oldLogs.some((old) => old.id === row.id),
      ))
        await deliver(worker, log.id);
      expect(new Set(sent).size).toBe(1);
      expect((await detail()).signers.map((s) => s.invitationDelivery)).toEqual(
        ['delivered', 'delivered', 'delivered'],
      );
      expect(await invitations()).toEqual([]);
      await reopen(end).expect(409);
    },
  );
  it.each([false, true])(
    '真正補簽交易隔離在途舊邀請結果（SMTP失敗=%s）',
    async (failure) => {
      const initiated = apiData<{ signEndAt: string }>(
        await initiate(externalSigners(), 60000).expect(201),
      );
      const [oldLog] = await notificationLogs();
      let rotated: Awaited<ReturnType<typeof invitations>> = [];
      const worker = invitationWorker(async () => {
        atDeadline(new Date(initiated.signEndAt));
        await reopen(new Date(initiated.signEndAt)).expect(201);
        rotated = await invitations();
        if (failure) throw new Error('合成SMTP失敗');
      });
      await deliver(worker, oldLog.id);
      expect(rotated).toHaveLength(2);
      expect(await invitations()).toEqual(rotated);
      expect((await detail()).signers.map((s) => s.invitationDelivery)).toEqual(
        ['pending', 'pending'],
      );
      const batches = apiData<{ items: Array<{ batchId: string }> }>(
        await request(ctx.server)
          .get(
            `/api/esign/documents/${documentId}/notification-batches?kind=invitation`,
          )
          .set('Cookie', cookie)
          .expect(200),
      );
      expect(batches.items).toHaveLength(2);
    },
  );
  it.each(['email', 'invitation_token_sha256'])(
    '任一待簽者缺少%s，補簽409且不留下部分變更',
    async (column) => {
      const initiated = apiData<{ signEndAt: string }>(
        await initiate(externalSigners(), 60000).expect(201),
      );
      await ctx.app
        .get(MysqlService)
        .getManager()
        .query(
          `UPDATE esign_signers SET ${column}=${column === 'email' ? "''" : 'NULL'} WHERE document_id=? AND sort_order=?`,
          [documentId, 1],
        );
      atDeadline(new Date(initiated.signEndAt));
      const before = await detail();
      const logsBefore = await notificationLogs();
      const failed = await reopen(new Date(initiated.signEndAt)).expect(409);
      expect(failed.body).toMatchObject({
        error: {
          code: 'ESIGN_REOPEN_RECIPIENT_UNAVAILABLE',
          details: { signerPublicIds: [before.signers[1].publicId] },
        },
      });
      expect(await detail()).toEqual(before);
      expect(await notificationLogs()).toEqual(logsBefore);
    },
  );
  it('補簽SMTP失敗保留active與可重試通知；缺密文正常省略，損壞密文503', async () => {
    const initiated = apiData<{ signEndAt: string }>(
      await initiate(externalSigners(), 60000).expect(201),
    );
    atDeadline(new Date(initiated.signEndAt));
    await reopen(new Date(initiated.signEndAt)).expect(201);
    const logs = await notificationLogs();
    const failedWorker = invitationWorker(() =>
      Promise.reject(new Error('合成寄送失敗')),
    );
    await deliver(failedWorker, logs.at(-1)!.id);
    expect((await detail()).status).toBe('active');
    expect((await detail()).signers.map((s) => s.invitationDelivery)).toEqual([
      'pending',
      'failed',
    ]);
    expect(await invitations()).toHaveLength(2);
    await ctx.app
      .get(MysqlService)
      .getManager()
      .query(
        'UPDATE esign_signers SET invitation_token_ciphertext=NULL WHERE document_id=? AND sort_order=?',
        [documentId, 0],
      );
    expect(await invitations()).toHaveLength(1);
    await ctx.app
      .get(MysqlService)
      .getManager()
      .query(
        "UPDATE esign_signers SET invitation_token_ciphertext='corrupt' WHERE document_id=? AND sort_order=?",
        [documentId, 1],
      );
    await request(ctx.server)
      .get(`/api/esign/documents/${documentId}/reopening-invitations`)
      .set('Cookie', cookie)
      .expect(503);
  });
  it.each([false, true])(
    '補簽作廢在途催簽，舊結果與重複工作不改寫通知（SMTP失敗=%s）',
    async (failure) => {
      const initiated = apiData<{ signStartAt: string; signEndAt: string }>(
        await initiate(externalSigners(), 60000).expect(201),
      );
      atDeadline(new Date(Date.parse(initiated.signStartAt) + 1));
      const batch = apiData<{ batchId: string }>(
        await request(ctx.server)
          .post(`/api/esign/documents/${documentId}/notification-batches`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ requestId: randomUUID(), selection: 'all_pending' })
          .expect(202),
      );
      const batchDetail = async () =>
        apiData(
          await request(ctx.server)
            .get(
              `/api/esign/documents/${documentId}/notification-batches/${batch.batchId}`,
            )
            .set('Cookie', cookie)
            .expect(200),
        );
      const logs = await notificationLogs();
      let retired: unknown;
      const sent: string[] = [];
      const worker = invitationWorker(async (input) => {
        sent.push(input.invitationToken);
        jest.setSystemTime(new Date(initiated.signEndAt));
        await reopen(new Date(initiated.signEndAt)).expect(201);
        retired = await batchDetail();
        if (failure) throw new Error('合成催簽失敗');
      });
      await deliver(worker, logs.at(-1)!.id);
      expect(await batchDetail()).toEqual(retired);
      await deliver(worker, logs.at(-1)!.id);
      expect(await batchDetail()).toEqual(retired);
      expect(sent).toHaveLength(1);
      expect((await detail()).signers.map((s) => s.invitationDelivery)).toEqual(
        ['pending', 'pending'],
      );
    },
  );
  it('未來開始也逐人建立邀請，共用地址及內外部相同地址不合併', async () => {
    await initiate([
      ...users.map((u) => ({ type: 'user', userId: String(u.id) })),
      { type: 'email', name: '合成外部', email: 'shared@example.test' },
    ]).expect(201);
    const result = await detail();
    expect(result.status).toBe('active');
    expect(result.signers).toHaveLength(3);
    expect(
      result.signers.map((s) => ({
        email: s.email,
        delivery: s.invitationDelivery,
      })),
    ).toEqual(
      Array(3).fill({ email: 'shared@example.test', delivery: 'pending' }),
    );
  });
  it('草稿允許缺地址，但內部手填地址必須拒絕', async () => {
    const path = `/api/esign/documents/${documentId}/draft-settings`;
    await request(ctx.server)
      .patch(path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ signers: [{ type: 'user', userId: String(users[1].id) }] })
      .expect(200);
    const before = await detail();
    await request(ctx.server)
      .patch(path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        signers: [
          {
            type: 'user',
            userId: String(users[1].id),
            email: 'forged@example.test',
          },
        ],
      })
      .expect(400);
    expect(await detail()).toEqual(before);
  });
  it('來源查詢期間帳號停用回 409 且整份草稿不變', async () => {
    const before = await detail();
    http.post.mockImplementation(
      (_url: string, body: { person_empids: string[] }) =>
        from(
          (async () => {
            await ctx.app
              .get(MysqlService)
              .getManager()
              .update(User, users[1].id, { isActive: false });
            return {
              data: {
                success: true,
                data: body.person_empids.map((person_empid) => ({
                  person_empid,
                  email: 'shared@example.test',
                })),
              },
            };
          })(),
        ),
    );
    try {
      const failed = await initiate().expect(409);
      expect(failed.body).toMatchObject({
        error: { code: 'ESIGN_EMPLOYEE_IDENTITY_CHANGED' },
      });
      expect(await detail()).toEqual(before);
    } finally {
      await ctx.app
        .get(MysqlService)
        .getManager()
        .update(User, users[1].id, { isActive: true });
    }
  });
  it('worker 內部共用信箱群寄一次、外部獨立邀請並公開 delivered 狀態', async () => {
    await initiate([
      ...users.map((u) => ({ type: 'user', userId: String(u.id) })),
      { type: 'email', name: '外部回歸', email: 'shared@example.test' },
    ]).expect(201);
    const mailer = {
      send: jest.fn((_input: { invitationToken: string }) => Promise.resolve()),
      sendInternalGroup: jest.fn((input: { recipientEmails: string[] }) =>
        Promise.resolve(
          input.recipientEmails.map((recipientEmail) => ({
            recipientEmail,
            status: 'accepted' as const,
            retryable: false,
          })),
        ),
      ),
    };
    const worker = new ExternalInvitationProcessor(
      ctx.app.get(MysqlService),
      ctx.app.get(NotificationRepository),
      ctx.app.get(SignerRepository),
      ctx.app.get(EsignTokenService),
      ctx.app.get(EsignAuditService),
      mailer,
    );
    const logs = await ctx.app
      .get(MysqlService)
      .getManager()
      .query<
        Array<{ id: number }>
      >('SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=?', [documentId]);
    for (const log of logs)
      await worker.process({ data: { notificationLogId: log.id } } as Job<{
        notificationLogId: number;
      }>);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.sendInternalGroup).toHaveBeenCalledTimes(1);
    expect((await detail()).signers.map((s) => s.invitationDelivery)).toEqual([
      'delivered',
      'delivered',
      'delivered',
    ]);
    expect(
      new Set(
        mailer.send.mock.calls.map(
          (call) =>
            (call as unknown as [{ invitationToken: string }])[0]
              .invitationToken,
        ),
      ).size,
    ).toBe(1);
  });
  it.each([null, 'stale-generation'])(
    '未 claim 的缺漏／舊世代 log 不寄信（%s）',
    async (generation) => {
      await initiate(externalSigners()).expect(201);
      const mysql = ctx.app.get(MysqlService);
      const [log] = await mysql
        .getManager()
        .query<
          Array<{ id: number }>
        >('SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=? LIMIT 1', [documentId]);
      await mysql
        .getManager()
        .query(
          'UPDATE esign_notification_logs SET invitation_generation_sha256=? WHERE id=?',
          [generation, log.id],
        );
      const mailer = { send: jest.fn(() => Promise.resolve()) };
      const worker = new ExternalInvitationProcessor(
        mysql,
        ctx.app.get(NotificationRepository),
        ctx.app.get(SignerRepository),
        ctx.app.get(EsignTokenService),
        ctx.app.get(EsignAuditService),
        mailer,
      );
      await worker.process({ data: { notificationLogId: log.id } } as Job<{
        notificationLogId: number;
      }>);
      expect(mailer.send).not.toHaveBeenCalled();
      expect((await detail()).status).toBe('active');
      expect((await detail()).signers[0].invitationDelivery).toBeNull();
    },
  );
  it('SMTP 失敗保持 active、留下可重試寄送狀態且不洩漏錯誤內容', async () => {
    await initiate(externalSigners()).expect(201);
    const mysql = ctx.app.get(MysqlService);
    const [log] = await mysql
      .getManager()
      .query<
        Array<{ id: number }>
      >('SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=? LIMIT 1', [documentId]);
    const mailer = {
      send: jest.fn(() =>
        Promise.reject(new Error('SMTP synthetic private detail')),
      ),
    };
    const worker = new ExternalInvitationProcessor(
      mysql,
      ctx.app.get(NotificationRepository),
      ctx.app.get(SignerRepository),
      ctx.app.get(EsignTokenService),
      ctx.app.get(EsignAuditService),
      mailer,
    );
    await worker.process({ data: { notificationLogId: log.id } } as Job<{
      notificationLogId: number;
    }>);
    const result = await detail();
    expect(result.status).toBe('active');
    expect(result.signers.map((s) => s.invitationDelivery)).toContain('failed');
    expect(JSON.stringify(result)).not.toContain('synthetic private detail');
  });
  it.each([false, true])(
    '在途舊世代寄送結果不得清除或覆寫新邀請（失敗=%s）',
    async (fail) => {
      await initiate(externalSigners()).expect(201);
      const mysql = ctx.app.get(MysqlService);
      const [log] = await mysql
        .getManager()
        .query<
          Array<{ id: number; signer_id: number }>
        >('SELECT l.id,l.signer_id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=? LIMIT 1', [documentId]);
      const next = ctx.app.get(EsignTokenService).createInvitationToken();
      const mailer = {
        send: jest.fn(async () => {
          await mysql
            .getManager()
            .query(
              'UPDATE esign_signers SET invitation_token_sha256=?,invitation_token_ciphertext=? WHERE id=?',
              [next.digest, next.ciphertext, log.signer_id],
            );
          if (fail) throw new Error('合成寄送失敗');
        }),
      };
      const worker = new ExternalInvitationProcessor(
        mysql,
        ctx.app.get(NotificationRepository),
        ctx.app.get(SignerRepository),
        ctx.app.get(EsignTokenService),
        ctx.app.get(EsignAuditService),
        mailer,
      );
      await worker.process({ data: { notificationLogId: log.id } } as Job<{
        notificationLogId: number;
      }>);
      const [saved] = await mysql
        .getManager()
        .query<
          Array<{ invitation_token_ciphertext: string; result: string }>
        >('SELECT s.invitation_token_ciphertext,l.result FROM esign_signers s JOIN esign_notification_logs l ON l.signer_id=s.id WHERE l.id=?', [log.id]);
      expect(saved).toEqual({
        invitation_token_ciphertext: next.ciphertext,
        result: 'processing',
      });
    },
  );
  it.each(['missing', 'source'])(
    '101 人分成100＋1批：缺地址可發起、來源失敗回滾（%s）',
    async (mode) => {
      const manager = ctx.app.get(MysqlService).getManager();
      const prefix = randomBytes(5).toString('hex');
      const selected = await manager.save(
        User,
        Array.from({ length: 101 }, (_, index) =>
          manager.create(User, {
            empid: `B${prefix}${index}`,
            name: `批次合成${index}`,
            isActive: true,
          }),
        ),
      );
      const input = selected.map((u) => ({
        type: 'user',
        userId: String(u.id),
      }));
      const before = await detail();
      http.post.mockImplementation(
        (_url: string, body: { person_empids: string[] }) =>
          of({
            data: {
              success: true,
              data: body.person_empids
                .filter((id) => id !== selected[100].empid)
                .map((person_empid) => ({
                  person_empid,
                  email: 'batch@example.test',
                })),
            },
          }),
      );
      if (mode === 'missing') {
        await initiate(input).expect(201);
        expect((await detail()).signers[100]).toMatchObject({
          email: null,
          invitationDelivery: 'skipped',
        });
        expect(
          http.post.mock.calls
            .map(
              (call) =>
                (call[1] as { person_empids: string[] }).person_empids.length,
            )
            .sort((a, b) => a - b),
        ).toEqual([1, 100]);
        const mailer = new FakeInvitationMailSender();
        const worker = new ExternalInvitationProcessor(
          ctx.app.get(MysqlService),
          ctx.app.get(NotificationRepository),
          ctx.app.get(SignerRepository),
          ctx.app.get(EsignTokenService),
          ctx.app.get(EsignAuditService),
          mailer,
        );
        await deliver(worker, (await notificationLogs())[0].id);
        expect(
          mailer.internalGroupDeliveries.map((group) => group.recipientEmails),
        ).toEqual([['batch@example.test']]);
        expect(
          (await detail()).signers.map((signer) => signer.invitationDelivery),
        ).toEqual([
          ...Array.from({ length: 100 }, () => 'delivered'),
          'skipped',
        ]);
        return;
      }
      expect(await detail()).toEqual(before);
      http.post
        .mockReset()
        .mockReturnValue(throwError(() => new Error('合成來源不可用')));
      await initiate(input).expect(502);
      expect(await detail()).toEqual(before);
      const [totals] = await manager.query<
        Array<{ notifications: string; audits: string }>
      >(
        "SELECT (SELECT COUNT(*) FROM esign_notification_batches WHERE document_id=?) notifications,(SELECT COUNT(*) FROM esign_audit_events WHERE document_id=? AND event_type='document.initiated') audits",
        [documentId, documentId],
      );
      expect(Number(totals.notifications)).toBe(0);
      expect(Number(totals.audits)).toBe(0);
    },
  );
  it('來源查詢不持文件鎖、重新查信箱後固定於 v2 payload，不更改員工身分', async () => {
    http.post.mockImplementation(
      (_url: string, body: { person_empids: string[] }) =>
        from(
          (async () => {
            await request(ctx.server)
              .patch(`/api/esign/documents/${documentId}/draft-settings`)
              .set('Cookie', cookie)
              .set('Origin', origin)
              .send({ watermark: true })
              .timeout(2000)
              .expect(200);
            return {
              data: {
                success: true,
                data: body.person_empids.map((person_empid) => ({
                  person_empid,
                  email: 'fresh@example.test',
                })),
              },
            };
          })(),
        ),
    );
    await initiate().expect(201);
    const [row] = await ctx.app
      .get(MysqlService)
      .getManager()
      .query<
        Array<{ signing_payload_json: string | object }>
      >('SELECT signing_payload_json FROM esign_documents WHERE id=?', [documentId]);
    const snapshot =
      typeof row.signing_payload_json === 'string'
        ? (JSON.parse(row.signing_payload_json) as object)
        : row.signing_payload_json;
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      signers: users.map((u) => ({
        type: 'user',
        userId: String(u.id),
        employeeNo: u.empid,
        email: 'fresh@example.test',
      })),
    });
    await initiate().expect(409);
    expect((await detail()).status).toBe('active');
  });
  it('零內部名單不查 HR，非建立人不查 HR', async () => {
    const other = `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(users[1].id)).token}`;
    const saved = cookie;
    cookie = other;
    try {
      await initiate().expect(404);
    } finally {
      cookie = saved;
    }
    expect(http.post).not.toHaveBeenCalled();
    await initiate([
      { type: 'email', name: '合成外部', email: 'external@example.test' },
    ]).expect(201);
    expect(http.post).not.toHaveBeenCalled();
  });
  it('內部SMTP結果不明公開unknown，不誤顯示為pending', async () => {
    await initiate().expect(201);
    const mailer = new FakeInvitationMailSender();
    jest.spyOn(mailer, 'sendInternalGroup').mockResolvedValue([
      {
        recipientEmail: 'shared@example.test',
        status: 'unknown',
        retryable: false,
      },
    ]);
    const worker = new ExternalInvitationProcessor(
      ctx.app.get(MysqlService),
      ctx.app.get(NotificationRepository),
      ctx.app.get(SignerRepository),
      ctx.app.get(EsignTokenService),
      ctx.app.get(EsignAuditService),
      mailer,
    );
    await deliver(worker, (await notificationLogs())[0].id);
    expect(
      (await detail()).signers.map((signer) => signer.invitationDelivery),
    ).toEqual(['unknown', 'unknown']);
  });
  it('無Email全員仍可發起，指派與快照固定null、通知skipped且不寄信', async () => {
    http.post.mockReturnValue(of({ data: { success: true, data: [] } }));
    const initiated = apiData<{ signStartAt: string; signEndAt: string }>(
      await initiate(undefined, 60000).expect(201),
    );
    const result = await detail();
    expect(result.status).toBe('active');
    expect(result.signers.map((s) => [s.email, s.invitationDelivery])).toEqual([
      [null, 'skipped'],
      [null, 'skipped'],
    ]);
    const logs = await ctx.app
      .get(MysqlService)
      .getManager()
      .query<
        Array<{ result: string; errorCode: string; generation: string | null }>
      >('SELECT l.result,l.error_code errorCode,l.invitation_generation_sha256 generation FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=?', [documentId]);
    expect(logs).toEqual(
      Array(2).fill({
        result: 'skipped',
        errorCode: 'RECIPIENT_UNAVAILABLE',
        generation: null,
      }),
    );
    const manager = ctx.app.get(MysqlService).getManager();
    const [snapshot] = await manager.query<Array<{ payload: string | object }>>(
      'SELECT signing_payload_json payload FROM esign_documents WHERE id=?',
      [documentId],
    );
    expect(
      typeof snapshot.payload === 'string'
        ? JSON.parse(snapshot.payload)
        : snapshot.payload,
    ).toMatchObject({
      signers: users.map((user) => ({
        userId: String(user.id),
        employeeNo: user.empid,
        email: null,
      })),
    });
    const mailer = new FakeInvitationMailSender();
    const worker = new ExternalInvitationProcessor(
      ctx.app.get(MysqlService),
      ctx.app.get(NotificationRepository),
      ctx.app.get(SignerRepository),
      ctx.app.get(EsignTokenService),
      ctx.app.get(EsignAuditService),
      mailer,
    );
    for (const log of await notificationLogs()) await deliver(worker, log.id);
    expect(mailer.internalGroupDeliveries).toEqual([]);
    expect(mailer.deliveries).toEqual([]);
    atDeadline(new Date(initiated.signStartAt));
    const reminder = apiData<{
      items: Array<{ status: string; reasonCode: string }>;
    }>(
      await request(ctx.server)
        .post(`/api/esign/documents/${documentId}/notification-batches`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ requestId: randomUUID(), selection: 'all_pending' })
        .expect(202),
    );
    expect(
      reminder.items.map((item) => [item.status, item.reasonCode]),
    ).toEqual(Array(2).fill(['skipped', 'RECIPIENT_UNAVAILABLE']));
    const task = apiData<{
      consent: { version: string };
      fields: Array<{ id: string }>;
    }>(
      await request(ctx.server)
        .post(`/api/esign/signing-tasks/${result.signers[0].publicId}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({})
        .expect(201),
    );
    await request(ctx.server)
      .post(`/api/esign/signing-tasks/${result.signers[0].publicId}/signatures`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        requestId: randomUUID(),
        accepted: true,
        consentVersion: task.consent.version,
        signatures: task.fields.map((field) => ({
          fieldId: field.id,
          pngDataUrl: `data:image/png;base64,${esignTestPng(10).toString('base64')}`,
        })),
      })
      .expect(201);
    atDeadline(new Date(initiated.signEndAt));
    http.post.mockClear();
    await reopen(new Date(initiated.signEndAt)).expect(201);
    expect(http.post).not.toHaveBeenCalled();
    const [after] = await manager.query<Array<{ payload: string | object }>>(
      'SELECT signing_payload_json payload FROM esign_documents WHERE id=?',
      [documentId],
    );
    expect(after).toEqual(snapshot);
    expect((await detail()).signers[1]).toMatchObject({
      email: null,
      invitationDelivery: 'skipped',
    });
    for (const log of await notificationLogs()) await deliver(worker, log.id);
    expect(mailer.internalGroupDeliveries).toEqual([]);
    expect(mailer.deliveries).toEqual([]);
  });
});
