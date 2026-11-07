import { In } from 'typeorm';
import { AuthorizationUserRole } from '#app/features/authorization/entities/authorization-user-role.entity';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import type { EsignDocumentListItemDto } from '#app/features/esign/dto/esign-common.dto';
import { randomBytes, randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { EsignInitiationJobService } from '#app/features/esign/services/esign-initiation-job.service';
import { EsignInitiationJob } from '#app/features/esign/entities/esign-initiation-job.entity';
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
import { documentCreatorSessionCookie } from './helpers/authorization-business-fixtures';

describe('025 發起列表一致性與終態', () => {
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
    const prefix = `Q${randomBytes(4).toString('hex')}`;
    users = await mysql.getManager().save(
      User,
      [0, 1].map((i) => ({
        empid: `${prefix}${i}`,
        name: '合成查詢員工',
        isActive: true,
        email: null,
        departmentCode: 'SYN022QUERY',
        departmentName: '合成查詢部門',
      })),
    );
    cookie = await session(users[0].id);
    const source = await PDFDocument.create();
    source.addPage();
    pdf = Buffer.from(await source.save());
  });
  async function session(userId: number) {
    return await documentCreatorSessionCookie(ctx.app, userId);
  }
  async function newDoc() {
    const id = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', cookie)
        .set('Origin', origin)
        .field('title', '合成背景查詢文件')
        .attach('file', pdf, 'test.pdf')
        .expect(201),
    ).id;
    documents.push(id);
    return id;
  }
  function body(): InitiateDocumentDto {
    return {
      signers: [{ type: 'user', userId: String(users[0].id) }],
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
  }
  async function submit(
    documentId: string,
    input = body(),
    key = randomUUID(),
  ) {
    const accepted = apiData<InitiationJobDto>(
      await request(ctx.server)
        .post(`/api/esign/documents/${documentId}/initiations`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .set('Idempotency-Key', key)
        .send(input)
        .expect(202),
    );
    const job = await mysql
      .getManager()
      .findOneByOrFail(EsignInitiationJob, { publicId: accepted.jobId });
    ownedJobs.add(job.id);
    return job;
  }
  async function listItem(documentId: string) {
    const rows = apiData<EsignDocumentListItemDto[]>(
      await request(ctx.server)
        .get('/api/esign/documents?role=dep')
        .set('Cookie', cookie)
        .expect(200),
    );
    return rows.find((row) => row.id === documentId)!;
  }
  it.each(['succeeded', 'failed'] as const)(
    '列表讀取中 worker %s：不混用不同提交版本，下一次讀取收斂',
    async (terminal) => {
      const id = await newDoc();
      const input = body();
      if (terminal === 'failed')
        input.signers = [{ type: 'employee', employeeNo: 'MISSING025RACE' }];
      const job = await submit(id, input);
      const repository = ctx.app.get<DocumentRepository>(DocumentRepository);
      const reader = new DocumentRepository();
      const read = (
        ...args: Parameters<DocumentRepository['findByDepartment']>
      ) => reader.findByDepartment(...args);
      let signalRead!: () => void;
      let releaseRead!: () => void;
      const hasRead = new Promise<void>((resolve) => {
        signalRead = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const spy = jest
        .spyOn(repository, 'findByDepartment')
        .mockImplementationOnce(async (...args) => {
          const rows = await read(...args);
          signalRead();
          await hold;
          return rows;
        });
      const pending = listItem(id);
      try {
        await hasRead;
        // 列表交易仍持有連線；真正 worker 必須由另一連線提交且不能被讀取阻塞。
        await ctx.app.get(EsignInitiationJobService).process(job.id);
        expect(
          apiData<InitiationJobDto>(
            await request(ctx.server)
              .get(`/api/esign/documents/${id}/initiation-jobs/latest`)
              .set('Cookie', cookie)
              .expect(200),
          ).status,
        ).toBe(terminal);
      } finally {
        releaseRead();
        spy.mockRestore();
      }
      expect(await pending).toMatchObject({
        status: 'initiating',
        pendingCount: 0,
        signedCount: 0,
        initiation: {
          signStartAt: input.signStartAt,
          signEndAt: input.signEndAt,
          totalCount: 1,
        },
      });
      expect(await listItem(id)).toMatchObject({
        status: terminal === 'succeeded' ? 'active' : 'draft',
        initiation: null,
        pendingCount: terminal === 'succeeded' ? 1 : 0,
        signedCount: 0,
      });
    },
  );
  it('自動重試等待保持摘要，最終失敗才恢復草稿', async () => {
    const id = await newDoc();
    const input = body();
    input.signers = [{ type: 'employee', employeeNo: 'MISSING025RETRY' }];
    const job = await submit(id, input);
    await mysql.getManager().update(EsignInitiationJob, job.id, {
      attemptCount: 1,
      nextAttemptAt: new Date(Date.now() + 30000),
    });
    expect(await listItem(id)).toMatchObject({
      status: 'initiating',
      initiation: {
        totalCount: 1,
        signStartAt: input.signStartAt,
        signEndAt: input.signEndAt,
      },
    });
    await mysql.getManager().update(EsignInitiationJob, job.id, {
      nextAttemptAt: new Date(Date.now() - 1000),
    });
    await ctx.app.get(EsignInitiationJobService).process(job.id);
    expect(await listItem(id)).toMatchObject({
      status: 'draft',
      initiation: null,
      pendingCount: 0,
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
      await manager.delete(AuthorizationUserRole, { userId: In(ids) });
      await manager.delete(User, ids);
    }
    await closeSecurityE2eApp(ctx);
  });
});
