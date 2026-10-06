import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from './mysql.tokens';

/**
 * 提供原生 query / transaction 的低階存取。
 * 一般 CRUD 請注入 MysqlModule 提供的 entity repository provider。
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
   * 取得目前的 DataSource（需要 transaction / queryRunner 時使用）
   * @returns
   */
  getDataSource(): DataSource {
    return this.db;
  }
}
