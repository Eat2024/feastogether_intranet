import { ClsMiddleware, ClsModule } from 'nestjs-cls';
import type { FastifyRequest } from 'fastify';
import { bindRequestIdToResponse, requestIdFromHeaders } from './request-id';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import {
  CLS_CLIENT_IP,
  CLS_USER_AGENT,
} from '#app/framework/http/request.context';

type RequestWithHeaders = {
  headers: Record<string, string | string[] | undefined>;
};

type ResponseHeaderWriter = Parameters<typeof bindRequestIdToResponse>[1];

/**
 * request id 的 CLS 設定（idGenerator + setup）封裝成單一 DynamicModule。
 * FrameworkModule 與 e2e factory 共用此處，避免兩邊 config drift。
 * 手動用 NestJS 11 支援的 named wildcard 掛載 middleware，避免舊式 `/api/*` 警告。
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: false,
        // 由 x-request-id（驗證/normalize）或新 UUID 產生 request id
        generateId: true,
        idGenerator: (req: RequestWithHeaders) => requestIdFromHeaders(req),
        // 鏡射到 CLS requestId key 並回寫 X-Request-Id；同時擷取 IP/UA 供 RBAC 稽核。
        setup: (cls, req: FastifyRequest, res: ResponseHeaderWriter) => {
          bindRequestIdToResponse(cls, res);
          // trustProxy=1（app.bootstrap），req.ip 取信任代理填的 client IP（不手動讀 XFF，避免偽造）
          cls.set(CLS_CLIENT_IP, req.ip);
          cls.set(CLS_USER_AGENT, req.headers?.['user-agent']);
        },
      },
    }),
  ],
})
export class RequestIdClsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClsMiddleware).forRoutes('{*path}');
  }
}
