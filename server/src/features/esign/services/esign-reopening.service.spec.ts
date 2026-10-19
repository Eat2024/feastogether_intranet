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

// 僅替換 DB 邊界；服務、授權、憑證與稽核皆使用真正實作。
describe('EsignReopeningService', () => {
  function setup() {
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
    });
    const query = {
      innerJoin: () => query,
      where: () => query,
      orderBy: () => query,
      setLock: () => query,
      getMany: () => Promise.resolve([]),
    };
    const manager = {
      findOne: (entity: unknown) =>
        Promise.resolve(entity === EsignDocument ? document : null),
      find: (entity: unknown) =>
        Promise.resolve(entity === EsignSigner ? [signer] : []),
      save: (value: unknown) => Promise.resolve(value),
      insert: () => Promise.resolve({}),
      createQueryBuilder: () => query,
    };
    const mysql = {
      transaction: <T>(fn: (manager: never) => Promise<T>) =>
        fn(manager as never),
    };
    const documents = new DocumentRepository();
    const signers = new SignerRepository();
    const audit = new EsignAuditService(new AuditEventRepository());
    const service = new EsignReopeningService(
      mysql as never,
      documents,
      signers,
      new NotificationRepository(),
      new EsignAccessPolicyService(),
      new EsignDocumentValidationService(),
      new EsignExpiryService(mysql as never, documents, signers, audit),
      new EsignTokenService(
        new ConfigService({
          ESIGN_INVITATION_ENCRYPTION_KEY_B64: Buffer.alloc(32, 1).toString(
            'base64',
          ),
          EXTERNAL_SIGNING_ORIGIN: 'https://example.test',
        }),
      ),
      audit,
    );
    return {
      service,
      document,
      signer,
      input: {
        expectedSignEndAt: end.toISOString(),
        signEndAt: next.toISOString(),
        reason: '補簽',
      },
      end,
      next,
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
