import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** 僅用於受 AuthGuard 保護的端點；ID 有效性由 Guard 保證。 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): number => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: { id: string } }>();
    return Number(request.user.id);
  },
);
