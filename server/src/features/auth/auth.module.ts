import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '#app/framework/guards/auth.guard';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { RedisModule } from '#app/infrastructure/database/redis/redis.module';
import { AuthSessionVerifierService } from './services/auth-session-verifier.service';

/**
 * 正式 runtime 只啟用全域員工 session guard。
 * SSO、dev login 與 logout 原始能力保留供獨立 testing module 組合，不在此暴露路由。
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
    MysqlModule,
    RedisModule,
  ],
  providers: [
    AuthSessionVerifierService,
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  exports: [AuthSessionVerifierService],
})
export class AuthModule {}
