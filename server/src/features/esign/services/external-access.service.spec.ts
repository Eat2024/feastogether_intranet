import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { ExternalAccessService } from './external-access.service';

describe('ExternalAccessService', () => {
  const manager = {} as never;

  function setup() {
    const signer = {
      id: 3,
      publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
      documentId: 4,
      signerType: 'email',
      status: 'signed',
      invitationTokenSha256: 'a'.repeat(64),
    };
    const document = { id: 4, status: 'completed' };
    const access = new EsignAccessPolicyService(
      new EsignDocumentValidationService(),
      {} as never,
    );
    const service = new ExternalAccessService(
      { getManager: () => manager } as never,
      { findById: jest.fn(async () => document) } as never,
      { findByInvitationDigest: jest.fn(async () => signer) } as never,
      {} as never,
      {} as never,
      { digest: jest.fn(() => 'a'.repeat(64)) } as never,
      access as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, signer, document, access };
  }

  it('只接受 32-byte base64url、固定 43 字元 invitation token', () => {
    const { service } = setup();
    expect(service.isTokenFormat('A'.repeat(43))).toBe(true);
    expect(service.isTokenFormat('A'.repeat(42))).toBe(false);
    expect(service.isTokenFormat(`${'A'.repeat(42)}=`)).toBe(false);
    expect(service.isTokenFormat(`${'A'.repeat(42)}+`)).toBe(false);
  });

  it('已簽署邀請不再授予提交或重放存取權限', async () => {
    const { service } = setup();
    await expect(
      service.signingSignerPublicId('A'.repeat(43)),
    ).rejects.toMatchObject({ status: 401 });
  });
});
