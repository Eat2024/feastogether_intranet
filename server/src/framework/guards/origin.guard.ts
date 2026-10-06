import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { AppException } from '#app/common/errors/app.exception';
import { AppErrorCode } from '#app/common/errors/app-error-code';

/**
 * 跨站請求防護：以 cookie 認證的異動端點（登入／登出等）可加掛本 guard。
 *
 * 瀏覽器對跨站 POST 一律附 `Origin`；有帶就必須 exact-match 允許清單，不符即 403。
 * 允許清單讀 `AUTH_TRUSTED_ORIGINS`（逗號分隔），未設時退回 `CORS_ORIGIN`。
 * 兩者皆空即拒絕所有帶 Origin 的請求（fail closed）。
 * 未帶 Origin 的請求（同站 GET 導航、非瀏覽器工具）放行——主要防線仍是
 * SameSite=Lax cookie，本 guard 是縱深防禦而非唯一依據。
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    if (this.allowedOrigins().includes(origin)) return true;
    throw new AppException(
      AppErrorCode.CSRF_ORIGIN_REJECTED,
      '請求來源不允許',
      HttpStatus.FORBIDDEN,
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
