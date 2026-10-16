import type { EsignSigner } from '../entities/esign-signer.entity';
import { EsignViewMapper } from './esign-view.mapper';

describe('EsignViewMapper', () => {
  const tokens = {
    verificationUrl: jest.fn(
      (id: string) => `https://esign.example.internal/verify/token-of-${id}`,
    ),
  };
  const mapper = new EsignViewMapper(tokens as never);
  const signer = (status: 'pending' | 'signed') =>
    ({
      publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
      signerType: 'email',
      nameSnapshot: '外部簽署人',
      email: 'signer@example.test',
      status,
      signedAt: status === 'signed' ? new Date() : undefined,
    }) as EsignSigner;

  beforeEach(() => tokens.verificationUrl.mockClear());

  it('已簽署者的 signer view 帶驗證網址', () => {
    expect(mapper.signer(signer('signed'), null).verificationUrl).toBe(
      'https://esign.example.internal/verify/token-of-c854d925-1d70-49dc-9c81-abf18409ae42',
    );
  });

  it('尚未簽署者的 verificationUrl 為 null，且不簽發 token', () => {
    expect(mapper.signer(signer('pending'), null).verificationUrl).toBeNull();
    expect(tokens.verificationUrl).not.toHaveBeenCalled();
  });
});
