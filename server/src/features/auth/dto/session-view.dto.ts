import type { User } from '#app/features/users/entities/user.entity';
import type { AuthenticatedSession } from '../auth.types';

/** 員工會話回應：保留既有 user／expiresAt 形狀，actor 為新增欄位。 */
export interface EmployeeSessionView {
  actor: { kind: 'employee'; userId: number };
  user: {
    id: number;
    empId: string;
    name: string;
    departmentName: string | null;
    titleName: string | null;
    lastLoginAt: Date | null;
  };
  expiresAt: Date;
}

export function toEmployeeSessionView(
  user: User,
  expiresAt: Date,
): EmployeeSessionView {
  const id = Number(user.id);
  return {
    actor: { kind: 'employee', userId: id },
    user: {
      id,
      empId: user.empid,
      name: user.name,
      departmentName: user.departmentName ?? null,
      titleName: user.titleName ?? null,
      lastLoginAt: user.lastLoginAt ?? null,
    },
    expiresAt,
  };
}

/** Super user 會話回應：只有固定顯示名稱；不回部署帳號、假員編、入口、fingerprint、版本或 token。 */
export interface SuperUserSessionView {
  actor: { kind: 'super_user'; displayName: 'Super user' };
  user: null;
  expiresAt: Date;
}

export type SessionView = EmployeeSessionView | SuperUserSessionView;

export function toSuperUserSessionView(expiresAt: Date): SuperUserSessionView {
  return {
    actor: { kind: 'super_user', displayName: 'Super user' },
    user: null,
    expiresAt,
  };
}

export function toSessionView(session: AuthenticatedSession): SessionView {
  return session.actor.kind === 'employee'
    ? toEmployeeSessionView(session.user!, session.expiresAt)
    : toSuperUserSessionView(session.expiresAt);
}
