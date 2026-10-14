import { EsignSignerService } from './esign-signer.service';

describe('EsignSignerService', () => {
  const service = new EsignSignerService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('外部簽署 Email 只做 trim + lowercase', () => {
    expect(service.normalizeEmail('  Candidate+HR@Example.COM ')).toBe(
      'candidate+hr@example.com',
    );
  });
});
