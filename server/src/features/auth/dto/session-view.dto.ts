import type { User } from '#app/features/users/entities/user.entity';

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
