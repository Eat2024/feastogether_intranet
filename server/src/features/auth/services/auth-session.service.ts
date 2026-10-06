import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import {
  AUTH_TOKEN_TTL_SECONDS,
  SESSION_SOURCE,
  type SessionSource,
} from '#app/features/auth/auth.constants';
import { isDevLoginAllowed } from '#app/framework/auth-mode';

/**
 * Redis session 值的目前版本。v3 起不再有帳密／本地管理員登入；更舊的版本
 * 一律視為無效 session，使用者需重新登入。
 */
const SESSION_VERSION = 3;

/**
 * 本地 session 內容（存 Redis `auth:<userId>:<jwt>`）。
 * - oauth：帶加密後的上游 refresh token，主動登出呼叫上游 /logout 用（不自動續期）。
 * - dev：DEVMOD 開發者登入，沒有上游 token。
 */
export interface AuthSessionRecord {
  source: SessionSource;
  encryptedRefreshToken: string | null;
}

interface StoredSession extends AuthSessionRecord {
  version: number;
}

/** 解析 Redis session 值；非目前版本或格式錯誤回 null（視為無效 session）。 */
export function parseSessionRecord(
  raw: string | null,
): AuthSessionRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Partial<StoredSession>;
  if (value.version !== SESSION_VERSION) return null;
  return {
    // 未帶 source 的 v3 值是加入開發者登入前簽發的統一登入 session。
    source:
      value.source === SESSION_SOURCE.DEV
        ? SESSION_SOURCE.DEV
        : SESSION_SOURCE.OAUTH,
    encryptedRefreshToken: stringOrNull(value.encryptedRefreshToken),
  };
}

/** 開發者登入的 session 只在 DEVMOD 仍開放時有效；關掉 DEVMOD 即全部失效。 */
export function isSessionUsable(
  record: AuthSessionRecord | null,
  config: ConfigService,
): record is AuthSessionRecord {
  if (!record) return false;
  return record.source !== SESSION_SOURCE.DEV || isDevLoginAllowed(config);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Redis session key；AuthGuard／verifier／登出共用同一格式。 */
export function sessionKey(userId: number | string, token: string): string {
  return `auth:${userId}:${token}`;
}

/**
 * 本地 session 的簽發／讀取／撤銷。
 * JWT 的 sub 維持本地 user.id（不是 OAuth sub）；jti 隨機，避免同秒同人登入產生相同 token。
 * TTL 固定 24 小時、不滑動（FR-015）。
 */
@Injectable()
export class AuthSessionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** 簽 JWT 並寫入 Redis；Redis 失敗即拋出，不得只回 JWT 當作登入成功。 */
  async issue(userId: number, record: AuthSessionRecord): Promise<string> {
    const token = await this.jwt.signAsync(
      { sub: String(userId), jti: randomUUID() },
      { expiresIn: AUTH_TOKEN_TTL_SECONDS },
    );
    const stored: StoredSession = { version: SESSION_VERSION, ...record };
    await this.redis.set(
      sessionKey(userId, token),
      JSON.stringify(stored),
      AUTH_TOKEN_TTL_SECONDS,
    );
    return token;
  }

  /** 讀取 session 內容；不存在／已撤銷／格式無效／DEVMOD 已關的開發者 session 回 null。 */
  async read(userId: number, token: string): Promise<AuthSessionRecord | null> {
    const record = parseSessionRecord(
      await this.redis.get(sessionKey(userId, token)),
    );
    return isSessionUsable(record, this.config) ? record : null;
  }

  /**
   * 原子取出並刪除 session（GETDEL）：並發登出只會有一個呼叫者拿到 refresh token，
   * 上游 /logout 不會被重複呼叫。不存在回 null（冪等）。
   */
  async revoke(
    userId: number,
    token: string,
  ): Promise<AuthSessionRecord | null> {
    return parseSessionRecord(
      await this.redis.getDel(sessionKey(userId, token)),
    );
  }
}
