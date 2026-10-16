import { EsignSigningService } from './esign-signing.service';

describe('EsignSigningService', () => {
  const manager = {} as never;
  const signerPublicId = 'c854d925-1d70-49dc-9c81-abf18409ae42';
  const requestId = 'd94d7587-6fb7-4c06-8ebf-79a608ea23e3';
  const signedAt = new Date('2026-10-13T12:00:00.000Z');

  function setup(repeated?: { signerId: number; signedAtUtc: Date }) {
    const signer = {
      id: 8,
      publicId: signerPublicId,
      documentId: 4,
      signerType: 'email',
      userId: 20,
      status: repeated ? 'signed' : 'pending',
      invitationTokenSha256: 'a'.repeat(64),
    };
    const document = {
      id: 4,
      status: repeated ? 'completed' : 'active',
      docNumber: '550e8400-e29b-41d4-a716-446655440000',
    };
    const signers = {
      findByPublicId: jest.fn(async () => signer),
    };
    const documents = { findById: jest.fn(async () => document) };
    const records = {
      findByAuthenticationEventId: jest.fn(async () => repeated),
    };
    const access = {
      assertInternalSigner: jest.fn(),
      assertExternalCredential: jest.fn(),
      assertExternalInvitation: jest.fn(),
    };
    const validation = {
      assertActiveSigningWindow: jest.fn(),
      assertFieldsBelongToSigner: jest.fn(),
    };
    const fields = { findByDocument: jest.fn(async () => [] as object[]) };
    const storage = { store: jest.fn(), delete: jest.fn() };
    const mysql = { getManager: jest.fn(() => manager) };
    const tokens = {
      verificationUrl: jest.fn(
        (id: string) => `https://esign.example.internal/verify/token-of-${id}`,
      ),
    };
    const service = new EsignSigningService(
      mysql as never,
      documents as never,
      signers as never,
      fields as never,
      {} as never,
      records as never,
      access as never,
      validation as never,
      {} as never,
      { assertAccepted: jest.fn() } as never,
      tokens as never,
      {} as never,
      {} as never,
      storage as never,
    );
    return { service, access, storage, fields, mysql, tokens };
  }

  const submission = {
    requestId,
    consentVersion: 'esign-consent-v1',
    accepted: true as const,
    signatures: [],
  };

  it.each([
    ['internal', { kind: 'internal' as const, userId: 20 }],
    [
      'external',
      { kind: 'external' as const, invitationDigest: 'a'.repeat(64) },
    ],
  ])('同一 request 的 %s 重送在狀態終止後仍回既有結果且不重存 PNG', async (_name, principal) => {
    const { service, access, storage } = setup({ signerId: 8, signedAtUtc: signedAt });
    await expect(
      service.sign(signerPublicId, principal, submission, {}),
    ).resolves.toMatchObject({
      signerPublicId,
      signedAt,
      documentStatus: 'completed',
      repeated: true,
    });
    if (principal.kind === 'internal') {
      expect(access.assertInternalSigner).toHaveBeenCalled();
    } else {
      expect(access.assertExternalCredential).toHaveBeenCalled();
    }
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('簽署結果附上本人簽章驗證網址，重送回相同網址', async () => {
    const { service, tokens } = setup({ signerId: 8, signedAtUtc: signedAt });
    const principal = { kind: 'internal' as const, userId: 20 };
    const first = await service.sign(signerPublicId, principal, submission, {});
    const second = await service.sign(
      signerPublicId,
      principal,
      submission,
      {},
    );

    expect(first.verificationUrl).toBe(
      `https://esign.example.internal/verify/token-of-${signerPublicId}`,
    );
    expect(second.verificationUrl).toBe(first.verificationUrl);
    expect(tokens.verificationUrl).toHaveBeenCalledWith(signerPublicId);
  });

  it('簽署失敗時不產生驗證網址', async () => {
    const { service, fields, tokens } = setup();
    fields.findByDocument.mockResolvedValue([
      { id: 11, signerId: 8, documentId: 4, fieldType: 'signature' },
    ]);
    await expect(
      service.sign(
        signerPublicId,
        { kind: 'internal', userId: 20 },
        submission,
        {},
      ),
    ).rejects.toThrow();
    expect(tokens.verificationUrl).not.toHaveBeenCalled();
  });

  it('不是同一 request 時仍須完成所有本人 signature fields', async () => {
    const { service, storage, fields } = setup();
    fields.findByDocument.mockResolvedValue([
      { id: 11, signerId: 8, documentId: 4, fieldType: 'signature' },
    ]);
    await expect(
      service.sign(
        signerPublicId,
        { kind: 'internal', userId: 20 },
        submission,
        {},
      ),
    ).rejects.toThrow('請完成所有必要簽名欄位');
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('MySQL 不可用時 fail closed，不寫入任何簽名檔', async () => {
    const { service, storage, mysql } = setup();
    mysql.getManager.mockImplementation(() => {
      throw new Error('mysql unavailable');
    });
    await expect(
      service.sign(
        signerPublicId,
        { kind: 'internal', userId: 20 },
        submission,
        {},
      ),
    ).rejects.toThrow('mysql unavailable');
    expect(storage.store).not.toHaveBeenCalled();
  });
});
