import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SuperUserLoginService } from '../services/super-user-login.service';

/**
 * 位置預檢放在 guard：Nest 在 pipe 之前執行 guard，無效入口因此先回統一 404，
 * 只有有效入口才進入 DTO 帳密驗證。
 */
@Injectable()
export class SuperUserEntryGuard implements CanActivate {
  constructor(private readonly superUserLogin: SuperUserLoginService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { params } = context
      .switchToHttp()
      .getRequest<FastifyRequest<{ Params: { entryKey: string } }>>();
    await this.superUserLogin.assertEntry(params.entryKey);
    return true;
  }
}
