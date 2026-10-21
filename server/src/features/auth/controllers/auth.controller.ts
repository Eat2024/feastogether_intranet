import { AppErrors } from '#app/common/errors/app-errors';
import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from '#app/common/errors/app.exception';
import { cookieTokenFromMap } from '#app/common/http/cookie-token.helper';
import configPath from '#app/config/config.path';
import { AUTH_COOKIE_NAME } from '#app/features/auth/auth.constants';
import {
  clearAuthCookie,
  setAuthCookie,
} from '#app/features/auth/helpers/auth-cookie';
import { Public } from '#app/framework/decorators/public.decorator';
import { LoginDto } from '../dto/login.dto';
import { AuthThrottlerGuard } from '#app/framework/guards/auth-throttler.guard';
import { OriginGuard } from '#app/framework/guards/origin.guard';
import {
  EmbedOriginsView,
  WebviewLaunchView,
  WebviewSessionDto,
} from '../dto/webview-launch.dto';
import { AuthService } from '../services/auth.service';

type AuthedRequest = FastifyRequest & { user?: { id: string } };

@ApiTags('auth')
@Controller(configPath.AUTH)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // 以員工編號與密碼驗證身分並建立登入 session。
  @Public()
  @UseGuards(OriginGuard, AuthThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '以員工編號與密碼登入電子簽' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { token, session } = await this.authService.login(
      dto.empId,
      dto.password,
    );
    setAuthCookie(reply, this.config, token);
    return session;
  }

  // 驗證主平台 JWT 並建立一次性 WebView 啟動網址。
  @Public()
  @Post(configPath.AUTH_WEBVIEW_LAUNCHES)
  @Header('Cache-Control', 'no-store')
  @ApiBearerAuth('launchBearer')
  @ApiOperation({ summary: '以主平台 JWT 建立一次性 WebView 啟動網址' })
  @ApiResponse({ status: HttpStatus.CREATED, type: WebviewLaunchView })
  createWebviewLaunch(
    @Req() request: FastifyRequest,
  ): Promise<WebviewLaunchView> {
    const authorization = request.headers.authorization;
    const matched =
      typeof authorization === 'string'
        ? /^Bearer ([^\s]+)$/.exec(authorization)
        : null;
    if (authorization === undefined) {
      throw new AppException(...AppErrors.AUTH_EXCHANGE_FAILED);
    }
    if (!matched) {
      throw new AppException(...AppErrors.REQUEST_FORMAT_INVALID);
    }
    return this.authService.createWebviewLaunch(matched[1]);
  }

  /**
   * 電子簽前端被主平台 iframe 嵌入時，只接受這些 origin 的 postMessage（並只對它們送訊息）。
   * 與 bridge 的 frame-ancestors 同一份清單；origin 不是機密（CSP header 本來就會揭露）。
   */
  @Public()
  @Get(configPath.AUTH_EMBED_ORIGINS)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: '取得可嵌入電子簽並以 postMessage 溝通的主平台 origin',
  })
  @ApiResponse({ status: HttpStatus.OK, type: EmbedOriginsView })
  getEmbedOrigins(): EmbedOriginsView {
    return { origins: this.trustedOrigins() };
  }

  // 回傳 WebView 自動提交頁，不在 GET 階段消耗啟動碼。
  @Public()
  @Get(configPath.AUTH_WEBVIEW)
  @ApiOperation({ summary: '取得唯讀 WebView 自動提交頁' })
  getWebviewBridge(@Query() query: unknown, @Res() reply: FastifyReply): void {
    this.setBridgeHeaders(reply);
    const code = this.credentialFromObject(query);
    if (!code) {
      reply
        .status(AppErrors.AUTH_LAUNCH_FORMAT_INVALID[2])
        .type('text/html; charset=utf-8')
        .send(this.errorPage(AppErrors.AUTH_LAUNCH_FORMAT_INVALID[1]));
      return;
    }
    const nonce = randomBytes(18).toString('base64');
    reply.header(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors ${this.frameAncestors()}`,
    );
    reply
      .status(HttpStatus.OK)
      .type('text/html; charset=utf-8')
      .send(this.renderWebviewBridge(code, nonce));
  }

  // 消耗一次性 WebView 啟動碼並建立員工 session。
  @Public()
  @Post(configPath.AUTH_SESSION)
  @ApiBody({ type: WebviewSessionDto })
  @ApiOperation({ summary: '消耗一次性啟動碼並建立員工 Session' })
  async createSession(
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.setBridgeHeaders(reply);
    const code = this.credentialFromObject(body);
    if (!code) {
      reply
        .status(AppErrors.AUTH_LAUNCH_FORMAT_INVALID[2])
        .type('text/html; charset=utf-8')
        .send(this.errorPage(AppErrors.AUTH_LAUNCH_FORMAT_INVALID[1]));
      return;
    }
    try {
      const token = await this.authService.activateWebviewSession(code);
      setAuthCookie(reply, this.config, token);
      reply.redirect('/', HttpStatus.SEE_OTHER);
    } catch (error) {
      const status =
        error instanceof AppException
          ? error.getStatus()
          : AppErrors.AUTH_DB_UNAVAILABLE[2];
      reply
        .status(status)
        .type('text/html; charset=utf-8')
        .send(
          this.errorPage(
            status === Number(AppErrors.AUTH_DB_UNAVAILABLE[2])
              ? AppErrors.AUTH_DB_UNAVAILABLE[1]
              : AppErrors.AUTH_LAUNCH_INVALID[1],
          ),
        );
    }
  }

  // 取得目前登入員工的 session 資訊。
  @Get(configPath.AUTH_SESSION)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('sessionCookie')
  @ApiOperation({ summary: '取得目前電子簽員工 Session' })
  getSession(@Req() request: AuthedRequest) {
    return this.authService.getMe(
      Number(request.user?.id),
      cookieTokenFromMap(request.cookies, AUTH_COOKIE_NAME),
    );
  }

  // 撤銷目前員工 session 並清除登入 cookie。
  @Public()
  @UseGuards(OriginGuard)
  @Delete(configPath.AUTH_SESSION)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '登出並撤銷目前本地 Session' })
  async deleteSession(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = cookieTokenFromMap(request.cookies, AUTH_COOKIE_NAME);
    clearAuthCookie(reply);
    return this.authService.logout(token);
  }

  private credentialFromObject(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length !== 1 || entries[0][0] !== 'code') return null;
    const code = entries[0][1];
    return typeof code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(code)
      ? code
      : null;
  }

  private setBridgeHeaders(reply: FastifyReply): void {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  }

  private renderWebviewBridge(code: string, nonce: string): string {
    return (
      '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>進入電子簽</title></head>' +
      '<body><form id="launch" method="post" action="/api/auth/session">' +
      `<input type="hidden" name="code" value="${code}">` +
      '<button type="submit">電子簽系統啟動</button></form>' +
      `<script nonce="${nonce}">document.getElementById('launch').submit()</script></body></html>`
    );
  }

  private frameAncestors(): string {
    return ["'self'", ...this.trustedOrigins()].join(' ');
  }

  private trustedOrigins(): string[] {
    const configured = this.config.get<string>('AUTH_TRUSTED_ORIGINS') || '';
    return configured ? configured.split(',').map((value) => value.trim()) : [];
  }

  private errorPage(message: string): string {
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>無法進入電子簽</title></head><body><p>${message}</p></body></html>`;
  }
}
