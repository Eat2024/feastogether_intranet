import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { EntityManager } from 'typeorm';
import { AppErrors } from '#app/common/errors/app-errors';
import { AppException } from '#app/common/errors/app.exception';
import { UserRepository } from '#app/features/users/repositories/user.repository';
import type { User } from '#app/features/users/entities/user.entity';

/** 發起交易內的員工資料讀取；不呼叫外部來源或保存主檔。 */
@Injectable()
export class EsignEmployeeEmailService {
  constructor(private readonly users: UserRepository) {}

  /** 先共享鎖定員工再鎖文件；固定資格／信箱，與其他文件受理的外鍵共享引用相容。 */
  async resolveForInitiation(
    userIds: string[],
    creatorUserId: number | null,
    manager: EntityManager,
  ): Promise<Map<number, User>> {
    if (
      !Array.isArray(userIds) ||
      (creatorUserId !== null &&
        (!Number.isSafeInteger(creatorUserId) || creatorUserId < 1)) ||
      userIds.some(
        (id) =>
          typeof id !== 'string' ||
          !/^[1-9][0-9]*$/.test(id) ||
          !Number.isSafeInteger(Number(id)),
      )
    ) {
      throw new AppException(...AppErrors.ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE);
    }
    const signerIds = new Set(userIds.map(Number));
    const ids = [
      ...new Set([
        ...signerIds,
        ...(creatorUserId === null ? [] : [creatorUserId]),
      ]),
    ].sort((a, b) => a - b);
    let rows: User[];
    try {
      rows = await this.users.findByIdsWithEmail(ids, manager, 'shared');
    } catch {
      throw new AppException(
        ...AppErrors.ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE,
      );
    }
    const byId = new Map(rows.map((user) => [Number(user.id), user]));
    const unavailable = ids.filter((id) => {
      const user = byId.get(id);
      return (
        !user ||
        !user.isActive ||
        !!user.deletedAt ||
        (signerIds.has(id) && !/^[A-Za-z0-9]{1,20}$/.test(user.empid))
      );
    });
    if (unavailable.length) {
      throw new AppException(...AppErrors.ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE, {
        userIds: unavailable.map(String),
      });
    }
    // 只正規化這次讀取的記憶體快照；不能 save 回主檔或取消無信箱者資格。
    for (const user of byId.values()) {
      const email = user.email?.trim().toLowerCase();
      user.email =
        email && email.length <= 255 && isEmail(email) ? email : null;
    }
    return byId;
  }
}
