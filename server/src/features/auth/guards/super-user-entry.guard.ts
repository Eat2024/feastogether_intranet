import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { SuperUserLoginService } from '../services/super-user-login.service';

/**
 * client 的 proxy（client/src/proxy.ts）判定來源網路不在允許清單時加上的 header。
 * 網路判斷只在 proxy；這裡只把結果轉成與不存在路由相同的 404（proxy 自己改寫或回應都會與後端的 404 不同）。
 * client 自帶這個 header 只會讓自己的請求 404，不會放行任何東西。
 */
export const ENTRY_NETWORK_DENIED_HEADER = 'x-entry-network-denied';

/**
 * 位置預檢放在 guard：Nest 在 pipe 之前執行 guard，無效入口因此先回統一 404，
 * 只有有效入口才進入 DTO 帳密驗證。
 */
@Injectable()
export class SuperUserEntryGuard implements CanActivate {
  constructor(private readonly superUserLogin: SuperUserLoginService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { headers, params } = context
      .switchToHttp()
      .getRequest<FastifyRequest<{ Params: { entryKey: string } }>>();
    if (headers[ENTRY_NETWORK_DENIED_HEADER] !== undefined) {
      throw new AppException(...AppErrors.HTTP_NOT_FOUND);
    }
    await this.superUserLogin.assertEntry(params.entryKey);
    return true;
  }
}
