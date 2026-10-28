import type { EntityManager } from 'typeorm';
import { EsignDocument } from '../entities/esign-document.entity';
import { EsignSigner } from '../entities/esign-signer.entity';
import { EsignAuditEvent } from '../entities/esign-audit-event.entity';
import { DocumentRepository } from '../repositories/document.repository';
import { SignerRepository } from '../repositories/signer.repository';
import { AuditEventRepository } from '../repositories/audit-event.repository';
import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignAuditService } from './esign-audit.service';
import { EsignJobProducerService } from './esign-job-producer.service';
import { EsignRejectionService } from './esign-rejection.service';

const requestId = 'd94d7587-6fb7-4c06-8ebf-79a608ea23e3';
function fixture() {
  const document = Object.assign(new EsignDocument(), {
    id: 4,
    status: 'active',
    allowReject: true,
    signStartAt: new Date(Date.now() - 60000),
    signEndAt: new Date(Date.now() + 60000),
  });
  const signer = Object.assign(new EsignSigner(), {
    id: 8,
    publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
    documentId: 4,
    signerType: 'user',
    invitationTokenSha256: 'a'.repeat(64),
    email: 'employee@example.test',
    userId: 20,
    status: 'pending',
    invitationExpiresAt: new Date(Date.now() + 60000),
  });
  const events: object[] = [];
  const builder = {
    select: () => builder,
    addSelect: () => builder,
    where: () => builder,
    andWhere: () => builder,
    getRawOne: async () => ({
      total: '1',
      pending: signer.status === 'pending' ? '1' : '0',
      signed: '0',
      ready: '0',
    }),
  };
  const manager = {
    findOne: async (entity: unknown) =>
      entity === EsignDocument
        ? document
        : entity === EsignSigner
          ? signer
          : null,
    save: async (value: unknown) => value,
    insert: async (entity: unknown, value: object) => {
      if (entity === EsignAuditEvent) events.push(value);
      return {};
    },
    createQueryBuilder: () => builder,
  } as unknown as EntityManager;
  const validation = new EsignDocumentValidationService();
  const documents = new DocumentRepository();
  const service = new EsignRejectionService(
    {
      getManager: () => manager,
      transaction: async (run: (m: EntityManager) => unknown) => run(manager),
    } as never,
    documents,
    new SignerRepository(),
    new EsignAccessPolicyService(validation, documents),
    validation,
    new EsignAuditService(new AuditEventRepository()),
    new EsignJobProducerService(
      {} as never,
      { add: async () => undefined } as never,
      {} as never,
    ),
  );
  return { service, document, signer, events };
}
describe('本人拒簽', () => {
  it.each(['pending', 'rejected'])(
    '本人登入可提交或重送 %s 拒簽，跨人仍不可操作',
    async (status) => {
      const { service, signer } = fixture();
      Object.assign(signer, {
        status,
        rejectRequestId: requestId,
        rejectReason: '',
        rejectedAt: new Date(),
      });
      await expect(
        service.reject(
          signer.publicId,
          { kind: 'internal', userId: 20 },
          { requestId },
        ),
      ).resolves.toMatchObject({
        status: 'rejected',
        repeated: status === 'rejected',
      });
      await expect(
        service.reject(
          signer.publicId,
          { kind: 'internal', userId: 99 },
          { requestId },
        ),
      ).rejects.toMatchObject({ status: 404 });
    },
  );
  it('拒簽完成本人流程，同次重送保留首次證據，不同原因衝突', async () => {
    const { service, signer } = fixture();
    const first = await service.reject(
      signer.publicId,
      { kind: 'internal', userId: 20 },
      { requestId, reason: ' 不同意 ' },
    );
    expect(first).toMatchObject({
      status: 'rejected',
      reason: '不同意',
      repeated: false,
    });
    expect(
      await service.reject(
        signer.publicId,
        { kind: 'internal', userId: 20 },
        { requestId, reason: '不同意' },
      ),
    ).toEqual({ ...first, repeated: true });
    await expect(
      service.reject(
        signer.publicId,
        { kind: 'internal', userId: 20 },
        { requestId, reason: '改寫' },
      ),
    ).rejects.toThrow();
  });
  it('外部本人可拒簽並重送，但不同 cookie 不可代為操作', async () => {
    const { service, signer } = fixture();
    signer.signerType = 'email';
    await expect(
      service.reject(
        signer.publicId,
        {
          kind: 'external',
          invitationGenerationSha256: 'a'.repeat(64),
          signerId: 9,
        },
        { requestId },
      ),
    ).rejects.toThrow();
    const first = await service.reject(
      signer.publicId,
      {
        kind: 'external',
        invitationGenerationSha256: 'a'.repeat(64),
        signerId: 8,
      },
      { requestId },
    );
    expect(
      await service.reject(
        signer.publicId,
        {
          kind: 'external',
          invitationGenerationSha256: 'a'.repeat(64),
          signerId: 8,
        },
        { requestId },
      ),
    ).toEqual({ ...first, repeated: true });
  });
  it('補簽換代後，交易內拒絕舊外部身分操作', async () => {
    const { service, signer } = fixture();
    signer.signerType = 'email';
    signer.invitationTokenSha256 = 'b'.repeat(64);
    await expect(
      service.reject(
        signer.publicId,
        {
          kind: 'external',
          signerId: signer.id,
          invitationGenerationSha256: 'a'.repeat(64),
        },
        { requestId },
      ),
    ).rejects.toMatchObject({ code: 'ESIGN_EXTERNAL_UNAUTHORIZED' });
    expect(signer.status).toBe('pending');
  });
  it.each([
    'disabled',
    'expired',
    'not-started',
    'stopped',
    'signed',
    'wrong-user',
  ])('拒絕不符資格的 %s 操作', async (caseName) => {
    const { service, document, signer } = fixture();
    if (caseName === 'disabled') document.allowReject = false;
    if (caseName === 'expired') document.signEndAt = new Date(0);
    if (caseName === 'not-started')
      document.signStartAt = new Date(Date.now() + 60000);
    if (caseName === 'stopped') document.status = 'stopped';
    if (caseName === 'signed') signer.status = 'signed';
    await expect(
      service.reject(
        signer.publicId,
        {
          kind: 'external',
          signerId: caseName === 'wrong-user' ? 99 : 8,
          invitationGenerationSha256: 'a'.repeat(64),
        },
        { requestId },
      ),
    ).rejects.toThrow();
  });
});
