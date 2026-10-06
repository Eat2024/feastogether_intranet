import { createHash, randomBytes } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';
import { OAUTH_TX_TTL_SECONDS } from '#app/features/auth/auth.constants';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import type { OauthLoginChallenge } from '#app/infrastructure/http-client/oauth/oauth.client';

/** 交易記錄（存 Redis）；state 與瀏覽器綁定一起決定 key，值只放秘密與返回位置。 */
interface StoredTransaction {
  nonce: string;
  redirectTo: string;
}

/** 回呼領取到的交易內容。 */
export interface ClaimedTransaction {
  challenge: OauthLoginChallenge;
  redirectTo: string;
}

/**
 * OAuth 登入交易（FR-003）：短效、一次性、綁定發起瀏覽器。
 *
 * key = `oauth:tx:<sha256(browserToken)>:<state>`：
 * - browserToken 只放在發起瀏覽器的 HttpOnly cookie；Redis 只存其摘要。
 * - 回呼以 GETDEL 領取：多分頁／重放只有一個成功；換瀏覽器或缺 cookie 對到不同 key，
 *   既不會領到、也不會消耗別人的交易。
 * - Redis 故障一律 fail closed（503），不改用程序內記憶體備援。
 */
@Injectable()
export class OauthTransactionService {
  constructor(private readonly redis: RedisService) {}

  /** 存交易並回傳要寫入瀏覽器 cookie 的綁定值。 */
  async start(
    challenge: OauthLoginChallenge,
    redirectTo: string,
  ): Promise<string> {
    const browserToken = randomBytes(32).toString('base64url');
    const stored: StoredTransaction = {
      nonce: challenge.nonce,
      redirectTo,
    };
    await this.withRedisSetting(() =>
      this.redis.set(
        transactionKey(browserToken, challenge.state),
        JSON.stringify(stored),
        OAUTH_TX_TTL_SECONDS,
      ),
    );
    return browserToken;
  }

  /** 一次性領取；不存在、到期、已消耗、瀏覽器不符皆 OAUTH_TRANSACTION_INVALID(400)。 */
  async claim(
    state: string,
    browserToken: string | null | undefined,
  ): Promise<ClaimedTransaction> {
    if (!browserToken) throw this.invalid();
    const raw = await this.withRedisSetting(() =>
      this.redis.getDel(transactionKey(browserToken, state)),
    );
    const stored = parseStored(raw);
    if (!stored) throw this.invalid();
    return {
      challenge: { state, nonce: stored.nonce },
      redirectTo: stored.redirectTo,
    };
  }

  private async withRedisSetting<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch {
      throw new AppException(
        AppErrorCode.OAUTH_UNAVAILABLE,
        '登入服務暫時無法使用，請稍後再試',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private invalid(): AppException {
    return new AppException(
      AppErrorCode.OAUTH_TRANSACTION_INVALID,
      '登入交易無效或已過期，請重新發起登入',
      HttpStatus.BAD_REQUEST,
    );
  }
}

function transactionKey(browserToken: string, state: string): string {
  const browserHash = createHash('sha256').update(browserToken).digest('hex');
  return `oauth:tx:${browserHash}:${state}`;
}

function parseStored(raw: string | null): StoredTransaction | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredTransaction>;
    if (
      typeof value.nonce !== 'string' ||
      typeof value.redirectTo !== 'string'
    ) {
      return null;
    }
    return { nonce: value.nonce, redirectTo: value.redirectTo };
  } catch {
    return null;
  }
}
