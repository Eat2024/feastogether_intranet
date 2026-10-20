import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';

/** 驗證碼自寄出起的有效秒數（10 分鐘）。 */
export const OTP_TTL_SECONDS = 10 * 60;
/** 同一驗證碼可輸入的次數，錯滿即失效。 */
export const OTP_MAX_ATTEMPTS = 5;

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
 * 每位簽署人同時只有一個有效驗證碼；重新寄出即覆寫並重設次數。
 */
@Injectable()
export class ExternalOtpService {
  constructor(private readonly redis: RedisService) {}

  isCodeFormat(code: string): boolean {
    return /^[0-9]{6}$/.test(code);
  }

  /** 產生新驗證碼交給 deliver 寄出；寄出成功才保存（舊驗證碼隨即失效），寄送失敗不保留。 */
  async issue(
    signerId: number,
    deliver: (code: string) => Promise<void>,
  ): Promise<void> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await deliver(code);
    await this.redis.set(
      codeKey(signerId),
      codeHash(signerId, code),
      OTP_TTL_SECONDS,
    );
    await this.redis.del(attemptsKey(signerId));
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
}

function codeKey(signerId: number): string {
  return `esign:external-otp:${signerId}:code`;
}

function attemptsKey(signerId: number): string {
  return `esign:external-otp:${signerId}:attempts`;
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
