import { EsignFieldService } from '#app/features/esign/services/esign-field.service';
import { MailRecipientPolicyService } from '#app/infrastructure/mail/mail-recipient-policy.service';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import { EsignEmployeeEmailService } from '#app/features/esign/services/esign-employee-email.service';
import { ExternalInvitationProcessor } from '#app/worker/esign/external-invitation.processor';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { EsignAuditService } from '#app/features/esign/services/esign-audit.service';
import { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import { HttpService } from '@nestjs/axios';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { In } from 'typeorm';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { ESIGN_EXTERNAL_INVITATION_QUEUE } from '#app/features/esign/esign-queue.constants';
import { HttpAccessLoggerService } from '#app/infrastructure/logging/httpEndpointLog/http-access-logger.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { apiData } from './api-response.helper';
import {
  createSecurityE2eApp,
  mailFixture,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

describe('Spec023 全公司本機 Email 容量（真實 HTTP/MySQL/Redis、合成來源）', () => {
  let ctx: SecurityE2eContext;
  let cookie: string;
  let users: User[];
  let documentId: string;
  const active = 0;
  const peak = 0;
  let batches: number[] = [];
  const origin = 'http://localhost:3000';
  const http = { get: jest.fn(), post: jest.fn() };
  let accessLog: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  const email = (empid: string) => `${empid}@capacity.example.test`;
  const post = (path: string, body: object) =>
    request(ctx.server)
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  const resetSource = () => {
    batches = [];
  };
  let measuredQueryCount = () => 0;
  const measure = async (
    operation: string,
    count: number,
    run: () => Promise<void>,
  ) => {
    resetSource();
    const started = performance.now();
    const memory = process.memoryUsage();
    const queries = jest.spyOn(
      ctx.app.get(MysqlService).getDataSource().logger,
      'logQuery',
    );
    measuredQueryCount = () => queries.mock.calls.length;
    // 保留 prototype 方法供 mock 以 originalPolicy.call(this, ...) 明確綁定原實例。
    const originalPolicy =
      // eslint-disable-next-line @typescript-eslint/unbound-method
      MailRecipientPolicyService.prototype.allowedRecipients;
    let policyMs = 0;
    let policyQueries = 0;
    let policyCalls = 0;
    const policySpy = jest
      .spyOn(MailRecipientPolicyService.prototype, 'allowedRecipients')
      .mockImplementation(async function (
        this: MailRecipientPolicyService,
        recipients,
      ) {
        const policyStarted = performance.now();
        const beforeQueries = queries.mock.calls.length;
        try {
          return await originalPolicy.call(this, recipients);
        } finally {
          policyMs += performance.now() - policyStarted;
          policyQueries += queries.mock.calls.length - beforeQueries;
          policyCalls++;
        }
      });
    try {
      await run();
    } finally {
      policySpy.mockRestore();
    }
    const queryCount = queries.mock.calls.length;
    queries.mockRestore();
    const after = process.memoryUsage();
    // 僅彙總數據，不輸出員編、信箱、cookie 或邀請秘密；記憶體差含 GC，並非峰值。
    console.info(
      'SPEC023_CAPACITY',
      JSON.stringify({
        operation,
        count,
        elapsedMs: Math.round(performance.now() - started),
        rssDeltaMiB: Math.round((after.rss - memory.rss) / 1048576),
        heapDeltaMiB: Math.round((after.heapUsed - memory.heapUsed) / 1048576),
        dbQueries: queryCount,
        policyMs: Math.round(policyMs),
        policyQueries,
        policyCalls,
        batches: batches.length,
        peak,
      }),
    );
  };
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(HttpService).useValue(http),
    );
    const manager = ctx.app.get(MysqlService).getManager();
    const prefix = `C${randomBytes(4).toString('hex')}`;
    const employeeNos = Array.from(
      { length: 5001 },
      (_, i) => `${prefix}${String(i).padStart(4, '0')}`,
    );
    for (let offset = 0; offset < 5001; offset += 500)
      await manager.insert(
        User,
        employeeNos.slice(offset, offset + 500).map((empid) => ({
          empid,
          email: email(empid).toLowerCase(),
          name: '合成容量員工',
          isActive: true,
          departmentCode: 'CAPACITY-SYNTHETIC',
          departmentName: '合成容量部門',
        })),
      );
    users = await manager.find(User, {
      where: { empid: In(employeeNos) },
      order: { empid: 'ASC' },
    });
    expect(users).toHaveLength(5001);
    mailFixture(ctx).allowEmails(users.map((user) => email(user.empid)));
    cookie = `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(users[0].id)).token}`;
    const pdf = await PDFDocument.create();
    pdf.addPage();
    documentId = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '全公司合成容量文件')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'capacity.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    ).id;
    accessLog = jest.spyOn(ctx.app.get(HttpAccessLoggerService), 'write');
    warn = jest.spyOn(ctx.app.get(AppLoggerService), 'warn');
    error = jest.spyOn(ctx.app.get(AppLoggerService), 'error');
    http.post.mockImplementation(() => {
      throw new Error('不應呼叫人資信箱');
    });
  }, 60000);
  afterAll(async () => {
    if (!ctx) return;
    // 只移除本次文件產生的 queue jobs，不清理其他測試的 queue。
    if (documentId) {
      const manager = ctx.app.get(MysqlService).getManager();
      const logs = await ctx.app
        .get(MysqlService)
        .getManager()
        .query<
          Array<{ id: number }>
        >('SELECT l.id FROM esign_notification_logs l JOIN esign_notification_batches b ON b.id=l.batch_id WHERE b.document_id=?', [documentId]);
      const queue = ctx.app.get<Queue>(
        getQueueToken(ESIGN_EXTERNAL_INVITATION_QUEUE),
      );
      for (const log of logs) {
        const jobId = await queue.getDeduplicationJobId(`invitation-${log.id}`);
        if (jobId) await (await queue.getJob(jobId))?.remove();
      }
      const ownedBatches = await manager.query<Array<{ id: number }>>(
        'SELECT id FROM esign_notification_batches WHERE document_id=?',
        [documentId],
      );
      const ownedBatchIds = new Set(
        ownedBatches.map((batch) => Number(batch.id)),
      );
      const ownedLogIds = new Set(logs.map((log) => Number(log.id)));
      for (const job of await queue.getJobs([
        'waiting',
        'paused',
        'delayed',
        'failed',
        'completed',
      ])) {
        if (
          ownedBatchIds.has(
            Number(
              (job.data as { notificationBatchId?: number })
                .notificationBatchId,
            ),
          ) ||
          ownedLogIds.has(
            Number(
              (job.data as { notificationLogId: number }).notificationLogId,
            ),
          )
        )
          await job.remove();
      }
      // 必須同時移除本次持久通知，否則後續 worker 的 maintenance 會重新補入 5001 筆。
      const files = await manager.query<
        Array<{ object_key: string; object_version: string | null }>
      >(
        'SELECT object_key,object_version FROM esign_file_objects WHERE document_id=?',
        [documentId],
      );
      await manager.transaction(async (transaction) => {
        for (const table of [
          'esign_audit_events',
          'esign_file_objects',
          'esign_document_fields',
        ])
          await transaction.query(`DELETE FROM ${table} WHERE document_id=?`, [
            documentId,
          ]);
        await transaction.query(
          'DELETE FROM esign_notification_logs WHERE batch_id IN (SELECT id FROM esign_notification_batches WHERE document_id=?)',
          [documentId],
        );
        await transaction.query(
          'DELETE FROM esign_notification_batches WHERE document_id=?',
          [documentId],
        );
        await transaction.query(
          'DELETE FROM esign_signers WHERE document_id=?',
          [documentId],
        );
        await transaction.query('DELETE FROM esign_documents WHERE id=?', [
          documentId,
        ]);
      });
      for (const file of files)
        await ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE).delete({
          objectKey: file.object_key,
          objectVersion: file.object_version ?? undefined,
        });
      for (let offset = 0; offset < users.length; offset += 500) {
        const ids = users.slice(offset, offset + 500).map((u) => u.id);
        await manager.query('DELETE FROM auth_sessions WHERE user_id IN (?)', [
          ids,
        ]);
        await manager.delete(User, ids);
      }
      expect(
        (await queue.getJobs(['waiting', 'paused', 'delayed', 'active'])).some(
          (job) =>
            ownedLogIds.has(
              Number(
                (job.data as { notificationLogId: number }).notificationLogId,
              ),
            ),
        ),
      ).toBe(false);
    }
    jest.restoreAllMocks();
    await closeSecurityE2eApp(ctx);
  }, 60000);

  it('已移除的信箱預檢回404且不呼叫來源，OpenAPI不再發布此功能', async () => {
    const previousRequests = http.post.mock.calls.length;
    await post(`/api/esign/documents/${documentId}/employee-email-checks`, {
      userIds: [String(users[0].id)],
    }).expect(404);
    expect(http.post.mock.calls.length).toBe(previousRequests);
    const api = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    expect(
      api.paths['/api/esign/documents/{documentId}/employee-email-checks'],
    ).toBeUndefined();
    expect(
      api.components?.schemas?.EmployeeEmailCheckResponseDto,
    ).toBeUndefined();
  });

  it.each([1, 100, 101, 5001])(
    '%i 人已存在帳號解析與信箱核對保序，不誤配且批次有界',
    async (count) => {
      const selected = users.slice(0, count);
      await measure('local-resolution', count, async () => {
        const items: Array<{
          employeeNo: string;
          userId: string;
          status: string;
        }> = [];
        for (let offset = 0; offset < count; offset += 100) {
          items.push(
            ...apiData<{ items: typeof items }>(
              await post('/api/esign/signer-candidates/resolutions', {
                employeeNos: selected
                  .slice(offset, offset + 100)
                  .map((u) => u.empid),
              }).expect(200),
            ).items,
          );
        }
        expect(
          items.map((item) => [item.employeeNo, item.userId, item.status]),
        ).toEqual(selected.map((u) => [u.empid, String(u.id), 'resolved']));
        expect(http.get).not.toHaveBeenCalled();
      });
      await measure('initiation-email-resolution', count, async () => {
        // 發起仍使用同一信箱解析服務；以真實帳號資料確認批次及員工對應。
        const service = ctx.app.get(EsignEmployeeEmailService);
        const map = await ctx.app.get(MysqlService).transaction((manager) =>
          service.resolveForInitiation(
            selected.map((u) => String(u.id)),
            users[0].id,
            manager,
          ),
        );
        expect(selected.map((u) => map.get(u.id)?.email)).toEqual(
          selected.map((u) => email(u.empid).toLowerCase()),
        );
        expect(http.post).not.toHaveBeenCalled();
        expect(batches).toEqual([]);
        expect(active).toBe(0);
      });
    },
    60000,
  );

  const initiate = () =>
    post(`/api/esign/documents/${documentId}/initiations`, {
      signers: users.map((u) => ({ type: 'user', userId: String(u.id) })),
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
    });
  it.each(['source'] as const)(
    '5001 人末批%s失敗整份仍為草稿，無指派／通知／發起稽核',
    async (mode) => {
      const usersRepo = ctx.app.get(UserRepository);
      const find = usersRepo.findByIdsWithEmail.bind(usersRepo);
      const fault = jest
        .spyOn(usersRepo, 'findByIdsWithEmail')
        .mockImplementationOnce(async (...args) => {
          await find(...args);
          throw new Error('合成資料庫來源故障');
        });
      await measure(`initiation-${mode}`, 5001, async () => {
        await initiate().expect(502);
        const detail = apiData<{ status: string; signers: unknown[] }>(
          await request(ctx.server)
            .get(`/api/esign/documents/${documentId}`)
            .set('Cookie', cookie)
            .expect(200),
        );
        expect(detail.status).toBe('draft');
        expect(detail.signers).toEqual([]);
        const [counts] = await ctx.app
          .get(MysqlService)
          .getManager()
          .query<
            Array<{ batches: string; initiated: string }>
          >("SELECT (SELECT COUNT(*) FROM esign_notification_batches WHERE document_id=?) batches,(SELECT COUNT(*) FROM esign_audit_events WHERE document_id=? AND event_type='document.initiated') initiated", [documentId, documentId]);
        expect(Number(counts.batches)).toBe(0);
        expect(Number(counts.initiated)).toBe(0);
        expect(http.post).not.toHaveBeenCalled();
      });
      fault.mockRestore();
    },
    60000,
  );

  it('5001 人完整發起固定信箱、快照與逐人通知，真正入列且日誌不含個資', async () => {
    await measure('initiation-success', 5001, async () => {
      // 僅量測 HTTP 發起；以下方法在現行流程依序執行，區間互不重疊。
      // 共用外層 query counter，不建立或還原另一個 logQuery spy。
      const phases = new Map<
        string,
        { calls: number; elapsedMs: number; dbQueries: number }
      >();
      let measuringPhase = false;
      const track = async <T>(
        operation: string,
        run: () => Promise<T>,
      ): Promise<T> => {
        if (measuringPhase) throw new Error('容量細分方法出現重疊，不能加總');
        measuringPhase = true;
        const started = performance.now();
        const beforeQueries = measuredQueryCount();
        try {
          return await run();
        } finally {
          const phase = phases.get(operation) ?? {
            calls: 0,
            elapsedMs: 0,
            dbQueries: 0,
          };
          phase.calls++;
          phase.elapsedMs += performance.now() - started;
          phase.dbQueries += measuredQueryCount() - beforeQueries;
          phases.set(operation, phase);
          measuringPhase = false;
        }
      };
      const emailResolutionOriginal =
        // eslint-disable-next-line @typescript-eslint/unbound-method
        EsignEmployeeEmailService.prototype.resolveForInitiation;
      const emailResolutionSpy = jest
        .spyOn(ctx.app.get(EsignEmployeeEmailService), 'resolveForInitiation')
        .mockImplementation((...args) =>
          track(
            'employee-resolution',
            () =>
              emailResolutionOriginal.call(
                ctx.app.get(EsignEmployeeEmailService),
                ...args,
              ) as ReturnType<typeof emailResolutionOriginal>,
          ),
        );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const signerSaveOriginal = SignerRepository.prototype.insertMany;
      let signerSaveCalls = 0;
      const signerSaveSpy = jest
        .spyOn(ctx.app.get(SignerRepository), 'insertMany')
        .mockImplementation((...args) =>
          track(
            `signer-save-${++signerSaveCalls}`,
            () =>
              signerSaveOriginal.call(
                ctx.app.get(SignerRepository),
                ...args,
              ) as ReturnType<typeof signerSaveOriginal>,
          ),
        );
      const notificationSaveOriginal =
        // eslint-disable-next-line @typescript-eslint/unbound-method
        NotificationRepository.prototype.insertLogs;
      const notificationSaveSpy = jest
        .spyOn(ctx.app.get(NotificationRepository), 'insertLogs')
        .mockImplementation((...args) =>
          track(
            'notification-save',
            () =>
              notificationSaveOriginal.call(
                ctx.app.get(NotificationRepository),
                ...args,
              ) as ReturnType<typeof notificationSaveOriginal>,
          ),
        );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const auditAppendOriginal = EsignAuditService.prototype.appendMany;
      const auditAppendSpy = jest
        .spyOn(ctx.app.get(EsignAuditService), 'appendMany')
        .mockImplementation((...args) =>
          track(
            'audit-append',
            () =>
              auditAppendOriginal.call(
                ctx.app.get(EsignAuditService),
                ...args,
              ) as ReturnType<typeof auditAppendOriginal>,
          ),
        );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const fieldsBuildOriginal = EsignFieldService.prototype.buildFields;
      const fieldsBuildSpy = jest
        .spyOn(ctx.app.get(EsignFieldService), 'buildFields')
        .mockImplementation((...args) =>
          track(
            'fields-build',
            () =>
              fieldsBuildOriginal.call(
                ctx.app.get(EsignFieldService),
                ...args,
              ) as ReturnType<typeof fieldsBuildOriginal>,
          ),
        );
      const initiationStarted = performance.now();
      const initiationQueryStart = measuredQueryCount();
      const response = await (async () => {
        try {
          return await initiate().expect(201);
        } finally {
          emailResolutionSpy.mockRestore();
          signerSaveSpy.mockRestore();
          notificationSaveSpy.mockRestore();
          auditAppendSpy.mockRestore();
          fieldsBuildSpy.mockRestore();
        }
      })();
      const initiationElapsedMs = performance.now() - initiationStarted;
      const initiationQueries = measuredQueryCount() - initiationQueryStart;
      // 防止逐人 SQL 悄悄回歸；5,001 人的初建應隨批數而非人數增加。
      expect(initiationQueries).toBeLessThan(500);
      expect(signerSaveCalls).toBe(1);
      const measuredPhases = [...phases].map(([operation, phase]) => ({
        operation,
        ...phase,
      }));
      const coveredMs = measuredPhases.reduce(
        (sum, phase) => sum + phase.elapsedMs,
        0,
      );
      const coveredQueries = measuredPhases.reduce(
        (sum, phase) => sum + phase.dbQueries,
        0,
      );
      console.info(
        'SPEC023_INITIATION_BREAKDOWN',
        JSON.stringify({
          count: 5001,
          nonOverlapping: true,
          phases: measuredPhases.map((phase) => ({
            ...phase,
            elapsedMs: Math.round(phase.elapsedMs),
          })),
          remaining: {
            elapsedMs: Math.round(initiationElapsedMs - coveredMs),
            dbQueries: initiationQueries - coveredQueries,
          },
          total: {
            elapsedMs: Math.round(initiationElapsedMs),
            dbQueries: initiationQueries,
          },
        }),
      );
      const result = apiData<{
        status: string;
        signers: Array<{ type: string; email: string }>;
      }>(response);
      console.info(
        'SPEC023_PHASE',
        JSON.stringify({
          operation: 'initiation-http',
          elapsedMs: Math.round(initiationElapsedMs),
          dbQueries: initiationQueries,
        }),
      );
      expect(result.status).toBe('active');
      expect(result.signers).toHaveLength(5001);
      expect(result.signers.map((s) => [s.type, s.email])).toEqual(
        users.map((u) => ['user', email(u.empid).toLowerCase()]),
      );
      expect(http.post).not.toHaveBeenCalled();
      expect(batches).toEqual([]);
      const manager = ctx.app.get(MysqlService).getManager();
      const logs = await manager.query<
        Array<{
          id: number;
          batchId: number;
          generation: string | null;
          digest: string | null;
        }>
      >(
        'SELECT l.id,l.batch_id batchId,l.invitation_generation_sha256 generation,s.invitation_token_sha256 digest FROM esign_notification_logs l JOIN esign_signers s ON s.id=l.signer_id WHERE s.document_id=?',
        [documentId],
      );
      expect(logs).toHaveLength(5001);
      expect(
        logs.every((l) => l.generation === null && l.digest === null),
      ).toBe(true);
      const queue = ctx.app.get<Queue>(
        getQueueToken(ESIGN_EXTERNAL_INVITATION_QUEUE),
      );
      const batchId = Number(logs[0].batchId);
      const jobId = await queue.getDeduplicationJobId(
        `internal-invitation-${batchId}`,
      );
      expect(jobId).toBeTruthy();
      expect((await queue.getJob(jobId!))?.data).toEqual({
        notificationBatchId: batchId,
      });
      const mailer = new FakeInvitationMailSender();
      const worker = new ExternalInvitationProcessor(
        ctx.app.get(MysqlService),
        ctx.app.get(NotificationRepository),
        ctx.app.get(SignerRepository),
        ctx.app.get(EsignTokenService),
        ctx.app.get(EsignAuditService),
        mailFixture(ctx).guard(mailer),
      );
      const workerStarted = performance.now();
      const workerQueryStart = measuredQueryCount();
      await worker.process({ data: { notificationBatchId: batchId } } as Job<{
        notificationBatchId: number;
      }>);
      console.info(
        'SPEC023_PHASE',
        JSON.stringify({
          operation: 'notification-worker',
          elapsedMs: Math.round(performance.now() - workerStarted),
          dbQueries: measuredQueryCount() - workerQueryStart,
        }),
      );
      expect(mailer.internalGroupDeliveries).toHaveLength(101);
      expect(
        mailer.internalGroupDeliveries.every(
          (group) => group.recipientEmails.length <= 50,
        ),
      ).toBe(true);
      expect(
        new Set(
          mailer.internalGroupDeliveries.flatMap(
            (group) => group.recipientEmails,
          ),
        ).size,
      ).toBe(5001);
      expect(mailer.deliveries).toEqual([]);
      const [delivered] = await manager.query<Array<{ total: string }>>(
        "SELECT COUNT(*) total FROM esign_notification_logs WHERE batch_id=? AND result='delivered'",
        [batchId],
      );
      expect(Number(delivered.total)).toBe(5001);
      const [document] = await manager.query<
        Array<{ signing_payload_json: string | { signers: unknown[] } }>
      >('SELECT signing_payload_json FROM esign_documents WHERE id=?', [
        documentId,
      ]);
      const payload =
        typeof document.signing_payload_json === 'string'
          ? (JSON.parse(document.signing_payload_json) as {
              signers: unknown[];
            })
          : document.signing_payload_json;
      expect(payload.signers).toHaveLength(5001);
      const audit = await manager.query<unknown[]>(
        'SELECT metadata_json FROM esign_audit_events WHERE document_id=?',
        [documentId],
      );
      const logged = JSON.stringify([
        accessLog.mock.calls,
        warn.mock.calls,
        error.mock.calls,
        audit,
      ]);
      for (const secret of [
        users[0].empid,
        email(users[0].empid).toLowerCase(),
        cookie.split('=')[1],
      ])
        expect(logged).not.toContain(secret);
    });
  }, 180000);
});
