import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import configPath from '#app/config/config.path';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import { API_KEYS } from '#app/features/auth/api-keys';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import { Public } from '#app/framework/decorators/public.decorator';
import { isDevLoginAllowed } from '#app/framework/auth-mode';
import { AuthThrottlerGuard } from '#app/framework/guards/auth-throttler.guard';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import { RegisterApi } from '#app/framework/decorators/register-api.decorator';
import {
  clearAuthCookie,
  clearOauthTxCookie,
  setAuthCookie,
} from '#app/features/auth/helpers/auth-cookie';
import { AuthService } from '#app/features/auth/services/auth.service';
import { AuthLogoutService } from '#app/features/auth/services/auth-logout.service';
import { DevLoginService } from '#app/features/auth/services/dev-login.service';

/** AuthGuard 通過後 req.user.id（JWT sub）；cookies 由 @fastify/cookie 注入。 */
type AuthedRequest = FastifyRequest & { user?: { id: string } };

/** 認證 API：登入入口、開發者登入（DEVMOD）、登出與登入者資料。 */
@ApiTags('auth')
@Controller(configPath.AUTH)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly logoutService: AuthLogoutService,
    private readonly devLoginService: DevLoginService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get(configPath.AUTH_LOGIN_OPTIONS)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      '登入頁可用入口（OAuth 目前停用；devLogin：DEVMOD 開發者登入）',
  })
  loginOptions() {
    return {
      oauth: false,
      devLogin: isDevLoginAllowed(this.config),
    };
  }

  /** DEVMOD 開發者登入：未開放時回 404（見 DevLoginService）。 */
  @Public()
  @UseGuards(OriginGuard, AuthThrottlerGuard)
  @Post(configPath.AUTH_DEV_LOGIN)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      '開發者登入（僅 DEVMOD=true 且非 production / staging；以超級管理員登入）',
  })
  async devLogin(@Res({ passthrough: true }) reply: FastifyReply) {
    const { accessToken, session } = await this.devLoginService.login();
    setAuthCookie(reply, this.config, accessToken);
    return session;
  }

  /**
   * 登出改為 Public＋Origin 防護（038）：過期／已撤銷的使用者也要能清 cookie 回登入頁，
   * 不能被「需有效登入」擋成無法登出。只撤 cookie 所屬的 session，不接受 body 指定。
   */
  @Public()
  @UseGuards(OriginGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登出（撤銷本機 session）' })
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = cookieTokenFromMap(req.cookies, AUTH_COOKIE_NAME);
    // 先清 cookie：即使本地撤銷失敗回 503，瀏覽器仍能退出（但回應不宣稱憑證已失效）。
    clearAuthCookie(reply);
    clearOauthTxCookie(reply);
    return this.logoutService.logout(token);
  }

  @Get('me')
  @RegisterApi({ key: API_KEYS.AUTH_ME, name: '登入者導覽', permissions: [] })
  @ApiOperation({
    summary: '取得目前登入者資料、角色與導覽',
  })
  me(@Req() req: AuthedRequest) {
    return this.authService.getMe(
      Number(req.user?.id),
      cookieTokenFromMap(req.cookies, AUTH_COOKIE_NAME),
    );
  }
}
