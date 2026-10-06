import { DynamicModule, Global, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import { clsUserId } from '#app/infrastructure/database/audit-user.context';
import { AppLoggerService } from './appLog/app-logger.service';
import { HttpAccessLoggerService } from './httpEndpointLog/http-access-logger.service';
import { buildPinoHttpOptions } from './logHelper/logger.config';
import { CLS_REQUEST_ID } from './requestId/request-id';

const PinoLogModule: DynamicModule = PinoLoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService, ClsService],
  useFactory: (config: ConfigService, cls: ClsService) => ({
    // nestjs-pino 預設用舊式 `*` 掛 middleware；NestJS 11 需 named wildcard。
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      ...buildPinoHttpOptions(config),
      mixin() {
        if (!cls.isActive()) return {};

        const requestId = cls.get<string>(CLS_REQUEST_ID);
        const userId = clsUserId(cls);
        return {
          ...(requestId ? { requestId } : {}),
          ...(userId ? { userId } : {}),
        };
      },
    },
  }),
});

@Global()
@Module({
  imports: [PinoLogModule],
  providers: [AppLoggerService, HttpAccessLoggerService],
  exports: [AppLoggerService, HttpAccessLoggerService, PinoLoggerModule],
})
export class LoggingModule {}
