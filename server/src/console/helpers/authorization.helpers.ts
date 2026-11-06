import type { INestApplicationContext } from '@nestjs/common';
import { AuthorizationCatalogService } from '#app/features/authorization/services/authorization-catalog.service';

/** 只暴露業務閉包，不將 service、repository 或 DataSource 放入 REPL。 */
export function createAuthorizationConsole(app: INestApplicationContext) {
  const catalog = app.get(AuthorizationCatalogService);
  return { syncCatalog: () => catalog.syncCatalog() };
}
