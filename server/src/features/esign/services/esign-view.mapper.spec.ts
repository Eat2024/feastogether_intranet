import type { EsignSigner } from '../entities/esign-signer.entity';
import { EsignViewMapper } from './esign-view.mapper';

describe('EsignViewMapper', () => {
  const mapper = new EsignViewMapper({
    verificationUrl: (code?: string) =>
      code ? `https://esign.example.internal/verify/${code}` : null,
  } as never);
  const signer = (status: 'pending' | 'signed') =>
    ({
      publicId: 'c854d925-1d70-49dc-9c81-abf18409ae42',
      signerType: 'email',
      nameSnapshot: '外部簽署人',
      email: 'signer@example.test',
      status,
      signedAt: status === 'signed' ? new Date() : undefined,
    }) as EsignSigner;

  it('已簽署者以簽署紀錄的驗證代碼組出驗證網址', () => {
    expect(
      mapper.signer(signer('signed'), null, 'c'.repeat(22)).verificationUrl,
    ).toBe(`https://esign.example.internal/verify/${'c'.repeat(22)}`);
  });

  it('尚未簽署者沒有驗證代碼，verificationUrl 為 null', () => {
    expect(mapper.signer(signer('pending'), null).verificationUrl).toBeNull();
  });
});
