import { AppErrors } from '#app/common/errors/app-errors';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { AppException } from '#app/common/errors/app.exception';
import { getRequestPath } from '#app/framework/http/request.context';

/**
 * 跨站請求防護：以 cookie 認證的異動端點（登入／登出等）可加掛本 guard。
 *
 * 瀏覽器對跨站 POST 一律附 `Origin`；有帶就必須 exact-match 允許清單，不符即 403。
 * 允許清單讀 `AUTH_TRUSTED_ORIGINS`（逗號分隔），未設時退回 `CORS_ORIGIN`。
 * 兩者皆空即拒絕所有帶 Origin 的請求（fail closed）。
 * 未帶 Origin 的請求（同站 GET 導航、非瀏覽器工具）放行。
 * HTTPS 環境的登入 cookie 為 SameSite=None（主平台 iframe 嵌入需要，見 auth-cookie.ts），
 * 跨站請求也會帶上 cookie，因此瀏覽器以 `Sec-Fetch-Site` 標明非同源時一律拒絕——
 * 包含為了 iframe 嵌入而列入允許清單的主平台；電子簽前端呼叫 API 一律同源（/api）。
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
      throw new AppException(...AppErrors.CSRF_ORIGIN_REJECTED);
    }
    const origin = req.headers.origin;
    if (origin === undefined) {
      if (this.requiresExplicitOrigin(req)) {
        throw new AppException(...AppErrors.CSRF_ORIGIN_REJECTED);
      }
      return true;
    }
    if (this.allowedOrigins().includes(origin)) return true;
    // 設定 Referrer-Policy: no-referrer 的同源頁面（外部簽署 bridge）送出表單時，瀏覽器依 Fetch 規範送 Origin: null；
    // 以瀏覽器自動帶上、頁面無法偽造的 Sec-Fetch-Site 確認確實同源。沙箱與跨站 redirect 仍為 cross-site，照常拒絕
    if (origin === 'null' && req.headers['sec-fetch-site'] === 'same-origin') {
      return true;
    }
    throw new AppException(...AppErrors.CSRF_ORIGIN_REJECTED);
  }

  private requiresExplicitOrigin(request: FastifyRequest): boolean {
    const path = getRequestPath(request);
    return (
      path === '/api/auth/login' ||
      path === '/auth/login' ||
      path.startsWith('/api/esign/') ||
      path === '/api/esign' ||
      path.startsWith('/api/external-signature') ||
      path.startsWith('/api/external-signing-task') ||
      path.startsWith('/esign/') ||
      path.startsWith('/external-signature') ||
      path.startsWith('/external-signing-task')
    );
  }

  private allowedOrigins(): string[] {
    const configured =
      this.config.get<string>('AUTH_TRUSTED_ORIGINS') ||
      this.config.get<string>('CORS_ORIGIN') ||
      '';
    return configured
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
}
