// auth-mode.ts
import type { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '#app/config/app.environment';

// ── 開發者登入（DEVMOD）──
// 本機沒有統一登入可串接時，.env 設 DEVMOD=true 即可在登入頁以「開發者登入」直接取得
// 超級管理員 session。等同免密碼取得最高權限，故在已部署環境（production / staging）
// 一律不開放；誤設時開機即失敗（assertDevModeSafe），不靜默忽略。

/** 是否開放開發者登入（DEVMOD=true 且非 production / staging）。 */
export function isDevLoginAllowed(config: ConfigService): boolean {
  return isDevModeOn(config) && !isDeployedEnvironment(config);
}

/** 已部署環境卻設 DEVMOD=true → 丟錯讓應用啟動失敗。 */
export function assertDevModeSafe(config: ConfigService): void {
  if (isDevModeOn(config) && isDeployedEnvironment(config)) {
    throw new Error(
      'DEVMOD=true 不可用於 production / staging（開發者登入會簽發超級管理員 session）',
    );
  }
}

function isDevModeOn(config: ConfigService): boolean {
  return config.get<string>('DEVMOD') === 'true';
}

function isDeployedEnvironment(config: ConfigService): boolean {
  const env = config.get<string>('NODE_ENV');
  return env === AppEnvironment.Production || env === AppEnvironment.Staging;
}
