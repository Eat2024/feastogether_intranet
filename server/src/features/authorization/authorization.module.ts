import { Module } from '@nestjs/common';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { SuperUserAccessModule } from '#app/features/auth/super-user-access.module';
import { AuthorizationAuditService } from './services/authorization-audit.service';
import { AuthorizationCatalogService } from './services/authorization-catalog.service';
import { AuthorizationResolverService } from './services/authorization-resolver.service';
import { AuthorizationService } from './services/authorization.service';

/** HTTP、worker、console 共用的授權服務；沒有 controller 或啟動寫入。 */
@Module({
  imports: [MysqlModule, SuperUserAccessModule],
  providers: [
    AuthorizationAuditService,
    AuthorizationCatalogService,
    AuthorizationResolverService,
    AuthorizationService,
  ],
  exports: [
    AuthorizationAuditService,
    AuthorizationCatalogService,
    AuthorizationResolverService,
    AuthorizationService,
  ],
})
export class AuthorizationModule {}
