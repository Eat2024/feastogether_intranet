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
import { ApiExcludeController } from '@nestjs/swagger';
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

/**
 * 隱藏維護入口。入口值只出現在路徑參數，由 SuperUserEntryGuard 最先比對（早於 Origin、限流與 DTO 驗證），
 * 無效／舊入口一律回與不存在路由相同的 404；access log 與 guard log 只記路由模板。
 * 不列入 Swagger：不知道入口的人不能從 API 文件看出這組路由。
 */
@ApiExcludeController()
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
  getEntry(): { available: true } {
    return { available: true };
  }

  /**
   * guard 依序執行：入口有效後才檢查 Origin 與限流，錯誤入口不會因缺 Origin 或連續嘗試而回 403／429。
   * 入口是 32 bytes 隨機值，不靠限流擋猜測；限流保護的是有效入口上的帳密嘗試。
   */
  @Public()
  @UseGuards(SuperUserEntryGuard, OriginGuard, SuperUserThrottlerGuard)
  @Post(':entryKey/sessions')
  @Header('Cache-Control', 'no-store')
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
