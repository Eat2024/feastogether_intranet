// actor-display.service.ts
// 「這筆資料是誰建的／誰改的」→ 姓名與部門的**唯一**解析點。
//
// 稽核欄 `created_by` / `updated_by` 存的是 **`auth_users.id` 的字串形式**
// （JWT `sub` ＝ `String(user.id)`，經 AuthGuard → CLS → AuditSubscriber 寫入），
// 直接下發等於讓畫面顯示一串流水號。集中在這裡而非各 feature 自己查，
// 是因為各 feature 要的是同一件事（列表、明細、異動紀錄），
// 各寫一份必然在 `withDeleted` 這種細節上漂移。
import { Injectable } from '@nestjs/common';
import { UserAccountRepository } from '#app/features/auth/repositories/user-account.repository';

/** 操作者的顯示資訊；查無該使用者時呼叫端拿到的是 `undefined`，不是空殼。 */
export interface ActorDisplay {
  userId: number;
  name: string | null;
  departmentName: string | null;
  titleName: string | null;
}

@Injectable()
export class ActorDisplayService {
  constructor(private readonly users: UserAccountRepository) {}

  async resolve(
    userIds: Array<string | undefined | null>,
  ): Promise<Map<string, ActorDisplay>> {
    const ids = [
      ...new Set(userIds.filter((value): value is string => Boolean(value))),
    ];
    if (ids.length === 0) return new Map();

    const users = await this.users.findDisplaysByIds(ids.map(Number));
    return new Map(
      users.map((user) => [
        String(user.id),
        {
          userId: Number(user.id),
          name: user.personName ?? null,
          departmentName: user.departmentName ?? null,
          titleName: user.titleName ?? null,
        },
      ]),
    );
  }
}
