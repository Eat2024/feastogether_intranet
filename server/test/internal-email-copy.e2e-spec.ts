import { HttpService } from '@nestjs/axios';
import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type Job, type Queue } from 'bullmq';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PDFDocument } from 'pdf-lib';
import { of } from 'rxjs';
import request from 'supertest';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { User } from '#app/features/users/entities/user.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignTokenService } from '#app/features/esign/services/esign-token.service';
import { EsignExpiryService } from '#app/features/esign/services/esign-expiry.service';
import {
  ESIGN_DOCUMENT_FINALIZATION_QUEUE,
  ESIGN_EXTERNAL_INVITATION_QUEUE,
  ESIGN_MAINTENANCE_QUEUE,
} from '#app/features/esign/esign-queue.constants';
import { WorkerModule } from '#app/worker.module';
import { DocumentFinalizationProcessor } from '#app/worker/esign/document-finalization.processor';
import {
  PRIVATE_FILE_STORAGE,
  type PrivateFileStorage,
} from '#app/infrastructure/file-storage/private-file-storage.port';
import { apiData } from './api-response.helper';
import { esignTestPng } from './esign-test-png';
import { openExternalSession, requestOtp } from './external-session.helper';
import {
  getSignatureVerification,
  type SignatureVerification,
} from './signature-verification.helper';
import {
  createSecurityE2eApp,
  closeSecurityE2eApp,
  type SecurityE2eContext,
} from './security-e2e.helper';

interface Task {
  signerPublicId: string;
  document: { status: string };
  signer: { status: string; completion: { status: string } };
  consent: { version: string };
  fields: Array<{ id: string }>;
}

