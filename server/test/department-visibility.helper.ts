import { randomUUID } from 'node:crypto';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { MysqlService } from '#app/infrastructure/database/mysql/mysql.service';
import type { SecurityE2eContext } from './security-e2e.helper';
import { employeeSessionCookie } from './employee-session.helper';

/** 只建立合成資料，不改登入途徑或既有員工；NULL 舊文件可用 overrides 明確指定。 */
export async function createDepartmentFixtures(ctx: SecurityE2eContext) {
  const manager = ctx.app.get(MysqlService).getManager();
  const prefix = randomUUID().slice(0, 8);
  const definitions = {
    a1: 'A001',
    a2: 'A001',
    b1: 'B001',
    b2: 'B001',
    missing: null,
    sameName: 'a001',
  } as const;
  type Actor = keyof typeof definitions;
  const entries = await Promise.all(
    (Object.keys(definitions) as Actor[]).map(async (key) => {
      const user = await manager.save(
        User,
        manager.create(User, {
          empid: `D${prefix}${key}`,
          name: `合成員工 ${key}`,
          isActive: true,
          departmentCode: definitions[key],
          departmentName: '合成同名部門',
        }),
      );
      const cookie = await employeeSessionCookie(ctx.app, user.id);
      return { key, user, cookie };
    }),
  );
  const users = Object.fromEntries(
    entries.map(({ key, user }) => [key, user]),
  ) as Record<Actor, User>;
  const cookies = Object.fromEntries(
    entries.map(({ key, cookie }) => [key, cookie]),
  ) as Record<Actor, string>;
  const createDocument = (
    creator: User,
    overrides: Partial<EsignDocument> = {},
  ) =>
    manager.save(
      EsignDocument,
      manager.create(EsignDocument, {
        docNumber: randomUUID(),
        title: `合成部門文件 ${prefix}`,
        status: 'draft',
        createdByUserId: creator.id,
        createdByDepartmentCode: creator.departmentCode,
        createdByDepartmentName: creator.departmentName,
        ...overrides,
      }),
    );
  return { manager, users, cookies, createDocument };
}
