import { HttpService } from '@nestjs/axios';
import { randomBytes } from 'node:crypto';
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

describe('Spec016 內部 BCC 新發起與通知結果', () => {
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
      Array.from({ length: 51 }, (_, index) =>
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

  async function initiate(count: number, external = false) {
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
        signStartAt: new Date(Date.now() + 3600000).toISOString(),
        signEndAt: new Date(Date.now() + 86400000).toISOString(),
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
      signers: Array<{
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
  it('混合名單建立內部無 token 的 batch 工作，兩 worker 併發只寄一次，外部仍單人專屬', async () => {
    const { documentId, batchId, logs } = await initiate(2, true);
    expect(
      logs.filter((log) => log.signerType === 'user').map((log) => log.token),
    ).toEqual([null, null]);
    const externalLog = logs.find((log) => log.signerType === 'email')!;
    expect(externalLog.token).toMatch(/^[a-f0-9]{64}$/);
    expect(jobs.enqueueInvitations).toHaveBeenLastCalledWith(
      [externalLog.id],
      [batchId],
    );
    const { processor, mailer } = worker();
    await Promise.all([
      processor.process({ data: { notificationBatchId: batchId } } as Job),
      processor.process({
        data: { notificationLogId: Number(logs[0].id) },
      } as Job),
    ]);
    expect(mailer.internalGroupDeliveries).toHaveLength(1);
    expect(mailer.internalGroupDeliveries[0].recipientEmails).toHaveLength(2);
    await processor.process({
      data: { notificationLogId: Number(externalLog.id) },
    } as Job);
    expect(mailer.deliveries).toHaveLength(1);
    expect(mailer.deliveries[0].invitationToken).toBeTruthy();
    expect(
      (await detail(documentId)).signers.map(
        (signer) => signer.invitationDelivery,
      ),
    ).toEqual(['delivered', 'delivered', 'delivered']);
  });
  it.each([
    [50, [50]],
    [51, [50, 1]],
  ])('%s人群寄只依不同地址上限拆信', async (count, sizes) => {
    const { batchId, documentId } = await initiate(count as number);
    const { processor, mailer } = worker();
    await processor.process({ data: { notificationBatchId: batchId } } as Job);
    expect(
      mailer.internalGroupDeliveries.map((mail) => mail.recipientEmails.length),
    ).toEqual(sizes);
    expect(
      (await detail(documentId)).signers.every(
        (signer) => signer.latestInvitation.status === 'delivered',
      ),
    ).toBe(true);
  });
  it('共用 Email SMTP 一次但兩筆明細都成功，維護候選不依賴 token', async () => {
    const { batchId, logs, documentId } = await initiate(2);
    const manager = ctx.app.get(MysqlService).getManager();
    await manager.query(
      'UPDATE esign_signers SET email=? WHERE document_id=?',
      ['shared@example.test', documentId],
    );
    const candidates = await ctx.app
      .get(NotificationRepository)
      .findEligibleInvitationLogIds(
        new Date(),
        new Date(Date.now() - 300000),
        manager,
      );
    expect(
      candidates.filter((row) => Number(row.batchId) === batchId),
    ).toHaveLength(2);
    const { processor, mailer } = worker();
    await processor.process({
      data: { notificationLogId: Number(logs[0].id) },
    } as Job);
    expect(mailer.internalGroupDeliveries).toHaveLength(1);
    expect(mailer.internalGroupDeliveries[0].recipientEmails).toEqual([
      'shared@example.test',
    ]);
    expect(
      (await detail(documentId)).signers.map(
        (signer) => signer.latestInvitation.status,
      ),
    ).toEqual(['delivered', 'delivered']);
  });
  it('stale processing 維護復原 unknown 不重新投遞', async () => {
    const { batchId, documentId } = await initiate(2);
    const manager = ctx.app.get(MysqlService).getManager();
    await manager.query(
      "UPDATE esign_notification_logs SET result='processing',attempt_count=1,processing_started_at=?,lease_token=? WHERE batch_id=?",
      [
        new Date(Date.now() - 600000),
        '06ddc2c1-20e5-43e1-b35b-724aa9e6e294',
        batchId,
      ],
    );
    const { processor, mailer } = worker();
    await processor.process({ data: { notificationBatchId: batchId } } as Job);
    expect(mailer.internalGroupDeliveries).toHaveLength(0);
    expect(
      (await detail(documentId)).signers.map(
        (signer) => signer.latestInvitation.status,
      ),
    ).toEqual(['unknown', 'unknown']);
  });
});
