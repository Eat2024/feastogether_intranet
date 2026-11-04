import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';
import { MYSQL_MAIN } from './mysql.tokens';

/**
 * 提供 EntityManager、原生 query 與 transaction 的低階存取。
 * Service 負責取得 manager 或開啟交易，再傳給 repository。
 */
@Injectable()
export class MysqlService {
  constructor(
    @Inject(MYSQL_MAIN)
    private readonly db: DataSource,
  ) {}

  /**
   * 執行原生 SQL
   * @param sql
   * @param params
   * @returns
   */
  async query<T = any>(sql: string, params?: any[]): Promise<T> {
    return this.db.query(sql, params);
  }

  /**
   * 取得非交易查詢使用的 EntityManager。
   */
  getManager(): EntityManager {
    return this.db.manager;
  }

  /** 由 Service 定義交易邊界。 */
  transaction<T>(
    run: (manager: EntityManager) => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T> {
    // TypeORM 使用 SET TRANSACTION，僅作用於本次交易，不修改 SESSION/GLOBAL。
    return isolationLevel
      ? this.db.transaction(isolationLevel, run)
      : this.db.transaction(run);
  }

  /** 需要 QueryRunner 等 DataSource 能力時使用。 */
  getDataSource(): DataSource {
    return this.db;
  }
}
