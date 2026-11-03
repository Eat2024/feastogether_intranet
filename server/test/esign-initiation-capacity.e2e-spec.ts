import { randomBytes } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ExternalInvitationProcessor } from '#app/worker/esign/external-invitation.processor';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import {
  INVITATION_MAIL_SENDER,
  type InvitationMailSender,
} from '#app/infrastructure/mail/invitation-mail-sender.port';
import { In } from 'typeorm';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import { EsignEmployeeEmailService } from '#app/features/esign/services/esign-employee-email.service';
import { EsignInitiationService } from '#app/features/esign/services/esign-initiation.service';
import { EsignInitiationJob } from '#app/features/esign/entities/esign-initiation-job.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import type { InitiateDocumentDto } from '#app/features/esign/dto/initiation.dto';
import type { InitiationJobDto } from '#app/features/esign/dto/initiation-job.dto';
import {
  ESIGN_DOCUMENT_INITIATION_QUEUE,
  ESIGN_EXTERNAL_INVITATION_QUEUE,
} from '#app/features/esign/esign-queue.constants';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('022 完整名單背景發起容量與原子性', () => {
  jest.setTimeout(60000);
  let ctx: SecurityE2eContext;
  let mysql: MysqlService;
  let users: User[] = [];
  let cookie: string;
  let pdf: Buffer;
  const documents: string[] = [];
  const ownedJobs = new Set<number>();
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    ctx = await createSecurityE2eApp();
    mysql = ctx.app.get(MysqlService);
    const prefix = `BG${randomBytes(4).toString('hex')}`;
    const empids = Array.from(
      { length: 6001 },
      (_, i) => `${prefix}${String(i).padStart(4, '0')}`,
    );
    for (let i = 0; i < empids.length; i += 500)
      await mysql.getManager().insert(
        User,
        empids.slice(i, i + 500).map((empid) => ({
          empid,
          name: '合成背景員工',
          isActive: true,
          email: null,
          departmentCode: 'SYN022CAP',
          departmentName: '合成部門',
        })),
      );
    users = await mysql
      .getManager()
      .find(User, { where: { empid: In(empids) }, order: { empid: 'ASC' } });
    cookie = `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(users[0].id)).token}`;
    const source = await PDFDocument.create();
    source.addPage();
    pdf = Buffer.from(await source.save());
  });
  async function submit(signers: InitiateDocumentDto['signers']) {
    const documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '合成背景容量文件')
        .attach('file', pdf, 'test.pdf')
        .expect(201),
    ).id;
    documents.push(documentId);
    const body: InitiateDocumentDto = {
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
      signStartAt: new Date(Date.now() - 60000).toISOString(),
      signEndAt: new Date(Date.now() + 86400000).toISOString(),
      watermark: true,
      allowReject: false,
    };
    const accepted = apiData<InitiationJobDto>(
      await request(ctx.server)
        .post(`/api/esign/documents/${documentId}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send(body)
        .expect(202),
    );
    expect(accepted).toMatchObject({
      status: 'queued',
      totalCount: signers.length,
      processedCount: 0,
    });
    const job = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { publicId: accepted.jobId });
    ownedJobs.add(job.id);
    return { documentId, job };
  }
  async function summary(documentId: string, jobId: string) {
    return apiData<InitiationJobDto>(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}/initiation-jobs/${jobId}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  }
  async function detail(documentId: string) {
    return apiData<{
      status: string;
      signers: Array<{ id: string; employeeNo: string; sortOrder: number }>;
    }>(
      await request(ctx.server)
        .get(`/api/esign/documents/${documentId}`)
        .set('Cookie', cookie)
        .expect(200),
    );
  }
  it('查核完成後可讀到 committing，但正式交易尚未提交不能當作成功', async () => {
    const { documentId, job } = await submit(
      users.slice(0, 501).map((u) => ({ type: 'user', userId: String(u.id) })),
    );
    const core = ctx.app.get(EsignInitiationService);
    const original = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    const held = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementation(async (...args) => {
        expect(await summary(documentId, job.publicId)).toMatchObject({
          status: 'processing',
          stage: 'committing',
          totalCount: 501,
          processedCount: 501,
          attemptCount: 1,
        });
        expect((await detail(documentId)).status).toBe('draft');
        return original(...args);
      });
    try {
      await ctx.app.get(EsignInitiationJobService).process(job.id);
    } finally {
      held.mockRestore();
    }
    expect(await summary(documentId, job.publicId)).toMatchObject({
      status: 'succeeded',
      processedCount: 501,
    });
  });
  it.each([1, 100, 101, 5001, 6001])(
    '%i 人全部背景發起，完整名單／快照／稽核與初邀不截斷或雙發',
    async (count) => {
      const selected = users.slice(0, count).reverse();
      const signers: InitiateDocumentDto['signers'] = selected.map((user) =>
        count === 5001
          ? { type: 'employee', employeeNo: user.empid }
          : { type: 'user', userId: String(user.id) },
      );
      const { documentId, job } = await submit(signers);
      const service = ctx.app.get(EsignInitiationJobService);
      await service.process(job.id);
      await service.process(job.id);
      expect(await summary(documentId, job.publicId)).toMatchObject({
        status: 'succeeded',
        totalCount: count,
        processedCount: count,
        attemptCount: 1,
      });
      expect((await detail(documentId)).signers).toHaveLength(count);
      const document = await mysql
        .getManager()
        .findOneByOrFail(EsignDocument, { id: Number(documentId) });
      const payload = document.signingPayloadJson as {
        signers: Array<{ userId: string; sortOrder: number }>;
      };
      expect(payload.signers.map((signer) => signer.userId)).toEqual(
        selected.map((user) => String(user.id)),
      );
      const counts = await mysql.query<
        Array<{
          assigned: string;
          initiated: string;
          logs: string;
          batches: string;
        }>
      >(
        `SELECT (SELECT COUNT(*) FROM esign_audit_events WHERE document_id=? AND event_type='signer.assigned') assigned,
      (SELECT COUNT(*) FROM esign_audit_events WHERE document_id=? AND event_type='document.initiated') initiated,
      (SELECT COUNT(*) FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=?) logs,
      (SELECT COUNT(*) FROM esign_notification_batches WHERE document_id=?) batches`,
        [documentId, documentId, documentId, documentId],
      );
      expect(
        counts.map((row) => [
          Number(row.assigned),
          Number(row.initiated),
          Number(row.logs),
          Number(row.batches),
        ]),
      ).toEqual([[count, 1, count, 1]]);
    },
  );

  it.each([false, true])(
    '混合／全外部名單，缺信箱與白名單略過不影響正式發起（全外部=%s）',
    async (externalOnly) => {
      const signers: InitiateDocumentDto['signers'] = externalOnly
        ? []
        : [{ type: 'user', userId: String(users[0].id) }];
      signers.push({
        type: 'email',
        name: '合成外部員工',
        email: `blocked${randomBytes(4).toString('hex')}@example.invalid`,
      });
      const { documentId, job } = await submit(signers);
      await ctx.app.get(EsignInitiationJobService).process(job.id);
      expect((await summary(documentId, job.publicId)).status).toBe(
        'succeeded',
      );
      const logs = await mysql.query<
        Array<{
          id: number;
          result: string;
          error_code: string | null;
          signer_type: string;
        }>
      >(
        'SELECT l.id,l.result,l.error_code,s.signer_type FROM esign_notification_logs l JOIN esign_signers s ON s.id=l.signer_id WHERE s.document_id=?',
        [documentId],
      );
      if (!externalOnly)
        expect(logs.find((log) => log.signer_type === 'user')).toMatchObject({
          result: 'skipped',
          error_code: 'RECIPIENT_UNAVAILABLE',
        });
      const external = logs.find((log) => log.signer_type === 'email')!;
      const queue = ctx.app.get<
        Queue<{ notificationLogId?: number; notificationBatchId?: number }>
      >(getQueueToken(ESIGN_EXTERNAL_INVITATION_QUEUE));
      const delivery = (
        await queue.getJobs(['waiting', 'paused', 'delayed'])
      ).find(
        (queued) =>
          Number(
            (queued.data as { notificationLogId?: number }).notificationLogId,
          ) === Number(external.id),
      );
      expect(delivery).toBeDefined();
      if (!delivery) throw new Error('缺少測試邀請工作');
      const worker = new ExternalInvitationProcessor(
        mysql,
        ctx.app.get(NotificationRepository),
        ctx.app.get(SignerRepository),
        ctx.app.get(EsignTokenService),
        ctx.app.get(EsignAuditService),
        ctx.app.get<InvitationMailSender>(INVITATION_MAIL_SENDER),
      );
      await worker.process(delivery);
      const result = await mysql.query<Array<{ result: string }>>(
        'SELECT result FROM esign_notification_logs WHERE id=?',
        [external.id],
      );
      expect(result[0].result).toBe('skipped');
      expect((await summary(documentId, job.publicId)).status).toBe(
        'succeeded',
      );
      expect((await detail(documentId)).signers).toHaveLength(signers.length);
    },
  );

  it('名單含不存在員工，已查核的前批也不產生部分指派', async () => {
    const selected: InitiateDocumentDto['signers'] = users
      .slice(0, 500)
      .map((user) => ({ type: 'employee', employeeNo: user.empid }));
    selected.push({ type: 'employee', employeeNo: 'SYN022MISSING' });
    const { documentId, job } = await submit(selected);
    await ctx.app.get(EsignInitiationJobService).process(job.id);
    expect(await summary(documentId, job.publicId)).toMatchObject({
      status: 'failed',
      // 已查核包含失敗項目；022 issues 會收集完整問題後才結束。
      processedCount: 501,
      issueCount: 1,
      errorCode: 'ESIGN_INITIATION_EMPLOYEE_UNAVAILABLE',
    });
    expect(await detail(documentId)).toMatchObject({
      status: 'draft',
      signers: [],
    });
  });

  it('預查後員編身分改變，鎖內重新核對而整份失敗', async () => {
    const employee = users[500];
    const { documentId, job } = await submit([
      { type: 'user', userId: String(employee.id) },
    ]);
    const core = ctx.app.get(EsignInitiationService);
    const original = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    const changed = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementation(async (...args) => {
        await mysql
          .getManager()
          .update(User, employee.id, { empid: 'SYN022CHANGED' });
        return original(...args);
      });
    try {
      await ctx.app.get(EsignInitiationJobService).process(job.id);
    } finally {
      changed.mockRestore();
      await mysql
        .getManager()
        .update(User, employee.id, { empid: employee.empid });
    }
    expect((await summary(documentId, job.publicId)).status).toBe('failed');
    expect(await detail(documentId)).toMatchObject({
      status: 'draft',
      signers: [],
    });
  });

  it('超過一批指派與稽核已寫入後出錯，仍整筆回滾且沒有初邀', async () => {
    const { documentId, job } = await submit(
      users
        .slice(0, 501)
        .map((user) => ({ type: 'user', userId: String(user.id) })),
    );
    const core = ctx.app.get(EsignInitiationService);
    const original = core.initiateInTransaction.bind(
      core,
    ) as typeof core.initiateInTransaction;
    const fail = jest
      .spyOn(core, 'initiateInTransaction')
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new Error('合成跨批提交前故障');
      });
    try {
      await ctx.app.get(EsignInitiationJobService).process(job.id);
    } finally {
      fail.mockRestore();
    }
    expect((await summary(documentId, job.publicId)).status).toBe('failed');
    expect(await detail(documentId)).toMatchObject({
      status: 'draft',
      signers: [],
    });
    const rows = await mysql.query<Array<{ n: string }>>(
      'SELECT COUNT(*) n FROM esign_audit_events WHERE document_id=? AND event_type IN (?,?)',
      [documentId, 'document.initiated', 'signer.assigned'],
    );
    expect(Number(rows[0].n)).toBe(0);
    const batches = await mysql.query<Array<{ n: string }>>(
      'SELECT COUNT(*) n FROM esign_notification_batches WHERE document_id=?',
      [documentId],
    );
    expect(Number(batches[0].n)).toBe(0);
  });

  it('正式交易已有 RR 快照後原檔版本改變，仍以 current read 拒絕混用來源', async () => {
    const { documentId, job } = await submit([
      { type: 'user', userId: String(users[1].id) },
    ]);
    const original = await mysql.query<Array<{ sha256: string }>>(
      'SELECT sha256 FROM esign_file_objects WHERE document_id=? AND file_purpose=?',
      [documentId, 'source_pdf'],
    );
    const employeeEmails = ctx.app.get(EsignEmployeeEmailService);
    const resolve = employeeEmails.resolveForInitiation.bind(
      employeeEmails,
    ) as typeof employeeEmails.resolveForInitiation;
    const changed = jest
      .spyOn(employeeEmails, 'resolveForInitiation')
      .mockImplementation(async (...args) => {
        const rows = await resolve(...args);
        // 正式核心已讀文件而取得 RR 快照；模擬外部不遵守文件鎖的 metadata 竄改。
        await mysql.query(
          'UPDATE esign_file_objects SET sha256=? WHERE document_id=? AND file_purpose=?',
          ['0'.repeat(64), documentId, 'source_pdf'],
        );
        return rows;
      });
    try {
      await ctx.app.get(EsignInitiationJobService).process(job.id);
    } finally {
      changed.mockRestore();
      await mysql.query(
        'UPDATE esign_file_objects SET sha256=? WHERE document_id=? AND file_purpose=?',
        [original[0].sha256, documentId, 'source_pdf'],
      );
    }
    expect(await summary(documentId, job.publicId)).toMatchObject({
      status: 'failed',
      errorCode: 'ESIGN_INITIATION_DOCUMENT_CHANGED',
    });
    expect(await detail(documentId)).toMatchObject({
      status: 'draft',
      signers: [],
    });
  });

  it('受理後建立人停用，即使全外部名單也不能沿用先前授權', async () => {
    const { documentId, job } = await submit([
      {
        type: 'email',
        name: '合成外部簽署人',
        email: 'creator-disabled@example.invalid',
      },
    ]);
    await mysql.getManager().update(User, users[0].id, { isActive: false });
    try {
      await ctx.app.get(EsignInitiationJobService).process(job.id);
    } finally {
      await mysql.getManager().update(User, users[0].id, { isActive: true });
    }
    expect((await summary(documentId, job.publicId)).status).toBe('failed');
    expect(await detail(documentId)).toMatchObject({
      status: 'draft',
      signers: [],
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (!ctx) return;
    const manager = mysql.getManager();
    const batchIds = new Set<number>();
    const logIds = new Set<number>();
    for (const documentId of documents) {
      const batches = await manager.query<Array<{ id: number }>>(
        'SELECT id FROM esign_notification_batches WHERE document_id=?',
        [documentId],
      );
      batches.forEach((b) => batchIds.add(Number(b.id)));
      const logs = await manager.query<Array<{ id: number }>>(
        'SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=?',
        [documentId],
      );
      logs.forEach((l) => logIds.add(Number(l.id)));
    }
    for (const name of [
      ESIGN_DOCUMENT_INITIATION_QUEUE,
      ESIGN_EXTERNAL_INVITATION_QUEUE,
    ]) {
      const queue = ctx.app.get<Queue>(getQueueToken(name));
      for (const job of await queue.getJobs([
        'waiting',
        'paused',
        'delayed',
        'failed',
        'completed',
      ])) {
        const payload = job.data as {
          jobId?: number;
          notificationLogId?: number;
          notificationBatchId?: number;
        };
        if (
          (name === ESIGN_DOCUMENT_INITIATION_QUEUE &&
            ownedJobs.has(Number(payload.jobId))) ||
          (name === ESIGN_EXTERNAL_INVITATION_QUEUE &&
            (batchIds.has(Number(payload.notificationBatchId)) ||
              logIds.has(Number(payload.notificationLogId))))
        )
          await job.remove();
      }
    }
    for (const documentId of documents) {
      const files = await manager.query<
        Array<{ object_key: string; object_version: string | null }>
      >(
        'SELECT object_key,object_version FROM esign_file_objects WHERE document_id=?',
        [documentId],
      );
      await manager.transaction(async (tx) => {
        for (const table of [
          'esign_initiation_jobs',
          'esign_audit_events',
          'esign_file_objects',
          'esign_document_fields',
        ])
          await tx.query(`DELETE FROM ${table} WHERE document_id=?`, [
            documentId,
          ]);
        await tx.query(
          'DELETE FROM esign_notification_logs WHERE batch_id IN (SELECT id FROM esign_notification_batches WHERE document_id=?)',
          [documentId],
        );
        await tx.query(
          'DELETE FROM esign_notification_batches WHERE document_id=?',
          [documentId],
        );
        await tx.query('DELETE FROM esign_signers WHERE document_id=?', [
          documentId,
        ]);
        await tx.query('DELETE FROM esign_documents WHERE id=?', [documentId]);
      });
      for (const file of files)
        await ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE).delete({
          objectKey: file.object_key,
          objectVersion: file.object_version ?? undefined,
        });
    }
    for (let i = 0; i < users.length; i += 500) {
      const ids = users.slice(i, i + 500).map((u) => u.id);
      await manager.query('DELETE FROM auth_sessions WHERE user_id IN (?)', [
        ids,
      ]);
      await manager.delete(User, ids);
    }
    await closeSecurityE2eApp(ctx);
  });
});
