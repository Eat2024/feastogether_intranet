import { Controller, Get } from '@nestjs/common';
import API_PATH from '#app/config/config.path';
import { Public } from '#app/framework/decorators/public.decorator';

/**
 * Liveness 健康檢查。實際路徑為 /api/health（全域前綴）。
 * 僅代表「process 活著」，不檢查 DB/Redis。
 */
@Controller(API_PATH.HEALTH)
export class HealthController {
  @Public()
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
