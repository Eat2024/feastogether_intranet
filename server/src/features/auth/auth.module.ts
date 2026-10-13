import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '#app/framework/guards/auth.guard';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { FeastogetherModule } from '#app/infrastructure/http-client/feastogether/feastogether.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';

/** 正式 runtime：WebView SSO endpoints 與全域 MySQL 員工 session guard。 */
@Module({
  imports: [MysqlModule, FeastogetherModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
