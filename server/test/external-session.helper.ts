import request from 'supertest';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import type { FakeInvitationMailSender } from '#app/infrastructure/mail/fake-invitation-mail-sender.service';
import {
  INVITATION_MAIL_SENDER,
  type SendOtpMailInput,
} from '#app/infrastructure/mail/invitation-mail-sender.port';
import type { SecurityE2eContext } from './security-e2e.helper';
import { randomClientIp } from './signature-verification.helper';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';

/**
 * 外部簽署人開啟文件的兩個表單端點都依 client IP 限流，計數存 Redis 且跨測試回合存活；
 * 每次請求換一個 client IP（app 以 trustProxy=1 解析 X-Forwarded-For），避免互相消耗額度。
 */
function externalForm(
  ctx: SecurityE2eContext,
  path: string,
  form: Record<string, string>,
) {
  return request(ctx.server)
    .post(path)
    .set('Origin', 'http://localhost:3000')
    .set('X-Forwarded-For', randomClientIp())
    .type('form')
    .send(form);
}

/** 邀請確認頁按下「開啟電子簽署文件」：驗證邀請並寄出驗證碼 */
export function requestOtp(ctx: SecurityE2eContext, token: string) {
  return externalForm(ctx, '/api/external-signature-otps', { token });
}

/** 驗證碼輸入頁送出：驗證成功才建立存取 */
export function submitOtp(
  ctx: SecurityE2eContext,
  token: string,
  code: string,
) {
  return externalForm(ctx, '/api/external-signature-session', { token, code });
}

/** test 環境的 fake mailer 攔截到的驗證碼信（不寄出真實信件） */
export function otpMails(ctx: SecurityE2eContext): SendOtpMailInput[] {
  return ctx.app.get<FakeInvitationMailSender>(INVITATION_MAIL_SENDER)
    .otpDeliveries;
}

/**
 * fake timers 推不動 Redis 的 TTL：清除所有簽署人的重新寄送冷卻與每小時寄送計數，
 * 模擬距上次寄送已超過 1 小時。
 */
export async function clearOtpResendLimits(
  ctx: SecurityE2eContext,
): Promise<void> {
  const redis = ctx.app.get(RedisService);
  await redis.deleteByPattern('esign:external-otp:*:cooldown');
  await redis.deleteByPattern('esign:external-otp:*:hourly');
}

/** 寄出驗證碼、自 fake mailer 取碼並驗證，回傳外部存取 cookie；同一邀請可重複開啟，不受重新寄送限制 */
export async function openExternalSession(
  ctx: SecurityE2eContext,
  token: string,
): Promise<string> {
  await clearOtpResendLimits(ctx);
  await requestOtp(ctx, token).expect(200);
  const { code } = otpMails(ctx).at(-1)!;
  const session = await submitOtp(ctx, token, code).expect(303);
  const raw: unknown = session.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? (raw[0] as unknown) : raw;
  if (typeof cookie !== 'string') throw new Error('缺少外部存取 cookie');
  return cookie;
}

/** 合成內部指派 fixture：直接核發有效員工 session，不建立 Email OTP 或外部存取。 */
export async function openInternalEmployeeSession(
  ctx: SecurityE2eContext,
  signerPublicId: string,
): Promise<string> {
  const signer = await ctx.app
    .get(SignerRepository)
    .findByPublicId(signerPublicId, ctx.app.get(MysqlService).getManager());
  if (signer?.signerType !== 'user' || !signer.userId)
    throw new Error('合成指派不是內部員工');
  const session = await ctx.app.get(AuthService).issueSession(signer.userId);
  return `${AUTH_COOKIE_NAME}=${session.token}`;
}
