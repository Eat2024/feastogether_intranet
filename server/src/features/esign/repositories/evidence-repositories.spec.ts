import { AuditEventRepository } from './audit-event.repository';
import { SignatureRecordRepository } from './signature-record.repository';
import { VerificationRecordRepository } from './verification-record.repository';

describe('evidence repository boundaries', () => {
  it.each([SignatureRecordRepository, AuditEventRepository])(
    '%p 只暴露 insert/query，不暴露通用更新或刪除',
    (RepositoryClass) => {
      const repository = new RepositoryClass() as unknown as Record<
        string,
        unknown
      >;
      expect(repository).not.toHaveProperty('save');
      expect(repository).not.toHaveProperty('update');
      expect(repository).not.toHaveProperty('delete');
      expect(repository).not.toHaveProperty('softDelete');
    },
  );

  it('verification 只額外暴露窄化 revoke', () => {
    const repository = new VerificationRecordRepository() as unknown as Record<
      string,
      unknown
    >;
    expect(repository).toHaveProperty('revoke');
    expect(repository).not.toHaveProperty('save');
    expect(repository).not.toHaveProperty('delete');
  });
});
