import { HttpService } from '@nestjs/axios';
import { randomBytes, randomUUID } from 'node:crypto';
import { of } from 'rxjs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import type { Job } from 'bullmq';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { ExternalInvitationProcessor } from '#app/worker/esign/external-invitation.processor';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { EsignJobProducerService } from '#app/features/esign/services/esign-job-producer.service';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('Spec016 內部 BCC 催簽與補簽', () => {
  let ctx: SecurityE2eContext;
  let cookie: string;
  let users: User[];
  const origin = 'http://localhost:3000';
  const http = { get: jest.fn(), post: jest.fn() };
  const jobs = {
    enqueueInvitations: jest.fn(),
    enqueueFinalization: jest.fn(),
  };
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder
        .overrideProvider(HttpService)
        .useValue(http)
        .overrideProvider(EsignJobProducerService)
        .useValue(jobs),
    );
    const manager = ctx.app.get(MysqlService).getManager();
    const prefix = randomBytes(5).toString('hex');
    users = await manager.save(
      User,
      Array.from({ length: 3 }, (_, index) =>
        manager.create(User, {
          empid: `G${prefix}${index}`,
          name: `合成員工${index}`,
          isActive: true,
        }),
      ),
    );
    cookie = `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(users[0].id)).token}`;
    http.post.mockImplementation(
      (_url: string, body: { person_empids: string[] }) =>
        of({
          data: {
            success: true,
            data: body.person_empids.map((person_empid) => ({
              person_empid,
              email: `${person_empid.toLowerCase()}@example.test`,
            })),
          },
        }),
    );
  });
  afterAll(async () => {
    if (ctx) await closeSecurityE2eApp(ctx);
  });

  async function initiate(
    count: number,
    external = false,
    duration = 86400000,
  ) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '群寄合成文件')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'group.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
    await request(ctx.server)
      .post(`/api/esign/documents/${documentId}/initiations`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        signers: [
          ...users
            .slice(0, count)
            .map((user) => ({ type: 'user', userId: String(user.id) })),
          ...(external
            ? [
                {
                  type: 'email',
                  name: '外部合成',
                  email: 'external@example.test',
                },
              ]
            : []),
        ],
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
        signStartAt: new Date(Date.now() - 60000).toISOString(),
        signEndAt: new Date(Date.now() + duration).toISOString(),
        watermark: false,
        allowReject: true,
      })
      .expect(201);
    const logs = await ctx.app.get(MysqlService).getManager().query<
      Array<{
        id: number;
        batchId: number;
        signerId: number;
        signerType: string;
        token: string | null;
      }>
    >('SELECT l.id,l.batch_id batchId,l.signer_id signerId,s.signer_type signerType,s.invitation_token_sha256 token FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id JOIN esign_signers s ON s.id=l.signer_id WHERE b.document_id=? ORDER BY l.id', [documentId]);
    return { documentId, logs, batchId: Number(logs[0].batchId) };
  }
  const detail = async (id: string) =>
    apiData<{
      signEndAt: string;
      signers: Array<{
        publicId: string;
        type: string;
        invitationDelivery: string;
        latestInvitation: { status: string };
      }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${id}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  function worker(mailer = new FakeInvitationMailSender()) {
    return {
      mailer,
      processor: new ExternalInvitationProcessor(
        ctx.app.get(MysqlService),
        ctx.app.get(NotificationRepository),
        ctx.app.get(SignerRepository),
        ctx.app.get(EsignTokenService),
        ctx.app.get(EsignAuditService),
        mailer,
      ),
    };
  }
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  function at(now: Date) {
    jest.useFakeTimers({
      now,
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
  const readBatch = async (id: string, batchId: string) =>
    apiData<Batch>(
      await request(ctx.server)
        .get(`/api/esign/documents/${id}/notification-batches/${batchId}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  const reopen = (id: string, previous: string) =>
    request(ctx.server)
      .post(`/api/esign/documents/${id}/reopenings`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        expectedSignEndAt: previous,
        signEndAt: new Date(Date.parse(previous) + 86400000).toISOString(),
        reason: '合成補簽',
      });
  const remind = (id: string, requestId: string, signerPublicIds?: string[]) =>
    request(ctx.server)
      .post(`/api/esign/documents/${id}/notification-batches`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({
        requestId,
        selection: signerPublicIds ? 'selected' : 'all_pending',
        ...(signerPublicIds ? { signerPublicIds } : {}),
      });
  interface Batch {
    batchId: string;
    queuedCount: number;
    notSentCount: number;
    items: Array<{
      signerPublicId: string;
      status: string;
      reasonCode: string | null;
    }>;
  }
  const batchLogs = (publicId: string) =>
    ctx.app
      .get(MysqlService)
      .getManager()
      .query<
        Array<{
          id: number;
          batchId: number;
          signerType: string;
          reminderToken: string | null;
          generation: string | null;
        }>
      >('SELECT l.id,l.batch_id batchId,s.signer_type signerType,l.reminder_token_sha256 reminderToken,l.invitation_generation_sha256 generation FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id JOIN esign_signers s ON s.id=l.signer_id WHERE b.public_id=? ORDER BY l.id', [publicId]);

  it('選取內部子集合只群寄本批，外部逐人；重送重用batch且每日限額按人', async () => {
    const { documentId } = await initiate(3, true);
    const document = await detail(documentId);
    const ids = [
      document.signers[0].publicId,
      document.signers[2].publicId,
      document.signers[3].publicId,
    ];
    const requestId = randomUUID();
    const batch = apiData<Batch>(
      await remind(documentId, requestId, ids).expect(202),
    );
    const logs = await batchLogs(batch.batchId);
    expect(
      logs
        .filter((log) => log.signerType === 'user')
        .map((log) => [log.reminderToken, log.generation]),
    ).toEqual([
      [null, null],
      [null, null],
    ]);
    const external = logs.find((log) => log.signerType === 'email')!;
    expect(external.reminderToken).toMatch(/^[a-f0-9]{64}$/);
    expect(jobs.enqueueInvitations).toHaveBeenLastCalledWith(
      [external.id],
      [logs[0].batchId],
    );
    expect(
      apiData<Batch>(await remind(documentId, requestId, ids).expect(202))
        .batchId,
    ).toBe(batch.batchId);
    const { processor, mailer } = worker();
    await processor.process({
      data: { notificationBatchId: Number(logs[0].batchId) },
    } as Job);
    await processor.process({
      data: { notificationLogId: Number(external.id) },
    } as Job);
    expect(mailer.internalGroupDeliveries).toHaveLength(1);
    expect(mailer.internalGroupDeliveries[0]).toMatchObject({
      kind: 'reminder',
      recipientEmails: [
        users[0].empid.toLowerCase() + '@example.test',
        users[2].empid.toLowerCase() + '@example.test',
      ],
    });
    expect(mailer.deliveries).toHaveLength(1);
    expect(mailer.deliveries[0].kind).toBe('reminder');
    const mixed = apiData<Batch>(
      await remind(documentId, randomUUID(), [
        document.signers[0].publicId,
        document.signers[1].publicId,
      ]).expect(202),
    );
    expect(mixed).toMatchObject({
      queuedCount: 1,
      notSentCount: 1,
      items: [
        expect.objectContaining({
          status: 'skipped',
          reasonCode: 'REMINDER_DAILY_LIMIT',
        }),
        expect.objectContaining({ status: 'pending' }),
      ],
    });
  });
  it('同日受理阻擋重複催簽，台北跨日後可再群寄，同requestId仍只一批', async () => {
    const clock = new Date();
    clock.setUTCHours(15, 59, 50, 0);
    at(clock);
    const { documentId } = await initiate(2);
    const firstRequestId = randomUUID();
    const first = apiData<Batch>(
      await remind(documentId, firstRequestId).expect(202),
    );
    const firstLogs = await batchLogs(first.batchId);
    const { processor, mailer } = worker();
    await processor.process({
      data: { notificationBatchId: Number(firstLogs[0].batchId) },
    } as Job);
    await remind(documentId, randomUUID()).expect(409);
    expect(
      apiData<Batch>(await remind(documentId, firstRequestId).expect(202))
        .batchId,
    ).toBe(first.batchId);
    at(new Date(clock.getTime() + 20_000));
    const next = apiData<Batch>(
      await remind(documentId, randomUUID()).expect(202),
    );
    const nextLogs = await batchLogs(next.batchId);
    await processor.process({
      data: { notificationBatchId: Number(nextLogs[0].batchId) },
    } as Job);
    expect(mailer.internalGroupDeliveries).toHaveLength(2);
    expect(
      (await readBatch(documentId, next.batchId)).items.every(
        (item) => item.status === 'delivered',
      ),
    ).toBe(true);
  });

  it('worker 發送前重查期間與每日額度，來源有舊token也不能繞過', async () => {
    const { documentId } = await initiate(2);
    const batch = apiData<Batch>(
      await remind(documentId, randomUUID()).expect(202),
    );
    const logs = await batchLogs(batch.batchId);
    await ctx.app
      .get(MysqlService)
      .getManager()
      .query('UPDATE esign_documents SET sign_start_at=? WHERE id=?', [
        new Date(Date.now() + 60000),
        documentId,
      ]);
    const { processor, mailer } = worker();
    await processor.process({
      data: { notificationBatchId: Number(logs[0].batchId) },
    } as Job);
    expect(mailer.internalGroupDeliveries).toHaveLength(0);
    expect(
      (await readBatch(documentId, batch.batchId)).items.map(
        (item) => item.reasonCode,
      ),
    ).toEqual(['SIGNING_WINDOW_CLOSED', 'SIGNING_WINDOW_CLOSED']);
  });

  it('補簽退休舊排隊與processing，保留unknown歷史；內部無token、外部輪替並逐人', async () => {
    const { documentId, logs: invitationLogs } = await initiate(3, true, 60000);
    const document = await detail(documentId);
    const batch = apiData<Batch>(
      await remind(documentId, randomUUID()).expect(202),
    );
    const old = await batchLogs(batch.batchId);
    const manager = ctx.app.get(MysqlService).getManager();
    await manager.query(
      "UPDATE esign_notification_logs SET result='processing',processing_started_at=?,lease_token=? WHERE id=?",
      [new Date(), randomUUID(), old[1].id],
    );
    await manager.query(
      "UPDATE esign_notification_logs SET result='unknown',completed_at=? WHERE id=?",
      [new Date(), old[2].id],
    );
    at(new Date(Date.parse(document.signEndAt) + 1));
    await reopen(documentId, document.signEndAt).expect(201);
    await reopen(documentId, document.signEndAt).expect(409);
    const oldResult = await readBatch(documentId, batch.batchId);
    expect(oldResult.items.map((item) => item.status)).toEqual([
      'failed',
      'failed',
      'unknown',
      'failed',
    ]);
    expect(oldResult.items[0].reasonCode).toBe('INVITATION_SUPERSEDED');
    const fresh = await manager.query<
      Array<{
        id: number;
        batchId: number;
        signerType: string;
        token: string | null;
      }>
    >(
      'SELECT l.id,l.batch_id batchId,s.signer_type signerType,s.invitation_token_sha256 token FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id JOIN esign_signers s ON s.id=l.signer_id WHERE b.document_id=? AND b.kind=? ORDER BY l.id DESC LIMIT 4',
      [documentId, 'invitation'],
    );
    expect(
      fresh.filter((log) => log.signerType === 'user').map((log) => log.token),
    ).toEqual([null, null, null]);
    expect(fresh.find((log) => log.signerType === 'email')!.token).not.toBe(
      invitationLogs.find((log) => log.signerType === 'email')!.token,
    );
    const { processor, mailer } = worker();
    for (const log of [...invitationLogs, ...old])
      await processor.process({
        data: { notificationLogId: Number(log.id) },
      } as Job);
    expect(mailer.internalGroupDeliveries).toHaveLength(0);
    expect(mailer.deliveries).toHaveLength(0);
    await processor.process({
      data: { notificationBatchId: Number(fresh[0].batchId) },
    } as Job);
    await processor.process({
      data: {
        notificationLogId: Number(
          fresh.find((log) => log.signerType === 'email')!.id,
        ),
      },
    } as Job);
    expect(mailer.internalGroupDeliveries).toHaveLength(1);
    expect(mailer.internalGroupDeliveries[0].recipientEmails).toHaveLength(3);
    expect(mailer.deliveries).toHaveLength(1);
    expect(
      (await detail(documentId)).signers.every(
        (signer) => signer.latestInvitation.status === 'delivered',
      ),
    ).toBe(true);
  });

  it('舊 SMTP 在途時補簽，延遲受理結果不能覆蓋新批次', async () => {
    const { documentId } = await initiate(2, false, 60000);
    const document = await detail(documentId);
    const batch = apiData<Batch>(
      await remind(documentId, randomUUID()).expect(202),
    );
    const logs = await batchLogs(batch.batchId);
    const { processor, mailer } = worker();
    jest
      .spyOn(mailer, 'sendInternalGroup')
      .mockImplementationOnce(async (input) => {
        at(new Date(Date.parse(document.signEndAt) + 1));
        await reopen(documentId, document.signEndAt).expect(201);
        return input.recipientEmails.map((recipientEmail) => ({
          recipientEmail,
          status: 'accepted',
          retryable: false,
        }));
      });
    await processor.process({
      data: { notificationBatchId: Number(logs[0].batchId) },
    } as Job);
    expect(
      (await readBatch(documentId, batch.batchId)).items.every(
        (item) => item.reasonCode === 'INVITATION_SUPERSEDED',
      ),
    ).toBe(true);
    expect(
      (await detail(documentId)).signers.map(
        (signer) => signer.latestInvitation.status,
      ),
    ).toEqual(['pending', 'pending']);
  });

  it('內部固定Email為null仍能補簽，只記skipped', async () => {
    const { documentId } = await initiate(2, false, 60000);
    const document = await detail(documentId);
    await ctx.app
      .get(MysqlService)
      .getManager()
      .query('UPDATE esign_signers SET email=NULL WHERE document_id=?', [
        documentId,
      ]);
    at(new Date(Date.parse(document.signEndAt) + 1));
    await reopen(documentId, document.signEndAt).expect(201);
    expect(jobs.enqueueInvitations).toHaveBeenLastCalledWith([], []);
    expect(
      (await detail(documentId)).signers.map(
        (signer) => signer.latestInvitation.status,
      ),
    ).toEqual(['skipped', 'skipped']);
  });

  it('同時申請內部催簽只受理一批，另一批不重複排入', async () => {
    const { documentId } = await initiate(2);
    const replies = await Promise.all([
      remind(documentId, randomUUID()),
      remind(documentId, randomUUID()),
    ]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([202, 409]);
  });

  it('跨午夜重試只寄本批暫時拒收地址，不再寄已受理者', async () => {
    const clock = new Date();
    clock.setUTCHours(15, 59, 50, 0);
    at(clock);
    const { documentId } = await initiate(2);
    const batch = apiData<Batch>(
      await remind(documentId, randomUUID()).expect(202),
    );
    const logs = await batchLogs(batch.batchId);
    const { processor, mailer } = worker();
    const send = jest
      .spyOn(mailer, 'sendInternalGroup')
      .mockImplementationOnce((input) =>
        Promise.resolve(
          input.recipientEmails.map((recipientEmail, index) => ({
            recipientEmail,
            status: index === 0 ? 'accepted' : 'rejected',
            retryable: index !== 0,
          })),
        ),
      );
    const job = {
      data: { notificationBatchId: Number(logs[0].batchId) },
    } as Job;
    await processor.process(job);
    expect(
      (await readBatch(documentId, batch.batchId)).items.map(
        (item) => item.status,
      ),
    ).toEqual(['delivered', 'failed']);
    at(new Date(clock.getTime() + 31_000));
    await processor.process(job);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].recipientEmails).toEqual([
      users[1].empid.toLowerCase() + '@example.test',
    ]);
    expect(
      (await readBatch(documentId, batch.batchId)).items.map(
        (item) => item.status,
      ),
    ).toEqual(['delivered', 'delivered']);
    await processor.process(job);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
