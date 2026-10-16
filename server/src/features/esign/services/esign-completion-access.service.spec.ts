import { EsignCompletionAccessService } from './esign-completion-access.service';

describe('EsignCompletionAccessService', () => {
  it('外部完成狀態帶本人簽章驗證網址', async () => {
    const signer = {
      id: 8,
      publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
      documentId: 4,
    };
    const document = {
      id: 4,
      title: '測試文件',
      status: 'active',
    };
    const tokens = {
      digest: jest.fn(() => 'd'.repeat(64)),
      verificationUrl: jest.fn(
        (id: string) => `https://esign.example.internal/verify/token-of-${id}`,
      ),
    };
    const service = new EsignCompletionAccessService(
      { getManager: () => ({}) } as never,
      { findById: jest.fn(async () => document) } as never,
      { findByReceiptDigest: jest.fn(async () => signer) } as never,
      {} as never,
      {} as never,
      tokens as never,
      { assertReceipt: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.receiptStatus(signer.publicId, 'receipt-token'),
    ).resolves.toEqual({
      title: '測試文件',
      status: 'active',
      completedAt: null,
      stoppedAt: null,
      verificationUrl: `https://esign.example.internal/verify/token-of-${signer.publicId}`,
    });
  });
});
