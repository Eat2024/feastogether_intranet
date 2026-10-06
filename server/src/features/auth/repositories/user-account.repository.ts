import { Injectable } from '@nestjs/common';
import { Brackets, EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { MysqlEntityService } from '#app/infrastructure/database/mysql/mysql.entity.service';
import { AuthUser } from '#app/features/auth/entities/auth-user.entity';
import { UserListRow } from '#app/features/auth/mappers/user.mapper';

/** 帳號列表查詢條件：放大鏡關鍵字 + 角色 tab（皆 optional，可並存）。 */
export interface UserListFilter {
  keyword?: string;
  roleId?: number;
}

/** 帳號列表 / 詳情 / 異動的資料存取（軟刪由 QueryBuilder 自動排除）。 */
@Injectable()
export class UserAccountRepository {
  constructor(private readonly db: MysqlEntityService) {}

  transaction<T>(runInTransaction: (manager: EntityManager) => Promise<T>) {
    return this.db.authUser.manager.transaction(runInTransaction);
  }

  findById(id: number, manager?: EntityManager): Promise<AuthUser | null> {
    return manager
      ? manager.findOne(AuthUser, { where: { id } })
      : this.db.authUser.findOne({ where: { id } });
  }

  /** 依員編載入（person_empid 有 unique index，至多一筆）；查無回 null（由 service 轉 404）。 */
  findByEmpId(
    empId: string,
    manager?: EntityManager,
    withDeleted = false,
  ): Promise<AuthUser | null> {
    return manager
      ? manager.findOne(AuthUser, {
          where: { personEmpid: empId },
          withDeleted,
          lock: { mode: 'pessimistic_write' },
        })
      : this.db.authUser.findOne({
          where: { personEmpid: empId },
          withDeleted,
        });
  }

  /** 搜尋候選人一次載入本地狀態，包含軟刪記錄以避免重新加入。 */
  findByEmpIdsIncludingDeleted(empIds: string[]): Promise<AuthUser[]> {
    return this.db.authUser.find({
      where: { personEmpid: In(empIds) },
      withDeleted: true,
    });
  }

  findDisplaysByIds(ids: number[]): Promise<AuthUser[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.authUser.find({
      where: { id: In(ids) },
      select: {
        id: true,
        personName: true,
        departmentName: true,
        titleName: true,
      },
      withDeleted: true,
    });
  }

  save(user: AuthUser, manager: EntityManager): Promise<AuthUser> {
    return manager.save(user);
  }

  /** 列表項共用選欄（listWithTotal 與 listItemsByEmpIds 對齊，避免欄位 drift）。 */
  private selectListColumns(
    qb: SelectQueryBuilder<AuthUser>,
  ): SelectQueryBuilder<AuthUser> {
    return qb
      .select('u.id', 'id')
      .addSelect('u.personEmpid', 'empId')
      .addSelect('u.personName', 'name')
      .addSelect('u.departmentName', 'departmentName')
      .addSelect('u.lastLoginAt', 'lastLoginAt')
      .addSelect('u.personStatus', 'personStatus')
      .addSelect('u.isActive', 'isActive')
      .addSelect('r.id', 'roleId')
      .addSelect('r.role_name', 'roleName')
      .addSelect('r.role_code', 'roleCode')
      .addSelect('r.is_admin', 'isAdmin');
  }

  /**
   * 一頁列表 + 總筆數，單條 SQL 完成。
   */
  async listWithTotal(
    filter: UserListFilter,
    offset: number,
    limit: number,
  ): Promise<{ rows: UserListRow[]; total: number }> {
    const rows = await this.selectListColumns(this.baseQuery(filter))
      .addSelect('COUNT(*) OVER()', 'total')
      .orderBy('u.id', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<UserListRow & { total: string | number }>();
    const total = rows.length ? Number(rows[0].total) : 0;
    return { rows, total };
  }

  /**
   * 依員編陣列回列表項（形狀同 listWithTotal 的 rows），供批次操作後一次帶回最新資料。
   * 排除軟刪（QueryBuilder 自動）；空陣列直接回 []（避免 IN () 語法錯）。
   */
  listItemsByEmpIds(empIds: string[]): Promise<UserListRow[]> {
    if (!empIds.length) return Promise.resolve([]);
    // 走 baseQuery 取得與列表一致的 join，再加 empId 條件（join/選欄單一來源，避免 drift）。
    return this.selectListColumns(this.baseQuery({}))
      .andWhere('u.personEmpid IN (:...empIds)', { empIds })
      .orderBy('u.id', 'DESC')
      .getRawMany<UserListRow>();
  }

  /**
   * 依角色 id 回該角色全部使用者的列表項（形狀同 listWithTotal 的 rows），
   * 供批次操作後整個 role tab 重繪。不分頁（ponytail: 角色人數大再改分頁）。
   * 角色篩選走 baseQuery 的 roleId 分支（`r.id = :roleId`），與列表同一套過濾邏輯。
   */
  listItemsByRoleId(roleId: number): Promise<UserListRow[]> {
    return this.selectListColumns(this.baseQuery({ roleId }))
      .orderBy('u.id', 'DESC')
      .getRawMany<UserListRow>();
  }

  /** 匯入員工使用 Entity 實例，以觸發稽核欄位填入。 */
  create(data: Partial<AuthUser>, manager: EntityManager): Promise<AuthUser> {
    return manager.save(manager.create(AuthUser, data));
  }

  /** 依員編陣列批次載入（排除軟刪，QueryBuilder 自動）；供批次啟用/停用使用。 */
  findByEmpIds(empIds: string[], manager: EntityManager): Promise<AuthUser[]> {
    return manager
      .createQueryBuilder(AuthUser, 'u')
      .where('u.personEmpid IN (:...empIds)', { empIds })
      .getMany();
  }

  /**
   * 純顯示 leftJoin（用原始表名而非 entity，避免 TypeORM 自動把軟刪角色濾成 inner join）。
   * keyword 對 姓名/工號/部門名稱/角色名稱 做 OR 模糊；roleId 對角色 id 精準篩選（AND）。
   */
  private baseQuery({ keyword, roleId }: UserListFilter) {
    const qb = this.db.authUser
      .createQueryBuilder('u')
      .leftJoin('auth_roles', 'r', 'r.id = u.role_id');
    if (keyword) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('u.personName LIKE :kw')
            .orWhere('u.personEmpid LIKE :kw')
            .orWhere('u.departmentName LIKE :kw')
            .orWhere('r.role_name LIKE :kw');
        }),
        { kw: `%${keyword}%` },
      );
    }
    if (roleId) {
      qb.andWhere('r.id = :roleId', { roleId });
    }
    return qb;
  }
}
