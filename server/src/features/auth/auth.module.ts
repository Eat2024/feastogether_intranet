import { ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { seconds, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis } from 'ioredis';
import { RedisModule } from '#app/infrastructure/database/redis/redis.module';
import { REDIS_MAIN } from '#app/infrastructure/database/redis/redis.provider';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { FeastogetherModule } from '#app/infrastructure/http-client/feastogether/feastogether.module';
import { AuthGuard } from '#app/framework/guards/auth.guard';
import { AuthThrottlerGuard } from '#app/framework/guards/auth-throttler.guard';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import {
  AUTH_RATE_LIMIT_LONG_LIMIT,
  AUTH_RATE_LIMIT_LONG_NAME,
  AUTH_RATE_LIMIT_LONG_TTL_SECONDS,
  AUTH_RATE_LIMIT_SHORT_LIMIT,
  AUTH_RATE_LIMIT_SHORT_NAME,
  AUTH_RATE_LIMIT_SHORT_TTL_SECONDS,
} from './auth.constants';
import { AuthController } from './controllers/auth.controller';
import { RoleController } from './controllers/role.controller';
import { UserController } from './controllers/user.controller';
import { ApiRegistryRepository } from './repositories/api-registry.repository';
import { AuditLogRepository } from './repositories/audit-log.repository';
import { PermissionRepository } from './repositories/permission.repository';
import { RoleUserRepository } from './repositories/role-user.repository';
import { RoleRepository } from './repositories/role.repository';
import { UserAccountRepository } from './repositories/user-account.repository';
import { ApiRegistryService } from './services/api-registry.service';
import { AuditLogService } from './services/audit-log.service';
import { AuthService } from './services/auth.service';
import { AuthLogoutService } from './services/auth-logout.service';
import { DevLoginService } from './services/dev-login.service';
import { AuthSessionService } from './services/auth-session.service';
import { RoleService } from './services/role.service';
import { UserAccountService } from './services/user-account.service';
import { AuthSessionVerifierService } from './services/auth-session-verifier.service';
import { ApiAuthorizationService } from './services/api-authorization.service';
import { AuthorizationCacheService } from './services/authorization-cache.service';

/**
 * Auth feature 模組：JWT session + 全域 AuthGuard、RBAC（角色/權限層級、稽核、
 * API registry 開機同步）。OAuth 程式碼目前保留但不註冊，由 DEVMOD 提供開發者登入。
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    RedisModule,
    MysqlModule,
    DiscoveryModule,
    FeastogetherModule,
    // 032 速率限制：此處只提供視窗設定與 Redis 計數儲存，實際套用由認證端點的
    // @UseGuards(AuthThrottlerGuard) 決定——MUST NOT 註冊為全域 guard。
    // 計數存 Redis（非 process 記憶體）以在重啟後保留；重用既有 REDIS_MAIN 連線，
    // ThrottlerStorageRedisService 只會關閉自建的 client，不影響 session 讀寫。
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
  controllers: [
    AuthController,
    RoleController,
    UserController,
  ],
  providers: [
    AuthGuard,
    AuthThrottlerGuard,
    OriginGuard,
    AuthService,
    AuthSessionService,
    AuthLogoutService,
    DevLoginService,
    ApiRegistryRepository,
    AuditLogRepository,
    PermissionRepository,
    RoleRepository,
    RoleUserRepository,
    UserAccountRepository,
    ApiRegistryService,
    RoleService,
    UserAccountService,
    AuditLogService,
    AuthSessionVerifierService,
    ApiAuthorizationService,
    AuthorizationCacheService,
  ],
  // AuthGuard 由 bootstrap 取出做全域 guard。
  exports: [AuthGuard, AuthSessionVerifierService, ApiAuthorizationService],
})
export class AuthModule {}