describe('Spec010 內部員工本人副本 HTTP／真實 PDF worker', () => {
  let ctx: SecurityE2eContext;
  let worker: INestApplicationContext;
  let users: User[];
  let creatorCookie: string;
  const queues: Queue[] = [];
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    ctx = await createSecurityE2eApp((builder) =>
      builder.overrideProvider(HttpService).useValue({
        post: (_url: string, body: { person_empids: string[] }) =>
          of({
            data: {
              success: true,
              data: body.person_empids.map((person_empid) => ({
                person_empid,
                email: 'copy@example.test',
              })),
            },
          }),
      }),
    );
    // 真實 worker 由測試逐次驅動，避免背景 consumer 搶先產製或清除邀請密文。
    for (const name of [
      ESIGN_DOCUMENT_FINALIZATION_QUEUE,
      ESIGN_EXTERNAL_INVITATION_QUEUE,
      ESIGN_MAINTENANCE_QUEUE,
    ]) {
      const queue = ctx.app.get<Queue>(getQueueToken(name));
      await queue.pause();
      queues.push(queue);
    }
    worker = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
    });
    const manager = ctx.app.get(MysqlService).getManager();
    const prefix = randomBytes(5).toString('hex');
    users = await manager.save(
      User,
      [0, 1, 2].map((i) =>
        manager.create(User, {
          empid: `C${prefix}${i}`,
          name: `合成副本員工${i}`,
          isActive: true,
        }),
      ),
    );
    creatorCookie = `${AUTH_COOKIE_NAME}=${(await ctx.app.get(AuthService).issueSession(users[0].id)).token}`;
  });
  afterAll(async () => {
    if (worker) await worker.close();
    for (const queue of queues) await queue.resume();
    if (ctx) await closeSecurityE2eApp(ctx);
  });
  async function fixture(signerCount = 2) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const created = apiData<{ id: string }>(
      await request(ctx.server)
        .post('/api/esign/documents')
        .set('Cookie', creatorCookie)
        .set('Origin', origin)
        .field('title', '合成副本驗收')
        .attach('file', Buffer.from(await pdf.save()), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    const document = apiData<{
      id: string;
      signers: Array<{ publicId: string }>;
    }>(
      await request(ctx.server)
        .post(`/api/esign/documents/${created.id}/initiations`)
        .set('Cookie', creatorCookie)
        .set('Origin', origin)
        .send({
          signers: users
            .slice(1, 1 + signerCount)
            .map((user) => ({ type: 'user', userId: String(user.id) })),
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
          allowReject: true,
        })
        .expect(201),
    );
    const signers = await Promise.all(
      document.signers.map(async ({ publicId }) => {
        const signer = await ctx.app
          .get(SignerRepository)
          .findByPublicId(publicId, ctx.app.get(MysqlService).getManager());
        if (!signer?.invitationTokenCiphertext)
          throw new Error('合成邀請缺少密文');
        return {
          id: signer.id,
          publicId,
          token: ctx.app
            .get(EsignTokenService)
            .decrypt(signer.invitationTokenCiphertext),
        };
      }),
    );
    const cookie = await openExternalSession(ctx, signers[0].token);
    return { document, signers, cookie };
  }
  function get(path: string, cookie: string) {
    return request(ctx.server)
      .get(`/api/external-signing-task${path}`)
      .set('Cookie', cookie);
  }
  async function sign(f: Awaited<ReturnType<typeof fixture>>) {
    const task = apiData<Task>(await get('', f.cookie).expect(200));
    const body = {
      signerPublicId: task.signerPublicId,
      requestId: randomUUID(),
      consentVersion: task.consent.version,
      accepted: true,
      signatures: task.fields.map(({ id }) => ({
        fieldId: id,
        pngDataUrl: `data:image/png;base64,${esignTestPng(10).toString('base64')}`,
      })),
    };
    const response = await request(ctx.server)
      .post('/api/external-signing-task/signatures')
      .set('Cookie', f.cookie)
      .set('Origin', origin)
      .send(body)
      .expect(201);
    expect(response.headers['set-cookie']).toBeUndefined();
    return {
      body,
      verificationUrl: apiData<{ verificationUrl: string }>(response)
        .verificationUrl,
    };
  }
  function finish(f: Awaited<ReturnType<typeof fixture>>) {
    return worker.get(DocumentFinalizationProcessor).process({
      data: { documentId: Number(f.document.id), signerId: f.signers[0].id },
    } as Job<{ documentId: number; signerId: number }>);
  }
  it('補簽只輪替待簽者；已簽者原邀請重新 OTP 取得相同 PDF 與不可變證據', async () => {
    const f = await fixture();
    const signed = await sign(f);
    await finish(f);
    const original = await get('/completed-file', f.cookie).expect(200);
    const evidence = apiData<SignatureVerification>(
      await getSignatureVerification(ctx.server, signed.verificationUrl).expect(
        200,
      ),
    );
    const pendingCookie = await openExternalSession(ctx, f.signers[1].token);
    const end = new Date(Date.now() - 1000);
    await ctx.app
      .get(MysqlService)
      .getManager()
      .query('UPDATE esign_documents SET sign_end_at=? WHERE id=?', [
        end,
        f.document.id,
      ]);
    await ctx.app
      .get(EsignExpiryService)
      .expireByDeadline(Number(f.document.id));
    await request(ctx.server)
      .post(`/api/esign/documents/${f.document.id}/reopenings`)
      .set('Cookie', creatorCookie)
      .set('Origin', origin)
      .send({
        expectedSignEndAt: end.toISOString(),
        signEndAt: new Date(Date.now() + 86400000).toISOString(),
        reason: '合成補簽副本驗收',
      })
      .expect(201);
    await get('', pendingCookie).expect(401);
    await requestOtp(ctx, f.signers[1].token).expect(401);
    const renewed = await openExternalSession(ctx, f.signers[0].token);
    expect((await get('/completed-file', renewed).expect(200)).body).toEqual(
      original.body,
    );
    const after = apiData<SignatureVerification>(
      await getSignatureVerification(ctx.server, signed.verificationUrl).expect(
        200,
      ),
    );
    expect(after.signature).toEqual(evidence.signature);
    expect(after.document.signedSourceSha256).toBe(
      evidence.document.signedSourceSha256,
    );
    expect(after.document.completedPdfSha256).toBe(
      evidence.document.completedPdfSha256,
    );
  });
  it('內部員工同次 OTP 存取可輪詢 pending→ready，取得與建立人完全相同的真實 PDF', async () => {
    const f = await fixture();
    await get('/completed-file', f.cookie).expect(401);
    await sign(f);
    expect(
      apiData<Task>(
        await get('', f.cookie)
          .expect(200)
          .expect('Cache-Control', 'private, no-store'),
      ).signer.completion.status,
    ).toBe('pending');
    await get('/completed-file', f.cookie).expect(409);
    await finish(f);
    expect(
      apiData<Task>(await get('', f.cookie).expect(200)).signer.completion
        .status,
    ).toBe('ready');
    const history = () =>
      request(ctx.server)
        .get(`/api/esign/documents/${f.document.id}/history`)
        .set('Cookie', creatorCookie)
        .expect(200);
    const before = apiData<unknown>(await history());
    const personal = await get('/completed-file', f.cookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
      .expect('Cache-Control', 'private, no-store')
      .expect('Content-Disposition', /^attachment;/);
    const creator = await request(ctx.server)
      .get(
        `/api/esign/documents/${f.document.id}/signers/${f.signers[0].publicId}/completed-file`,
      )
      .set('Cookie', creatorCookie)
      .expect(200);
    expect(personal.body).toEqual(creator.body);
    expect(
      (await PDFDocument.load(personal.body as Buffer)).getPageCount(),
    ).toBe(1);
    await get('', f.cookie).expect(200);
    await get('/source-file', f.cookie)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(apiData<unknown>(await history())).toEqual(before);
  });
  it('儲存設備失敗可讀 failed；重試處理中可讀 processing 並拒絕未就緒下載', async () => {
    const f = await fixture();
    await sign(f);
    const storage = worker.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    const store = storage.store.bind(storage) as PrivateFileStorage['store'];
    const failure = jest
      .spyOn(storage, 'store')
      .mockRejectedValueOnce(new Error('合成儲存設備故障'));
    try {
      await expect(finish(f)).rejects.toThrow('合成儲存設備故障');
      expect(
        apiData<Task>(await get('', f.cookie).expect(200)).signer.completion
          .status,
      ).toBe('failed');
      await get('/completed-file', f.cookie).expect(409);
    } finally {
      failure.mockRestore();
    }
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = jest
      .spyOn(storage, 'store')
      .mockImplementationOnce(async (input) => {
        entered();
        await blocked;
        return store(input);
      });
    const running = finish(f);
    try {
      await started;
      expect(
        apiData<Task>(await get('', f.cookie).expect(200)).signer.completion
          .status,
      ).toBe('processing');
      await get('/completed-file', f.cookie).expect(409);
    } finally {
      release();
      await running;
      gate.mockRestore();
    }
    expect(
      apiData<Task>(await get('', f.cookie).expect(200)).signer.completion
        .status,
    ).toBe('ready');
    await get('/completed-file', f.cookie).expect(200);
  });
  it.each(['expired', 'stopped', 'completed'])(
    '%s 後原邀請重新 OTP 仍可下載同一副本，不能再次簽署且證據不變',
    async (state) => {
      const f = await fixture(state === 'completed' ? 1 : 2);
      const signed = await sign(f);
      await finish(f);
      const original = await get('/completed-file', f.cookie).expect(200);
      const evidence = apiData<SignatureVerification>(
        await getSignatureVerification(
          ctx.server,
          signed.verificationUrl,
        ).expect(200),
      );
      if (state === 'stopped') {
        await request(ctx.server)
          .post(`/api/esign/documents/${f.document.id}/stoppages`)
          .set('Cookie', creatorCookie)
          .set('Origin', origin)
          .send({ reason: '合成停止驗收' })
          .expect(201);
      } else if (state === 'expired') {
        // 隔離資料庫的時間邊界 fixture：不可等待真實文件期限。
        await ctx.app
          .get(MysqlService)
          .getManager()
          .query(
            'UPDATE esign_documents SET sign_end_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE id=?',
            [f.document.id],
          );
        await ctx.app
          .get(EsignExpiryService)
          .expireByDeadline(Number(f.document.id));
      }
      await ctx.app
        .get(MysqlService)
        .getManager()
        .query(
          'UPDATE esign_signers SET invitation_expires_at=DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 10 YEAR) WHERE id=?',
          [f.signers[0].id],
        );
      const credential = f.cookie.split(';')[0].split('=')[1];
      const redis = ctx.app.get(RedisService);
      const key = `esign:external-access:${createHash('sha256').update(credential).digest('hex')}`;
      expect(await redis.ttl(key)).toBeLessThanOrEqual(8 * 60 * 60);
      expect(await redis.ttl(key)).toBeGreaterThan(8 * 60 * 60 - 60);
      // Redis 使用系統時鐘，刪除該測試 credential 模擬 8 小時後已由 Redis 過期。
      await redis.del(key);
      await get('/completed-file', f.cookie).expect(401);
      await get('/completed-file', creatorCookie).expect(401);
      await request(ctx.server)
        .get('/api/external-signing-task/completed-file')
        .expect(401);
      const renewed = await openExternalSession(ctx, f.signers[0].token);
      expect(apiData<Task>(await get('', renewed).expect(200))).toMatchObject({
        document: { status: state },
        signer: { status: 'signed', completion: { status: 'ready' } },
      });
      expect((await get('/completed-file', renewed).expect(200)).body).toEqual(
        original.body,
      );
      await request(ctx.server)
        .post('/api/external-signing-task/signatures')
        .set('Cookie', renewed)
        .set('Origin', origin)
        .send({ ...signed.body, requestId: randomUUID() })
        .expect(401);
      const after = apiData<SignatureVerification>(
        await getSignatureVerification(
          ctx.server,
          signed.verificationUrl,
        ).expect(200),
      );
      expect(after.signature).toEqual(evidence.signature);
      expect(after.document.signedSourceSha256).toBe(
        evidence.document.signedSourceSha256,
      );
      expect(after.document.completedPdfSha256).toBe(
        evidence.document.completedPdfSha256,
      );
      // 已發起文件無刪除 API；以隔離 fixture 模擬軟刪除，不增加業務刪除入口。
      await ctx.app
        .get(MysqlService)
        .getManager()
        .query(
          'UPDATE esign_documents SET deleted_at=UTC_TIMESTAMP(6) WHERE id=?',
          [f.document.id],
        );
      for (const path of ['', '/source-file', '/completed-file'])
        await get(path, renewed).expect(401);
      await requestOtp(ctx, f.signers[0].token).expect(401);
    },
  );
  it('拒簽僅可讀本人結果；同信箱其他人及其他文件不能讀取已簽者副本', async () => {
    const f = await fixture();
    await sign(f);
    await finish(f);
    const other = await openExternalSession(ctx, f.signers[1].token);
    await request(ctx.server)
      .post('/api/external-signing-task/rejection')
      .set('Cookie', other)
      .set('Origin', origin)
      .send({
        signerPublicId: f.signers[1].publicId,
        requestId: randomUUID(),
        reason: '合成拒簽',
      })
      .expect(201);
    expect(apiData<Task>(await get('', other).expect(200))).toMatchObject({
      signerPublicId: f.signers[1].publicId,
      signer: { status: 'rejected' },
    });
    await get('/source-file', other).expect(401);
    await get('/completed-file', other).expect(401);
    const another = await fixture();
    // 讀取介面無可改寫的文件／簽署人參數；偽造 query 仍只能得到 cookie 本人的結果。
    expect(
      apiData<Task>(
        await get(
          `?documentId=${f.document.id}&signerPublicId=${f.signers[0].publicId}`,
          another.cookie,
        ).expect(200),
      ).signerPublicId,
    ).toBe(another.signers[0].publicId);
    await get(
      `/completed-file?documentId=${f.document.id}&signerPublicId=${f.signers[0].publicId}`,
      another.cookie,
    ).expect(401);
    for (const cookie of [
      other,
      another.cookie,
      'FT_ESIGN_EXTERNAL_ACCESS=invalid',
    ]) {
      await request(ctx.server)
        .get(
          `/api/esign/documents/${f.document.id}/signers/${f.signers[0].publicId}/completed-file`,
        )
        .set('Cookie', cookie)
        .expect(401);
    }
    for (const path of ['', '/source-file', '/completed-file'])
      await get(path, 'FT_ESIGN_EXTERNAL_ACCESS=invalid').expect(401);
    // 即使 credential 還在，錯誤邀請世代不得放行已簽者。
    await ctx.app
      .get(MysqlService)
      .getManager()
      .query('UPDATE esign_signers SET invitation_token_sha256=? WHERE id=?', [
        randomBytes(32).toString('hex'),
        f.signers[0].id,
      ]);
    for (const path of ['', '/source-file', '/completed-file'])
      await get(path, f.cookie).expect(401);
  });
  it('儲存設備回傳被置換的有效 PDF 時，本人與建立人皆拒絕提供副本', async () => {
    const f = await fixture();
    await sign(f);
    await finish(f);
    const storage = ctx.app.get<PrivateFileStorage>(PRIVATE_FILE_STORAGE);
    const corruptPdf = await PDFDocument.create();
    corruptPdf.addPage([400, 400]);
    const bytes = Buffer.from(await corruptPdf.save());
    const fault = jest
      .spyOn(storage, 'openReadStream')
      .mockImplementation(() => Promise.resolve(Readable.from([bytes])));
    try {
      const personal = await get('/completed-file', f.cookie).expect(409);
      expect(JSON.stringify(personal.body)).toContain('ESIGN_INTEGRITY_FAILED');
      await request(ctx.server)
        .get(
          `/api/esign/documents/${f.document.id}/signers/${f.signers[0].publicId}/completed-file`,
        )
        .set('Cookie', creatorCookie)
        .expect(409);
    } finally {
      fault.mockRestore();
    }
    await get('/completed-file', f.cookie).expect(200);
  });
});
