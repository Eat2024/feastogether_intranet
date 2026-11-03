import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { PortalConfig } from './portal.config';
import type {
  PortalActiveEmployeeRow,
  PortalDepartmentRow,
  PortalOrgChartEmployeeRow,
  PortalOrgChartSource,
  PortalStaffRow,
  PortalStatusRow,
} from './portal.types';

// Portal 由多個系統共用（max_connections 151），每個 process 最多 3 條連線；10 秒逾時讓呼叫端在 15 秒內回報。
const CONNECTION_LIMIT = 3;
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 10_000;
const STATUS_BATCH_SIZE = 500;

const ORG_CHART_DEPARTMENTS_SQL = [
  'SELECT department_ch_id, department_name, department_parent_guid, startdate, stopdate',
  'FROM chi_department WHERE stopdate IS NULL',
  'ORDER BY CAST(department_name AS BINARY), department_ch_id',
].join('\n');

const ORG_CHART_EMPLOYEES_SQL = [
  'SELECT person_empid, person_name, title, department_id',
  'FROM sys_person WHERE person_status = 1 ORDER BY person_empid',
].join('\n');

const EMPLOYEES_BY_EMPID_SQL = [
  'SELECT person_empid, person_name, department_id, department_name, title, person_status',
  'FROM sys_person WHERE person_empid = ?',
].join('\n');

const ACTIVE_EMPLOYEES_SQL = [
  'SELECT person_empid, person_name, department_id, department_name, title, email, person_status',
  'FROM sys_person WHERE person_status IN (0, 1)',
].join('\n');

/**
 * Portal MySQL 唯讀查詢，只執行 specs/024-portal-hr-source/contracts/portal-source.md 列出的 SQL。
 *
 * 連線池在第一次查詢時才建立，Portal 故障或設定缺漏不影響啟動；mysql2 pool 也是用到時才連線，
 * Portal 恢復後自動重連。查詢錯誤原樣拋出，由呼叫端轉成自己的錯誤碼；本服務不做業務判斷、不寫 log。
 * mysql2 的錯誤訊息可能含 Portal 主機或帳號，err.sql 含代入後的員編，呼叫端不可把原始錯誤寫進 log 或回應。
 */
@Injectable()
export class PortalDirectoryService implements OnModuleDestroy {
  private pool?: Pool;

  constructor(private readonly config: PortalConfig) {}

  async listOrgChartSource(): Promise<PortalOrgChartSource> {
    const departments = await this.query<PortalDepartmentRow>(
      ORG_CHART_DEPARTMENTS_SQL,
    );
    const employees = await this.query<PortalOrgChartEmployeeRow>(
      ORG_CHART_EMPLOYEES_SQL,
    );
    return { departments, employees };
  }

  /** Portal 的 collation 不分大小寫且忽略尾端空白，呼叫端須自行以 === 比對員編。 */
  findEmployeesByEmpid(empid: string): Promise<PortalStaffRow[]> {
    return this.query<PortalStaffRow>(EMPLOYEES_BY_EMPID_SQL, [empid]);
  }

  listActiveEmployees(): Promise<PortalActiveEmployeeRow[]> {
    return this.query<PortalActiveEmployeeRow>(ACTIVE_EMPLOYEES_SQL);
  }

  async findStatusesByEmpids(
    empids: readonly string[],
  ): Promise<PortalStatusRow[]> {
    const rows: PortalStatusRow[] = [];
    for (let i = 0; i < empids.length; i += STATUS_BATCH_SIZE) {
      const batch = empids.slice(i, i + STATUS_BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(', ');
      rows.push(
        ...(await this.query<PortalStatusRow>(
          `SELECT person_empid, person_status FROM sys_person WHERE person_empid IN (${placeholders})`,
          batch,
        )),
      );
    }
    return rows;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  private async query<T>(sql: string, values?: unknown[]): Promise<T[]> {
    const [rows] = await this.getPool().query<RowDataPacket[]>({
      sql,
      values,
      timeout: QUERY_TIMEOUT_MS,
    });
    return rows as T[];
  }

  private getPool(): Pool {
    this.pool ??= createPool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      charset: 'utf8mb4',
      connectionLimit: CONNECTION_LIMIT,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });
    return this.pool;
  }
}
