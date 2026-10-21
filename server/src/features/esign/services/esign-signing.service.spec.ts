import { EsignAccessPolicyService } from './esign-access-policy.service';
import { EsignDocumentValidationService } from './esign-document-validation.service';
import { EsignSigningService } from './esign-signing.service';

describe('EsignSigningService', () => {
  const manager = {} as never;
  const signerPublicId = 'c854d925-1d70-49dc-9c81-abf18409ae42';
  const requestId = 'd94d7587-6fb7-4c06-8ebf-79a608ea23e3';
  const signedAt = new Date('2026-10-13T12:00:00.000Z');

  function setup(repeated?: {
    signerId: number;
    signedAtUtc: Date;
    verificationCode?: string;
  }) {
    const signer = {
      id: 8,
      publicId: signerPublicId,
      documentId: 4,
      signerType: 'email',
      invitationTokenSha256: 'a'.repeat(64),
      userId: 20,
      status: repeated ? 'signed' : 'pending',
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
      assertExternalAccess: jest.fn(),
      assertExternalInvitation: jest.fn(),
    };
    const validation = {
      assertActiveSigningWindow: jest.fn(),
      assertFieldsBelongToDocument: jest.fn(),
    };
    const fields = { findByDocument: jest.fn(async () => [] as object[]) };
    const storage = { store: jest.fn(), delete: jest.fn() };
    const mysql = { getManager: jest.fn(() => manager) };
    const tokens = {
      verificationUrl: jest.fn((code?: string) =>
        code ? `https://esign.example.internal/verify/${code}` : null,
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
    return { service, signer, access, storage, fields, mysql, tokens };
  }

  /** 外部存取改用真實規則，避免 mock 掩蓋已簽者與待簽者的差異 */
  function useRealExternalPolicy(access: ReturnType<typeof setup>['access']) {
    const policy = new EsignAccessPolicyService(
      new EsignDocumentValidationService(),
      {} as never,
    );
    access.assertExternalAccess.mockImplementation(
      policy.assertExternalAccess.bind(policy),
    );
    access.assertExternalInvitation.mockImplementation(
      policy.assertExternalInvitation.bind(policy),
    );
  }

  const externalPrincipal = {
    kind: 'external' as const,
    invitationGenerationSha256: 'a'.repeat(64),
    signerId: 8,
  };

  it('補簽邀請世代改變後拒絕舊 session 簽署', async () => {
    const { service, signer } = setup();
    signer.invitationTokenSha256 = 'b'.repeat(64);
    await expect(
      service.sign(signerPublicId, externalPrincipal, submission, {}),
    ).rejects.toMatchObject({ code: 'ESIGN_EXTERNAL_UNAUTHORIZED' });
  });

  const submission = {
    requestId,
    consentVersion: 'esign-consent-v1',
    accepted: true as const,
    signatures: [],
  };

  it('同一內部 request 在文件結案後仍回既有結果且不重存 PNG', async () => {
    const { service, access, storage } = setup({
      signerId: 8,
      signedAtUtc: signedAt,
    });
    await expect(
      service.sign(
        signerPublicId,
        { kind: 'internal', userId: 20 },
        submission,
        {},
      ),
    ).resolves.toMatchObject({
      signerPublicId,
      signedAt,
      documentStatus: 'completed',
      repeated: true,
    });
    expect(access.assertInternalSigner).toHaveBeenCalled();
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('外部簽署人重送同一次簽名，在文件結案後仍回既有結果且不重存 PNG', async () => {
    const { service, access, storage } = setup({
      signerId: 8,
      signedAtUtc: signedAt,
    });
    useRealExternalPolicy(access);
    await expect(
      service.sign(signerPublicId, externalPrincipal, submission, {}),
    ).resolves.toMatchObject({
      signerPublicId,
      signedAt,
      documentStatus: 'completed',
      repeated: true,
    });
    expect(storage.store).not.toHaveBeenCalled();
  });

  it.each([
    ['重送', { signerId: 8, signedAtUtc: signedAt }],
    ['新簽名', undefined],
  ])(
    '外部%s的頁面簽署人與存取憑證不符時回 409，不回傳既有結果、不存簽名檔',
    async (_name, repeated) => {
      const { service, access, storage } = setup(repeated);
      useRealExternalPolicy(access);
      await expect(
        service.sign(
          signerPublicId,
          {
            kind: 'external',
            invitationGenerationSha256: 'a'.repeat(64),
            signerId: 9,
          },
          submission,
          {},
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: '此頁面的簽署對象已變更，請重新開啟邀請信中的連結',
      });
      expect(storage.store).not.toHaveBeenCalled();
    },
  );

  it('已簽署的外部簽署人以新的請求再次簽署回 401', async () => {
    const { service, signer, access, storage } = setup();
    signer.status = 'signed';
    useRealExternalPolicy(access);
    await expect(
      service.sign(signerPublicId, externalPrincipal, submission, {}),
    ).rejects.toMatchObject({ status: 401 });
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('重送時以簽署紀錄保存的驗證代碼組出相同網址', async () => {
    const verificationCode = 'c'.repeat(22);
    const { service, tokens } = setup({
      signerId: 8,
      signedAtUtc: signedAt,
      verificationCode,
    });
    const principal = { kind: 'internal' as const, userId: 20 };
    const first = await service.sign(signerPublicId, principal, submission, {});
    const second = await service.sign(
      signerPublicId,
      principal,
      submission,
      {},
    );

    expect(first.verificationUrl).toBe(
      `https://esign.example.internal/verify/${verificationCode}`,
    );
    expect(second.verificationUrl).toBe(first.verificationUrl);
    expect(tokens.verificationUrl).toHaveBeenCalledWith(verificationCode);
  });

  it('Spec 04 上線前的簽署紀錄沒有代碼時，驗證網址為 null', async () => {
    const { service } = setup({ signerId: 8, signedAtUtc: signedAt });
    await expect(
      service.sign(
        signerPublicId,
        { kind: 'internal', userId: 20 },
        submission,
        {},
      ),
    ).resolves.toMatchObject({ verificationUrl: null });
  });

  it('簽署失敗時不產生驗證網址', async () => {
    const { service, fields, tokens } = setup();
    fields.findByDocument.mockResolvedValue([
      { id: 11, documentId: 4, fieldType: 'signature' },
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
      { id: 11, documentId: 4, fieldType: 'signature' },
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
