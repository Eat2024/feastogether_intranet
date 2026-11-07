import { PortalModule } from '#app/infrastructure/portal/portal.module';
import { EligibleStaffService } from '#app/features/auth/services/eligible-staff.service';
import { AuthorizationAssignmentService } from './services/authorization-assignment.service';
import { AuthorizationEventService } from './services/authorization-event.service';
import { AuthorizationManagementService } from './services/authorization-management.service';
import { AuthorizationRoleService } from './services/authorization-role.service';
import { Module } from '@nestjs/common';
import { MysqlModule } from '#app/infrastructure/database/mysql/mysql.module';
import { SuperUserAccessModule } from '#app/features/auth/super-user-access.module';
import { AuthorizationAuditService } from './services/authorization-audit.service';
import { AuthorizationCatalogService } from './services/authorization-catalog.service';
import { AuthorizationResolverService } from './services/authorization-resolver.service';
import { AuthorizationService } from './services/authorization.service';

/** HTTP、worker、console 共用的授權服務；沒有 controller 或啟動寫入。 */
@Module({
  imports: [MysqlModule, SuperUserAccessModule, PortalModule],
  providers: [
    EligibleStaffService,
    AuthorizationAssignmentService,
    AuthorizationAuditService,
    AuthorizationManagementService,
    AuthorizationRoleService,
    AuthorizationEventService,
    AuthorizationCatalogService,
    AuthorizationResolverService,
    AuthorizationService,
  ],
  exports: [
    AuthorizationAssignmentService,
    AuthorizationAuditService,
    AuthorizationManagementService,
    AuthorizationRoleService,
    AuthorizationEventService,
    AuthorizationCatalogService,
    AuthorizationResolverService,
    AuthorizationService,
  ],
})
export class AuthorizationModule {}
