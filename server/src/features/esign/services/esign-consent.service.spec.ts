import {
  ACTIVE_ESIGN_CONSENT_SHA256,
  ACTIVE_ESIGN_CONSENT_TEXT,
  ACTIVE_ESIGN_CONSENT_VERSION,
  EsignConsentService,
} from './esign-consent.service';

describe('EsignConsentService', () => {
  const service = new EsignConsentService();

  it('固定單一繁體中文告知的 text/version/hash', () => {
    expect(service.getActive()).toEqual({
      version: 'esign-consent-v1',
      text: ACTIVE_ESIGN_CONSENT_TEXT,
      sha256:
        'd05daf1d414313a16dc7828b00be0121d29e74c45b6d837449d8c9bc445c569d',
    });
    expect(ACTIVE_ESIGN_CONSENT_TEXT).toMatch(/[\u3400-\u9fff]/u);
    expect(EsignConsentService.calculateSha256(ACTIVE_ESIGN_CONSENT_TEXT)).toBe(
      ACTIVE_ESIGN_CONSENT_SHA256,
    );
    expect(ACTIVE_ESIGN_CONSENT_VERSION).toBe('esign-consent-v1');
  });

  it('只接受目前版本與明確 accepted=true', () => {
    expect(service.assertAccepted(ACTIVE_ESIGN_CONSENT_VERSION, true)).toEqual(
      service.getActive(),
    );
    expect(() => service.assertAccepted('old-version', true)).toThrow(
      '請閱讀並接受',
    );
    expect(() =>
      service.assertAccepted(ACTIVE_ESIGN_CONSENT_VERSION, false),
    ).toThrow('請閱讀並接受');
  });
});
