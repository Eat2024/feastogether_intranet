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
      invitationExpiresAt: null as Date | null,
    };
    const document = {
      id: 4,
      status: 'completed',
      signStartAt: new Date(Date.now() - 60_000),
      signEndAt: new Date(Date.now() + 60_000),
    };
    const files = { findDocumentFile: jest.fn() };
    const audit = { append: jest.fn() };
    const completions = {
      personalCopy: jest.fn(async () => ({
        bytes: Buffer.from('%PDF-'),
        fileName: 'completed.pdf',
      })),
    };
    const access = new EsignAccessPolicyService(
      new EsignDocumentValidationService(),
      {} as never,
    );
    const service = new ExternalAccessService(
      { getManager: () => manager } as never,
      { findById: jest.fn(async () => document) } as never,
      {
        findByInvitationDigest: jest.fn(async () => signer),
        completionCounts: jest.fn(async () => ({ pending: 0, signed: 1 })),
      } as never,
      { findByDocument: jest.fn(async () => []) } as never,
      files as never,
      { digest: jest.fn(() => 'a'.repeat(64)) } as never,
      access,
      {} as never,
      { getActive: jest.fn(() => ({ version: 'esign-consent-v1' })) } as never,
      {
        documentSummary: jest.fn(() => ({ id: '4' })),
        signer: jest.fn(() => ({ publicId: signer.publicId })),
        field: jest.fn(),
      } as never,
      {} as never,
      audit as never,
      {} as never,
      completions as never,
    );
    return { service, signer, document, access, files, audit, completions };
  }

  it('只接受 32-byte base64url、固定 43 字元 invitation token', () => {
    const { service } = setup();
    expect(service.isTokenFormat('A'.repeat(43))).toBe(true);
    expect(service.isTokenFormat('A'.repeat(42))).toBe(false);
    expect(service.isTokenFormat(`${'A'.repeat(42)}=`)).toBe(false);
    expect(service.isTokenFormat(`${'A'.repeat(42)}+`)).toBe(false);
  });

  it('已簽者在文件完成後仍可取得簽署人識別碼，供重送同一次簽名取回既有結果', async () => {
    const { service, signer } = setup();
    await expect(service.signingSignerPublicId('A'.repeat(43))).resolves.toBe(
      signer.publicId,
    );
  });

  it('有效的待簽邀請可取得簽署人識別碼', async () => {
    const { service, signer, document } = setup();
    signer.status = 'pending';
    signer.invitationExpiresAt = new Date(Date.now() + 60_000);
    document.status = 'active';
    await expect(service.signingSignerPublicId('A'.repeat(43))).resolves.toBe(
      signer.publicId,
    );
  });

  it('憑證不符時拒絕讀取原始檔', async () => {
    const { service, signer, files } = setup();
    signer.invitationTokenSha256 = 'b'.repeat(64);
    await expect(service.source('A'.repeat(43))).rejects.toMatchObject({
      status: 401,
    });
    expect(files.findDocumentFile).not.toHaveBeenCalled();
  });

  it('唯讀查詢已簽者的任務，不記錄開啟稽核', async () => {
    const { service, signer, audit } = setup();
    await expect(service.task('A'.repeat(43), false)).resolves.toMatchObject({
      signerPublicId: signer.publicId,
    });
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('已簽者可下載本人副本', async () => {
    const { service, signer, document, completions } = setup();
    await expect(service.completedFile('A'.repeat(43))).resolves.toEqual({
      bytes: Buffer.from('%PDF-'),
      fileName: 'completed.pdf',
    });
    expect(completions.personalCopy).toHaveBeenCalledWith(document, signer);
  });

  it('尚未簽署時下載本人副本回 401', async () => {
    const { service, signer, document, completions } = setup();
    signer.status = 'pending';
    signer.invitationExpiresAt = new Date(Date.now() + 60_000);
    document.status = 'active';
    await expect(service.completedFile('A'.repeat(43))).rejects.toMatchObject({
      status: 401,
    });
    expect(completions.personalCopy).not.toHaveBeenCalled();
  });

  it('憑證不符時不讀取本人副本', async () => {
    const { service, signer, completions } = setup();
    signer.invitationTokenSha256 = 'b'.repeat(64);
    await expect(service.completedFile('A'.repeat(43))).rejects.toMatchObject({
      status: 401,
    });
    expect(completions.personalCopy).not.toHaveBeenCalled();
  });
});
