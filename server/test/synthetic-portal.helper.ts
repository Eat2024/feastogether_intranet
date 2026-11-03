/**
 * 合成 Portal 測試資料庫（Spec 024）。只用合成資料，不連真實 Portal。
 *
 * test/setup-e2e.ts 在每個測試檔載入前，就把 PORTAL_MYSQL_* 指向本檔專屬的資料庫
 * `${DB_MYSQL_DB}_portal_<8 碼隨機>`（主機與帳密沿用 DB_MYSQL_*），所以 AppModule 裡的
 * PortalDirectoryService 不用 override，只要在查詢前建立資料庫：
 *
 *   const portal = await createSyntheticPortal();   // 建庫與 sys_person、chi_department
 *   await portal.insertDepartments([{ department_ch_id: '0100', department_name: '總管理處' }]);
 *   await portal.insertPeople([{ person_empid: '000123', person_name: '王小明', person_status: 1 }]);
 *   await portal.query('UPDATE sys_person SET person_status = 2 WHERE person_empid = ?', ['000123']);
 *   await portal.drop();                            // afterAll；同一個測試檔要重建前也要先 drop
 *
 * - 欄位型別與 collation 同 Portal（research §0）。沒給的字串欄位是空字串，stopdate 預設 NULL（未停用）。
 * - sys_person 另有 person_pass、person_id_no、birthdate，一律填 PORTAL_SENTINEL，用來驗證這些值不會外流。
 * - 要指向別處（設定缺漏、不回應）時，用 overrideProvider(PortalConfig).useValue(...)：
 *   portalConfigFrom({...}) 只讀傳入的值；startUnresponsivePortal() 是只接受連線、永不回應的 TCP server。
 */
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { ConfigService } from '@nestjs/config';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { assertSchemaTestDatabaseName } from '#app/infrastructure/database/test/schema-test-database';
import { PortalConfig } from '#app/infrastructure/portal/portal.config';

export const PORTAL_SENTINEL = 'SYNTHETIC-PORTAL-SENTINEL-DO-NOT-READ';

export interface SyntheticDepartment {
  department_ch_id: string;
  department_name: string;
  department_parent_guid?: string;
  startdate?: string;
  stopdate?: string | null;
}

export interface SyntheticPerson {
  person_empid: string;
  person_name: string;
  person_status: number;
  department_id?: string;
  department_name?: string;
  title?: string;
  email?: string;
}

export interface SyntheticPortal {
  insertDepartments(departments: readonly SyntheticDepartment[]): Promise<void>;
  insertPeople(people: readonly SyntheticPerson[]): Promise<void>;
  query<T>(sql: string, values?: unknown[]): Promise<T[]>;
  drop(): Promise<void>;
}

export interface UnresponsivePortal {
  config: PortalConfig;
  close(): Promise<void>;
}

const UTF8MB3 = 'CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci';

const CREATE_TABLES = [
  `CREATE TABLE sys_person (
    person_empid varchar(20) ${UTF8MB3} NOT NULL,
    person_name varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    person_status int NOT NULL,
    department_id varchar(11) ${UTF8MB3} NOT NULL DEFAULT '',
    department_name varchar(40) ${UTF8MB3} NOT NULL DEFAULT '',
    title varchar(20) ${UTF8MB3} NOT NULL DEFAULT '',
    email varchar(50) ${UTF8MB3} NOT NULL DEFAULT '',
    person_pass varchar(100) NOT NULL,
    person_id_no varchar(100) NOT NULL,
    birthdate varchar(100) NOT NULL,
    KEY idx_person_empid (person_empid)
  ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE chi_department (
    department_ch_id varchar(20) NOT NULL,
    department_name varchar(50) NOT NULL,
    department_parent_guid varchar(100) NOT NULL DEFAULT '',
    startdate varchar(20) NOT NULL DEFAULT '',
    stopdate varchar(20) NULL,
    KEY idx_department_ch_id (department_ch_id)
  ) DEFAULT CHARSET=utf8mb3 COLLATE=utf8mb3_general_ci`,
];

/** 建立 PORTAL_MYSQL_DB 指向的合成 Portal 資料庫；名稱須以 feastogether_intranet_test 開頭。 */
export async function createSyntheticPortal(): Promise<SyntheticPortal> {
  const database = assertSchemaTestDatabaseName(
    process.env.PORTAL_MYSQL_DB ?? '',
  );
  const connection = await mysql.createConnection({
    host: process.env.PORTAL_MYSQL_HOST,
    port: Number(process.env.PORTAL_MYSQL_PORT),
    user: process.env.PORTAL_MYSQL_USER,
    password: process.env.PORTAL_MYSQL_PASS,
  });
  await connection.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await connection.changeUser({ database });
  for (const sql of CREATE_TABLES) await connection.query(sql);

  return {
    async insertDepartments(departments) {
      for (const department of departments) {
        await connection.query('INSERT INTO chi_department SET ?', [
          department,
        ]);
      }
    },
    async insertPeople(people) {
      for (const person of people) {
        await connection.query('INSERT INTO sys_person SET ?', [
          {
            ...person,
            person_pass: PORTAL_SENTINEL,
            person_id_no: PORTAL_SENTINEL,
            birthdate: PORTAL_SENTINEL,
          },
        ]);
      }
    },
    async query<T>(sql: string, values?: unknown[]) {
      const [rows] = await connection.query<RowDataPacket[]>(sql, values);
      return rows as T[];
    },
    async drop() {
      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
      } finally {
        await connection.end();
      }
    },
  };
}

const PORTAL_ENV_KEYS = [
  'PORTAL_MYSQL_HOST',
  'PORTAL_MYSQL_PORT',
  'PORTAL_MYSQL_USER',
  'PORTAL_MYSQL_PASS',
  'PORTAL_MYSQL_DB',
];

/**
 * 只讀傳入值的 PortalConfig，給 overrideProvider 用。沒給的鍵以空字串佔位（視為缺漏）：
 * ConfigService 找不到的鍵會改讀 process.env，而 setup-e2e 已把它指向合成 Portal。
 */
export function portalConfigFrom(env: Record<string, string>): PortalConfig {
  const blank = Object.fromEntries(PORTAL_ENV_KEYS.map((key) => [key, '']));
  return new PortalConfig(new ConfigService({ ...blank, ...env }));
}

/** 只接受 TCP 連線、永不送出 MySQL handshake 的 server，config 已指向它。 */
export async function startUnresponsivePortal(): Promise<UnresponsivePortal> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return {
    config: portalConfigFrom({
      PORTAL_MYSQL_HOST: '127.0.0.1',
      PORTAL_MYSQL_PORT: String(port),
      PORTAL_MYSQL_USER: 'synthetic_reader',
      PORTAL_MYSQL_PASS: 'synthetic-pass',
      PORTAL_MYSQL_DB: 'synthetic_portal',
    }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
