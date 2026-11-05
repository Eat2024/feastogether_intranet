import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RouteConfig } from '@nestjs/platform-fastify';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import configPath from '#app/config/config.path';
import { Public } from '#app/framework/decorators/public.decorator';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { SuperUserThrottlerGuard } from '#app/framework/guards/super-user-throttler.guard';
import { AUTH_COOKIE_NAME } from '../auth.constants';
import { SuperUserLoginDto } from '../dto/super-user-login.dto';
import {
  toSuperUserSessionView,
  type SuperUserSessionView,
} from '../dto/session-view.dto';
import { SuperUserEntryGuard } from '../guards/super-user-entry.guard';
import { setAuthCookie } from '../helpers/auth-cookie';
import { SuperUserLoginService } from '../services/super-user-login.service';

/** 登入 body 上限 8 KiB：帳號 128 字元＋密碼 1024 bytes 遠小於此。 */
const LOGIN_BODY_LIMIT_BYTES = 8 * 1024;

/**
 * 隱藏維護入口。入口值只出現在路徑參數，由 SuperUserEntryGuard 在 DTO 驗證前比對，
 * 無效／舊入口一律 404；access log 與 guard log 只記路由模板。
 */
@ApiTags('auth')
@Controller(configPath.AUTH_SUPER_USER_ENTRIES)
export class SuperUserAccessController {
  constructor(
    private readonly superUserLogin: SuperUserLoginService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @UseGuards(SuperUserEntryGuard)
  @Get(':entryKey')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '確認維護入口目前有效（不寫 DB、不設 cookie）' })
  getEntry(): { available: true } {
    return { available: true };
  }

  @Public()
  @UseGuards(OriginGuard, SuperUserThrottlerGuard, SuperUserEntryGuard)
  @RouteConfig({ bodyLimit: LOGIN_BODY_LIMIT_BYTES })
  @Post(':entryKey/sessions')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '以 Super user 帳密建立會話並替換目前會話' })
  async createSession(
    @Param('entryKey') entryKey: string,
    @Body() dto: SuperUserLoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SuperUserSessionView> {
    const issued = await this.superUserLogin.login(
      entryKey,
      dto,
      cookieTokenFromMap(request.cookies, AUTH_COOKIE_NAME),
    );
    // 交易 commit 後才設定 cookie；失敗時不清除原 cookie。
    setAuthCookie(reply, this.config, issued.token);
    return toSuperUserSessionView(issued.expiresAt);
  }
}
