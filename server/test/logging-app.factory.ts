import { Controller, Get, Module } from '@nestjs/common';
import { RequestIdClsModule } from '#app/infrastructure/logging/requestId/request-id.module';

export const buildTestAppModule = () => {
  @Module({
    imports: [RequestIdClsModule],
    controllers: [PingController],
  })
  class TestAppModule {}
  return TestAppModule;
};

// A1. Test Controller
@Controller()
export class PingController {
  @Get('ping')
  ping() {
    return { pong: 'ok' };
  }
}
