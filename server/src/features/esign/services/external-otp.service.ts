import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';

/** 驗證碼自寄出起的有效秒數（10 分鐘）。 */
export const OTP_TTL_SECONDS = 10 * 60;
/** 同一驗證碼可輸入的次數，錯滿即失效。 */
export const OTP_MAX_ATTEMPTS = 5;
/** 距上次寄送須滿的秒數，才能重新寄送。 */
const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** 同一簽署人自第一次寄送起 1 小時內最多寄送的封數。 */
const OTP_HOURLY_LIMIT = 5;
const OTP_HOURLY_WINDOW_SECONDS = 60 * 60;

/**
 * 寄送結果。sent 的 retryAfterSeconds 為下次可重新寄送前的冷卻秒數；
 * cooldown、hourly-limit 未寄送、現有驗證碼不變，retryAfterSeconds 為可再寄送前需等待的秒數。
 */
export type OtpIssue =
  | {
      status: 'sent' | 'cooldown' | 'hourly-limit';
      retryAfterSeconds: number;
    }
  /** deliver 失敗：未保存驗證碼、不計入冷卻與寄送次數，可立即重試 */
  | { status: 'delivery-failed' };

export type OtpVerification =
  | { status: 'verified' }
  | { status: 'wrong'; remainingAttempts: number }
  /** 本次為第 5 次錯誤，驗證碼已刪除 */
  | { status: 'locked' }
  /** 不存在、已過期、已使用或先前已錯滿 */
  | { status: 'expired' };

/**
 * 外部簽署人開啟文件前的 Email 驗證碼（Spec 008 research §13），只存 Redis：
 * - `esign:external-otp:{signerId}:code`：驗證碼雜湊 sha256(`{signerId}:{code}`)，TTL 10 分鐘；不存明碼。
 * - `esign:external-otp:{signerId}:attempts`：本驗證碼已輸入次數，第一次輸入時設與驗證碼相同的 TTL。
 * - `esign:external-otp:{signerId}:cooldown`：重新寄送冷卻，TTL 60 秒。
 * - `esign:external-otp:{signerId}:hourly`：寄送成功的封數，第一次寄送時設 TTL 1 小時。
 * 每位簽署人同時只有一個有效驗證碼；重新寄出即覆寫並重設次數。
 */
@Injectable()
export class ExternalOtpService {
  constructor(private readonly redis: RedisService) {}

  isCodeFormat(code: string): boolean {
    return /^[0-9]{6}$/.test(code);
  }

  /**
   * 已達每小時上限或冷卻中不寄送；否則產生新驗證碼交給 deliver 寄出，寄出成功才保存（舊驗證碼隨即失效）並計次。
   * 先佔用冷卻再寄送，同一簽署人同時只會寄出一封；寄送失敗釋放冷卻、不計次、不保留驗證碼。
   * 寄送錯誤可能帶回收件內容，不記錄也不往外拋，只回報 delivery-failed。
   */
  async issue(
    signerId: number,
    deliver: (code: string) => Promise<void>,
  ): Promise<OtpIssue> {
    const hourly = hourlyKey(signerId);
    // 本小時尚未寄送時 key 不存在，Number(null) 為 0
    const sentCount = Number(await this.redis.get(hourly));
    if (sentCount >= OTP_HOURLY_LIMIT)
      return {
        status: 'hourly-limit',
        retryAfterSeconds: await this.retryAfter(hourly),
      };
    const cooldown = cooldownKey(signerId);
    const claimed = await this.redis.setIfAbsent(
      cooldown,
      '1',
      OTP_RESEND_COOLDOWN_SECONDS,
    );
    if (!claimed)
      return {
        status: 'cooldown',
        retryAfterSeconds: await this.retryAfter(cooldown),
      };
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await deliver(code);
    } catch {
      await this.redis.del(cooldown);
      return { status: 'delivery-failed' };
    }
    // 寄送成功才存redis
    await this.redis.set(
      codeKey(signerId),
      codeHash(signerId, code),
      OTP_TTL_SECONDS,
    );
    await this.redis.del(attemptsKey(signerId));
    await this.redis.increment(hourly, OTP_HOURLY_WINDOW_SECONDS);
    return { status: 'sent', retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS };
  }

  /**
   * 先計次再比對，同時送出多次也最多比對 5 次；通過後刪除驗證碼，
   * 同一驗證碼同時送出時只有刪除成功的一方通過。
   */
  async verify(signerId: number, code: string): Promise<OtpVerification> {
    const stored = await this.redis.get(codeKey(signerId));
    if (!stored) return { status: 'expired' };
    const attempts = await this.redis.increment(
      attemptsKey(signerId),
      OTP_TTL_SECONDS,
    );
    if (attempts > OTP_MAX_ATTEMPTS) return { status: 'expired' };
    if (sameHash(stored, codeHash(signerId, code))) {
      const consumed = await this.redis.del(codeKey(signerId));
      await this.redis.del(attemptsKey(signerId));
      return consumed === 1 ? { status: 'verified' } : { status: 'expired' };
    }
    if (attempts < OTP_MAX_ATTEMPTS) {
      return {
        status: 'wrong',
        remainingAttempts: OTP_MAX_ATTEMPTS - attempts,
      };
    }
    await this.redis.del(codeKey(signerId), attemptsKey(signerId));
    return { status: 'locked' };
  }

  /** 限制解除前的秒數；key 恰好在檢查後到期時至少回 1 秒。 */
  private async retryAfter(key: string): Promise<number> {
    return Math.max(await this.redis.ttl(key), 1);
  }
}

function codeKey(signerId: number): string {
  return `esign:external-otp:${signerId}:code`;
}

function attemptsKey(signerId: number): string {
  return `esign:external-otp:${signerId}:attempts`;
}

function cooldownKey(signerId: number): string {
  return `esign:external-otp:${signerId}:cooldown`;
}

function hourlyKey(signerId: number): string {
  return `esign:external-otp:${signerId}:hourly`;
}

function codeHash(signerId: number, code: string): string {
  return createHash('sha256').update(`${signerId}:${code}`).digest('hex');
}

function sameHash(stored: string, actual: string): boolean {
  const expected = Buffer.from(stored, 'utf8');
  const received = Buffer.from(actual, 'utf8');
  return (
    expected.byteLength === received.byteLength &&
    timingSafeEqual(expected, received)
  );
}
