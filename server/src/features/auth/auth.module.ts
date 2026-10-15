import { seconds, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis } from 'ioredis';
import { RedisModule } from '#app/infrastructure/database/redis/redis.module';
import { REDIS_MAIN } from '#app/infrastructure/database/redis/redis.provider';
import { OauthModule } from '#app/infrastructure/http-client/oauth/oauth.module';
import { AuthThrottlerGuard } from '#app/framework/guards/auth-throttler.guard';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { OauthController } from './controllers/oauth.controller';
import { OauthLoginService } from './services/oauth-login.service';
import { OauthIdentityService } from './services/oauth-identity.service';
import { OauthTransactionService } from './services/oauth-transaction.service';
import {
  AUTH_RATE_LIMIT_SHORT_NAME,
  AUTH_RATE_LIMIT_SHORT_LIMIT,
  AUTH_RATE_LIMIT_SHORT_TTL_SECONDS,
  AUTH_RATE_LIMIT_LONG_NAME,
  AUTH_RATE_LIMIT_LONG_LIMIT,
  AUTH_RATE_LIMIT_LONG_TTL_SECONDS,
} from './auth.constants';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '#app/framework/guards/auth.guard';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { FeastogetherModule } from '#app/infrastructure/http-client/feastogether/feastogether.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';

/** WebView SSO 與 OAuth 統一登入共用 MySQL 員工 session。 */
@Module({
  imports: [
    MysqlModule,
    FeastogetherModule,
    OauthModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_MAIN],
      useFactory: (redis: Redis) => ({
        storage: new ThrottlerStorageRedisService(redis),
        throttlers: [
          {
            name: AUTH_RATE_LIMIT_SHORT_NAME,
            limit: AUTH_RATE_LIMIT_SHORT_LIMIT,
            ttl: seconds(AUTH_RATE_LIMIT_SHORT_TTL_SECONDS),
          },
          {
            name: AUTH_RATE_LIMIT_LONG_NAME,
            limit: AUTH_RATE_LIMIT_LONG_LIMIT,
            ttl: seconds(AUTH_RATE_LIMIT_LONG_TTL_SECONDS),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController, OauthController],
  providers: [
    AuthService,
    OauthLoginService,
    OauthIdentityService,
    OauthTransactionService,
    AuthThrottlerGuard,
    OriginGuard,
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
