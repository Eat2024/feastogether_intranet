import { EsignReopeningService } from './esign-reopening.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { canonicalSha256, EsignAuditService } from './esign-audit.service';
import { EsignExpiryService } from './esign-expiry.service';
import { EsignTokenService } from './esign-token.service';
import { ConfigService } from '@nestjs/config';
import { DocumentRepository } from '../repositories/document.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { AuditEventRepository } from '../repositories/audit-event.repository';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { EsignNotificationBatch } from '../entities/esign-notification-batch.entity';
import { EsignNotificationLog } from '../entities/esign-notification-log.entity';
import { EsignJobProducerService } from './esign-job-producer.service';

// 僅替換 DB 邊界；服務、授權、憑證與稽核皆使用真正實作。
describe('EsignReopeningService', () => {
  function setup() {
    const queued: unknown[] = [];
    const persisted: unknown[] = [];
    let committed = false;
    const oldLogs: EsignNotificationLog[] = [];
    const end = new Date(Date.now() - 1_000);
    const next = new Date(Date.now() + 60_000);
    const payload = {
      period: {
        startAt: new Date(end.getTime() - 60_000).toISOString(),
        endAt: end.toISOString(),
      },
    };
    const document = Object.assign(new EsignDocument(), {
      id: 1,
      createdByUserId: 2,
      status: 'expired',
      signEndAt: end,
      signingPayloadJson: payload,
      signingPayloadSha256: canonicalSha256(payload),
    });
    const signer = Object.assign(new EsignSigner(), {
      id: 1,
      documentId: 1,
      status: 'pending',
      signerType: 'email',
      publicId: 'synthetic-signer',
      email: 'employee@example.test',
      invitationTokenSha256: 'a'.repeat(64),
      invitationExpiresAt: end,
    });
    const selectedSigners = [signer];
    const query = {
      innerJoin: () => query,
      where: () => query,
      orderBy: () => query,
      setLock: () => query,
      getMany: () => Promise.resolve(oldLogs),
    };
    const manager = {
      findOne: (entity: unknown) =>
        Promise.resolve(entity === EsignDocument ? document : null),
      find: (entity: unknown) =>
        Promise.resolve(entity === EsignSigner ? selectedSigners : []),
      save: (value: unknown) => {
        persisted.push(value);
        return Promise.resolve(value);
      },
      create: (entity: new () => object, fields: object) =>
        Object.assign(new entity(), { id: persisted.length + 10 }, fields),
      insert: () => Promise.resolve({}),
      createQueryBuilder: () => query,
    };
    const mysql = {
      transaction: async <T>(fn: (manager: never) => Promise<T>) => {
        const result = await fn(manager as never);
        committed = true;
        return result;
      },
    };
    const documents = new DocumentRepository();
    const signers = new SignerRepository();
    const audit = new EsignAuditService(new AuditEventRepository());
    const expiry = new EsignExpiryService(
      mysql as never,
      documents,
      signers,
      audit,
    );
    const service = new EsignReopeningService(
      mysql as never,
      documents,
      signers,
      new NotificationRepository(),
      new EsignAccessPolicyService(
        new EsignDocumentValidationService(),
        documents,
      ),
      new EsignDocumentValidationService(),
      expiry,
      new EsignTokenService(
        new ConfigService({
          ESIGN_INVITATION_ENCRYPTION_KEY_B64: Buffer.alloc(32, 1).toString(
            'base64',
          ),
          EXTERNAL_SIGNING_ORIGIN: 'https://example.test',
        }),
      ),
      audit,
      new EsignJobProducerService(
        {
          addBulk: (jobs: unknown[]) => {
            expect(committed).toBe(true);
            queued.push(...jobs);
            return Promise.resolve([]);
          },
        } as never,
        {} as never,
        {} as never,
      ),
    );
    return {
      service,
      expiry,
      document,
      signer,
      selectedSigners,
      input: {
        expectedSignEndAt: end.toISOString(),
        signEndAt: next.toISOString(),
        reason: '補簽',
      },
      end,
      next,
      persisted,
      queued,
      oldLogs,
    };
  }
  it('已到期文件可重新開放，保存原始快照並回傳不含憑證的交易結果', async () => {
    const { service, input, end, next } = setup();
    const result = await service.reopen(1, 2, input);
    expect(result).toMatchObject({
      documentId: '1',
      status: 'active',
      originalSignEndAt: end.toISOString(),
      signEndAt: next.toISOString(),
      isReopened: true,
      pendingCount: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/token|ciphertext|digest/i);
  });
  it.each(['draft', 'finalizing', 'completed', 'stopped'])(
    '%s 不可補簽',
    async (status) => {
      const { service, document, input } = setup();
      document.status = status;
      await expect(service.reopen(1, 2, input)).rejects.toMatchObject({
        code: 'ESIGN_DOCUMENT_NOT_REOPENABLE',
      });
    },
  );
  it('任何待簽者缺固定信箱時拒絕整次補簽，不透露信箱', async () => {
    const { service, signer, input } = setup();
    signer.email = null;
    await expect(service.reopen(1, 2, input)).rejects.toMatchObject({
      code: 'ESIGN_REOPEN_RECIPIENT_UNAVAILABLE',
      response: { details: { signerPublicIds: ['synthetic-signer'] } },
    });
  });
  it('內部補簽保留歷史 token 供舊入口識別，不輪替、不用它授權', async () => {
    const { service, signer, input, end, queued } = setup();
    signer.signerType = 'user';
    await service.reopen(1, 2, input);
    expect(signer.invitationTokenSha256).toBe('a'.repeat(64));
    expect(signer.email).toBe('employee@example.test');
    expect(signer.invitationExpiresAt).toEqual(end);
    expect(queued).toEqual([
      expect.objectContaining({
        data: { notificationBatchId: expect.any(Number) },
      }),
    ]);
  });
  it('沒有 Email 與 token 的內部待簽者仍可補簽，通知記 skipped 不入列', async () => {
    const { service, signer, input, persisted, queued } = setup();
    signer.signerType = 'user';
    signer.email = null;
    signer.invitationTokenSha256 = null;
    signer.invitationExpiresAt = null;
    const result = await service.reopen(1, 2, input);
    expect(result.status).toBe('active');
    expect(queued).toEqual([]);
    expect(
      persisted.flat().filter((row) => row instanceof EsignNotificationLog),
    ).toEqual([
      expect.objectContaining({
        result: 'skipped',
        errorCode: 'RECIPIENT_UNAVAILABLE',
        invitationGenerationSha256: null,
        completedAt: expect.any(Date),
      }),
    ]);
  });
  it('補簽提交後會建立可追蹤的逐人邀請並入列', async () => {
    const { service, input, persisted, queued } = setup();
    await service.reopen(1, 2, input);
    expect(
      persisted.flat().filter((row) => row instanceof EsignNotificationBatch),
    ).toHaveLength(1);
    expect(
      persisted.flat().filter((row) => row instanceof EsignNotificationLog),
    ).toHaveLength(1);
    expect(queued).toHaveLength(1);
  });
  it('到期掃描落盤後仍可用既有固定身分補簽，不回填缺少的邀請', async () => {
    const { service, expiry, document, input } = setup();
    document.status = 'active';
    expect(await expiry.expireByDeadline(1)).toBe(true);
    await expect(service.reopen(1, 2, input)).resolves.toMatchObject({
      status: 'active',
    });
  });
  it('只作廢待簽者未完成的通知，保留已簽者與已送達通知', async () => {
    const { service, input, oldLogs } = setup();
    oldLogs.push(
      Object.assign(new EsignNotificationLog(), {
        signerId: 1,
        result: 'processing',
        leaseToken: 'old-lease',
        reminderTokenCiphertext: 'old-secret',
      }),
      Object.assign(new EsignNotificationLog(), {
        signerId: 2,
        result: 'processing',
      }),
      Object.assign(new EsignNotificationLog(), {
        signerId: 1,
        result: 'delivered',
      }),
    );
    await service.reopen(1, 2, input);
    expect(oldLogs[0]).toMatchObject({
      result: 'failed',
      errorCode: 'INVITATION_SUPERSEDED',
      leaseToken: null,
      reminderTokenCiphertext: null,
    });
    expect(oldLogs[1].result).toBe('processing');
    expect(oldLogs[2].result).toBe('delivered');
  });
  it('已簽與已拒者不輪替、不補寄且不更改既有快照', async () => {
    const { service, input, selectedSigners, queued, document } = setup();
    const frozen = ['signed', 'rejected'].map((status, i) =>
      Object.freeze(
        Object.assign(new EsignSigner(), {
          id: i + 2,
          documentId: 1,
          status,
          signerType: 'user',
          email: 'prior@example.test',
          invitationTokenSha256: 'b'.repeat(64),
          invitationExpiresAt: new Date(0),
        }),
      ),
    );
    selectedSigners.push(...frozen);
    const payload = document.signingPayloadJson;
    const hash = document.signingPayloadSha256;
    const result = await service.reopen(1, 2, input);
    expect(result.pendingCount).toBe(1);
    expect(queued).toHaveLength(1);
    expect(document.signingPayloadJson).toBe(payload);
    expect(document.signingPayloadSha256).toBe(hash);
    expect(frozen.map((s) => s.invitationTokenSha256)).toEqual([
      'b'.repeat(64),
      'b'.repeat(64),
    ]);
  });
  it('不存在未簽者時不可補簽', async () => {
    const { service, signer, input } = setup();
    signer.status = 'signed';
    await expect(service.reopen(1, 2, input)).rejects.toMatchObject({
      code: 'ESIGN_DOCUMENT_NOT_REOPENABLE',
    });
  });
  it.each([
    undefined,
    null,
    true,
    [],
    {},
    { period: {} },
    { period: { startAt: 'invalid', endAt: 'invalid' } },
  ])('快照缺漏或期限錯誤回完整性錯誤', async (payload) => {
    const { service, document, input } = setup();
    Object.assign(document, {
      signingPayloadJson: payload,
      signingPayloadSha256: payload ? canonicalSha256(payload) : null,
    });
    await expect(service.reopen(1, 2, input)).rejects.toMatchObject({
      code: 'ESIGN_INTEGRITY_FAILED',
    });
  });
  it('快照雜湊不符不可補簽', async () => {
    const { service, document, input } = setup();
    document.signingPayloadSha256 = 'bad';
    await expect(service.reopen(1, 2, input)).rejects.toMatchObject({
      code: 'ESIGN_INTEGRITY_FAILED',
    });
  });
});
