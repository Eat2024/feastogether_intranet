import type { INestApplication } from '@nestjs/common';
import { AuthorizationRole } from '#app/features/authorization/entities/authorization-role.entity';
import { AuthorizationUserRole } from '#app/features/authorization/entities/authorization-user-role.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import { employeeSessionCookie } from '../employee-session.helper';

/** 舊業務情境明確授予建立者；登入與一般員工 helper 絕不隱含升權。 */
export async function grantDocumentCreator(
  app: INestApplication,
  userId: number,
) {
  const manager = app.get(MysqlService).getManager();
  const role = await manager.findOneByOrFail(AuthorizationRole, {
    moduleKey: 'esign',
    roleCode: 'document_creator',
  });
  const existing = await manager.findOne(AuthorizationUserRole, {
    where: { userId, roleId: role.id },
    withDeleted: true,
  });
  await manager.save(
    existing
      ? Object.assign(existing, { deletedAt: null })
      : manager.create(AuthorizationUserRole, {
          userId,
          roleId: role.id,
          moduleKey: 'esign',
        }),
  );
}

export async function documentCreatorSessionCookie(
  app: INestApplication,
  userId: number,
) {
  await grantDocumentCreator(app, userId);
  return employeeSessionCookie(app, userId);
}
