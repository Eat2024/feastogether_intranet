import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { isSessionUsable, parseSessionRecord } from './auth-session.service';

interface JwtPayload {
  sub: string;
}

export interface VerifiedSession {
  userId: number;
}

export interface VerifiedIdentity extends VerifiedSession {
  token: string;
}

@Injectable()
export class AuthSessionVerifierService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly appLogger: AppLoggerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 撤銷某 user 的所有 session（刪 `auth:<userId>:*`）。
   * 034 SEC-06：管理者停用帳號後，其既有 token 須立即失效，不得殘留至 24h 到期
   * （不依賴每個端點各自重查 isActive——縱深防禦）。
   */
  async revokeAllSessions(userId: number): Promise<number> {
    return this.redisService.deleteByPattern(`auth:${userId}:*`);
  }

  async verify(token: string): Promise<VerifiedSession | null> {
    const verified = await this.verifyToken(token);
    if (!verified) return null;
    try {
      const session = await this.redisService.get(
        `auth:${verified.userId}:${token}`,
      );
      // 只認目前格式的 session；已移除的登入方式留下的舊 session、
      // 以及 DEVMOD 已關閉時的開發者 session 一律無效。
      return isSessionUsable(parseSessionRecord(session), this.config)
        ? verified
        : null;
    } catch (error) {
      this.appLogger.warn({
        context: AuthSessionVerifierService.name,
        event: 'auth.session_lookup_failed',
        message: 'Redis session lookup failed',
        metadata: {
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  async verifySessionToken(
    token: string | null | undefined,
  ): Promise<VerifiedIdentity | null> {
    if (!token) return null;
    const session = await this.verify(token);
    return session ? { ...session, token } : null;
  }

  async verifyToken(token: string): Promise<VerifiedSession | null> {
    const payload = await this.verifyJwt(token);
    if (!payload) return null;
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId < 1) return null;
    return { userId };
  }

  private async verifyJwt(token: string): Promise<JwtPayload | null> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch (error) {
      this.appLogger.warn({
        context: AuthSessionVerifierService.name,
        event: 'auth.jwt_verify_failed',
        message: 'JWT verify failed',
        metadata: {
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }
}
