import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { MYSQL_MAIN } from '#app/infrastructure/database/mysql/mysql.tokens';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';

/** MySQL 唯一鍵衝突的 driver 錯誤碼（並發建帳時由 person_empid 唯一約束仲裁）。 */
const MYSQL_DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

/** 判斷例外是否為唯一鍵衝突（呼叫端據此重跑一次整筆交易）。 */
export function isDuplicateEntryError(error: unknown): boolean {
  const driverError = (error as { driverError?: { code?: string } })
    ?.driverError;
  return driverError?.code === MYSQL_DUPLICATE_ENTRY;
}

/**
 * OAuth 登入對應本地帳號的資料存取。查詢皆 withDeleted：
 * 已軟刪的使用者要能被看見才能「拒絕」，而不是被當成不存在而重建繞過。
 */
@Injectable()
export class OauthIdentityRepository {
  constructor(@Inject(MYSQL_MAIN) private readonly ds: DataSource) {}

  transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.ds.transaction(run);
  }

  /** 以員編鎖定使用者列（FOR UPDATE）；person_empid 有唯一索引，至多一筆。 */
  findUserByEmpIdForUpdate(
    empId: string,
    manager: EntityManager,
  ): Promise<AuthUser | null> {
    return manager.findOne(AuthUser, {
      where: { personEmpid: empId },
      withDeleted: true,
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** save(entity 實例) 才會觸發稽核欄自動填值。 */
  saveUser(user: AuthUser, manager: EntityManager): Promise<AuthUser> {
    return manager.save(user);
  }

  createUser(
    fields: Pick<
      AuthUser,
      'personEmpid' | 'personName' | 'lastLoginAt' | 'oauthSub'
    >,
    manager: EntityManager,
  ): Promise<AuthUser> {
    return manager.save(
      manager.create(AuthUser, { ...fields, isActive: true }),
    );
  }
}
