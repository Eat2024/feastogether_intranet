import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { AppException } from '#app/common/errors/app.exception';

export const ACTIVE_ESIGN_CONSENT_VERSION = 'esign-consent-v1';
export const ACTIVE_ESIGN_CONSENT_TEXT =
  '本人已閱讀並了解本文件內容，並同意以電子形式進行簽署。本人確認畫面中的手寫簽名代表本人對本文件內容的簽署意思表示。';
export const ACTIVE_ESIGN_CONSENT_SHA256 =
  'd05daf1d414313a16dc7828b00be0121d29e74c45b6d837449d8c9bc445c569d';

export interface EsignConsent {
  version: string;
  text: string;
  sha256: string;
}

@Injectable()
export class EsignConsentService {
  getActive(): EsignConsent {
    return {
      version: ACTIVE_ESIGN_CONSENT_VERSION,
      text: ACTIVE_ESIGN_CONSENT_TEXT,
      sha256: ACTIVE_ESIGN_CONSENT_SHA256,
    };
  }

  assertAccepted(version: string, accepted: boolean): EsignConsent {
    const active = this.getActive();
    if (!accepted || version !== active.version) {
      throw new AppException(
        AppErrorCode.INVALID_REQUEST,
        '請閱讀並接受目前的電子簽署告知',
        HttpStatus.BAD_REQUEST,
      );
    }
    return active;
  }

  static calculateSha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }
}
