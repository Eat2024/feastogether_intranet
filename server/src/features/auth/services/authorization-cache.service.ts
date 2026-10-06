import { Injectable } from '@nestjs/common';
import { RedisService } from '#app/infrastructure/database/redis/redis.service';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';
import { AUTHORIZATION_CACHE_TTL_SECONDS } from '../auth.constants';

export interface AuthorizationSnapshot {
  userId: number;
  roleId: number | null;
  userActive: boolean;
  roleActive: boolean;
  isAdmin: boolean;
  permissions: string[];
}

@Injectable()
export class AuthorizationCacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly appLogger: AppLoggerService,
  ) {}

  async get(userId: number): Promise<AuthorizationSnapshot | null> {
    const value = await this.redis.get(userKey(userId));
    if (value === null) return null;

    const snapshot = parseAuthSnapshot(value);
    if (snapshot === null || snapshot.userId !== userId) {
      this.appLogger.warn({
        context: 'AuthorizationCacheService',
        event: 'authz.cache_invalid',
        message: 'Authorization cache snapshot failed validation',
        metadata: { userId },
      });
      return null;
    }

    return snapshot;
  }

  create(snapshot: AuthorizationSnapshot): Promise<void> {
    return this.redis.set(
      userKey(snapshot.userId),
      snapshot,
      AUTHORIZATION_CACHE_TTL_SECONDS,
    );
  }

  update(snapshot: AuthorizationSnapshot): Promise<boolean> {
    return this.redis.update(userKey(snapshot.userId), snapshot);
  }
}

function userKey(userId: number): string {
  return `authz:user:${userId}`;
}

function parseAuthSnapshot(serialized: string): AuthorizationSnapshot | null {
  try {
    return JSON.parse(serialized) as AuthorizationSnapshot;
  } catch {
    return null;
  }
}
