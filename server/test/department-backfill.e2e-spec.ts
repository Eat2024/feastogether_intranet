import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';

type Backup = Array<{
  id: string;
  departmentCode: string | null;
  departmentName: string | null;
}>;
type Counts = {
  expected_count: number;
  unique_count: number;
  existing_count: number;
  valid_count: string;
};
let blocks: Record<string, string>;

async function fixture(
  run: (manager: EntityManager, backup: Backup) => Promise<void>,
) {
  await withSchemaTestDatabase(async ({ database }) => {
    const ds = await new DataSource(
      buildMysqlOptions((key) =>
        key === 'DB_MYSQL_DB' ? database : process.env[key],
      ),
    ).initialize();
    const runner = ds.createQueryRunner();
    try {
      await ds.runMigrations();
      await runner.connect();
      const manager = runner.manager;
      await manager.query(
        "INSERT INTO users(id,empid,name,department_code,department_name) VALUES (1,'CUTOVER001','合成建立人','00Ab','員工實際部門')",
      );
      for (const [id, code, name, deleted] of [
        [1, null, null, null],
        [2, null, null, '2026-01-02'],
        [3, '1029030000', 'IT策略本部系統開發部', null],
      ]) {
        await manager.query(
          `INSERT INTO esign_documents(id,doc_number,title,created_by_user_id,created_by_department_code,created_by_department_name,signing_payload_json,signing_payload_sha256,updated_at,deleted_at)
          VALUES (?,CONCAT('00000000-0000-4000-8000-',LPAD(?,12,'0')),'合成舊文件',1,?,?,JSON_OBJECT('evidence','fixed'),?,'2026-01-01 01:02:03.123456',?)`,
          [id, id, code, name, 'a'.repeat(64), deleted],
        );
      }
      await manager.query(
        "INSERT INTO esign_audit_events(document_id,event_type,occurred_at,event_hash) VALUES (1,'document.created','2026-01-01',?)",
        ['b'.repeat(64)],
      );
      await manager.query(
        "INSERT INTO esign_signers(id,public_id,document_id,signer_type,user_id,empid_snapshot,name_snapshot,status,signed_at,completion_status,completion_ready_at) VALUES(1,'00000000-0000-4000-8000-000000000099',1,'user',1,'CUTOVER001','合成已簽署人','signed','2026-01-01','ready','2026-01-01')",
      );
      await manager.query(
        "INSERT INTO esign_signature_records(id,signer_id,document_sha256,signing_payload_sha256,consent_version,authentication_method,authentication_event_id,signed_at_utc) VALUES(1,1,?,?,'v1','employee_session','cutover-synthetic','2026-01-01')",
        ['c'.repeat(64), 'a'.repeat(64)],
      );
      await manager.query(
        "INSERT INTO esign_file_objects(signature_record_id,file_purpose,object_key,mime_type,file_size,sha256) VALUES(1,'completed_pdf','synthetic-evidence-only','application/pdf',123,?)",
        ['d'.repeat(64)],
      );
      const [snapshot] = await manager.query<
        Array<{
          backup_json: Backup;
          expected_count: number;
          soft_deleted_count: string;
        }>
      >(blocks.backup);
      expect(Number(snapshot.expected_count)).toBe(3);
      expect(Number(snapshot.soft_deleted_count)).toBe(1);
      // 切換後新建文件不在備份明列 ID 之中，不能被這次或重跑覆寫。
      await manager.query(
        "INSERT INTO esign_documents(id,doc_number,title,created_by_user_id,created_by_department_code,created_by_department_name,updated_at) VALUES(4,'00000000-0000-4000-8000-000000000004','合成新文件',1,'00Ab','員工實際部門','2026-01-03')",
      );
      await runner.startTransaction();
      await manager.query('SET @spec017_backup = CAST(? AS JSON)', [
        JSON.stringify(snapshot.backup_json),
      ]);
      await manager.query(blocks.lock);
      await run(manager, snapshot.backup_json);
      await runner.commitTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await ds.destroy();
    }
  });
}

async function evidence(manager: EntityManager) {
  const data: unknown[] = [];
  for (const table of [
    'users',
    'esign_signers',
    'esign_signature_records',
    'esign_file_objects',
    'esign_audit_events',
  ]) {
    data.push(
      await manager.query<unknown[]>(`SELECT * FROM ${table} ORDER BY id`),
    );
  }
  data.push(
    await manager.query<unknown[]>(
      "SELECT id,created_by_user_id,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updated_at,deleted_at,signing_payload_json,signing_payload_sha256 FROM esign_documents ORDER BY id",
    ),
  );
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
const documents = (manager: EntityManager) =>
  manager.query<unknown[]>('SELECT * FROM esign_documents ORDER BY id');

describe('Spec017 文件中的一次性回填與回復 SQL', () => {
  jest.setTimeout(60_000);
  beforeAll(async () => {
    const markdown = await readFile(
      join(
        __dirname,
        '../../specs/017-department-document-visibility/uat-cutover.md',
      ),
      'utf8',
    );
    blocks = Object.fromEntries(
      [
        ...markdown.matchAll(/<!-- sql:(\w+) -->\s*```sql\n([\s\S]*?)\n```/g),
      ].map((match) => [match[1], match[2]]),
    );
    for (const key of [
      'backup',
      'lock',
      'preflight',
      'backfill',
      'restore',
      'verify',
    ])
      expect(blocks[key]).toBeDefined();
  });

  it('明列3筆含軟刪除：首次只改2筆、重跑0筆、回復原值；新文件與證據不變', async () => {
    await fixture(async (manager) => {
      const before = await documents(manager);
      const beforeHash = await evidence(manager);
      const [counts] = await manager.query<Counts[]>(blocks.preflight);
      expect(counts).toMatchObject({
        expected_count: 3,
        unique_count: 3,
        existing_count: 3,
      });
      expect(Number(counts.valid_count)).toBe(3);
      await manager.query(blocks.backfill);
      const [first] = await manager.query<Array<{ changed: number }>>(
        'SELECT ROW_COUNT() AS changed',
      );
      expect(first.changed).toBe(2);
      expect(
        await manager.query(
          'SELECT id,created_by_department_code AS code,created_by_department_name AS name FROM esign_documents ORDER BY id',
        ),
      ).toEqual([
        { id: 1, code: '1029030000', name: 'IT策略本部系統開發部' },
        { id: 2, code: '1029030000', name: 'IT策略本部系統開發部' },
        { id: 3, code: '1029030000', name: 'IT策略本部系統開發部' },
        { id: 4, code: '00Ab', name: '員工實際部門' },
      ]);
      expect(await evidence(manager)).toBe(beforeHash);
      const [verified] = await manager.query<
        Array<{ existing_count: number; target_count: string }>
      >(blocks.verify);
      expect(Number(verified.existing_count)).toBe(3);
      expect(Number(verified.target_count)).toBe(3);
      await manager.query(blocks.backfill);
      expect(await manager.query('SELECT ROW_COUNT() AS changed')).toEqual([
        { changed: 0 },
      ]);
      await manager.query(blocks.restore);
      expect(await manager.query('SELECT ROW_COUNT() AS changed')).toEqual([
        { changed: 2 },
      ]);
      expect(await documents(manager)).toEqual(before);
      expect(await evidence(manager)).toBe(beforeHash);
      await manager.query(blocks.restore);
      expect(await manager.query('SELECT ROW_COUNT() AS changed')).toEqual([
        { changed: 0 },
      ]);
    });
  });

  it.each([
    'unknown-code',
    'wrong-name',
    'missing-id',
    'duplicate-id',
    'missing-field',
    'empty',
  ])('%s：跳過人工檢查也整批不寫入', async (kind) => {
    await fixture(async (manager, backup) => {
      if (kind === 'unknown-code')
        await manager.query(
          "UPDATE esign_documents SET created_by_department_code='1029030000 ',updated_at=updated_at WHERE id=2",
        );
      if (kind === 'wrong-name')
        await manager.query(
          "UPDATE esign_documents SET created_by_department_name='不同部門',updated_at=updated_at WHERE id=2",
        );
      let manifest: unknown = backup;
      if (kind === 'missing-id')
        manifest = [
          ...backup,
          { id: '999999', departmentCode: null, departmentName: null },
        ];
      if (kind === 'duplicate-id') manifest = [...backup, backup[0]];
      if (kind === 'missing-field')
        manifest = [
          { id: backup[0].id, departmentCode: backup[0].departmentCode },
          ...backup.slice(1),
        ];
      if (kind === 'empty') manifest = [];
      await manager.query('SET @spec017_backup = CAST(? AS JSON)', [
        JSON.stringify(manifest),
      ]);
      const before = await documents(manager);
      const beforeHash = await evidence(manager);
      // 故意不執行人工 preflight；寫入本身必須擋下整批。
      await manager.query(blocks.backfill);
      expect(await manager.query('SELECT ROW_COUNT() AS changed')).toEqual([
        { changed: 0 },
      ]);
      expect(await documents(manager)).toEqual(before);
      await manager.query(blocks.restore);
      expect(await manager.query('SELECT ROW_COUNT() AS changed')).toEqual([
        { changed: 0 },
      ]);
      expect(await documents(manager)).toEqual(before);
      expect(await evidence(manager)).toBe(beforeHash);
    });
  });

  it('備份本身已有非預期非空原值亦拒絕，不能用備份把未確認部門強制改IT', async () => {
    await fixture(async (manager, backup) => {
      await manager.query(
        "UPDATE esign_documents SET created_by_department_code='00Ab',created_by_department_name='同名但不同碼',updated_at=updated_at WHERE id=2",
      );
      const manifest = backup.map((row) =>
        row.id === '2'
          ? { ...row, departmentCode: '00Ab', departmentName: '同名但不同碼' }
          : row,
      );
      await manager.query('SET @spec017_backup = CAST(? AS JSON)', [
        JSON.stringify(manifest),
      ]);
      const before = await documents(manager);
      await manager.query(blocks.backfill);
      expect(await manager.query('SELECT ROW_COUNT() AS changed')).toEqual([
        { changed: 0 },
      ]);
      expect(await documents(manager)).toEqual(before);
    });
  });

  it('回復前任一文件被改為其他部門時整批停止，已回填的其他文件也不局部回復', async () => {
    await fixture(async (manager) => {
      await manager.query(blocks.backfill);
      await manager.query(
        "UPDATE esign_documents SET created_by_department_code='B001',updated_at=updated_at WHERE id=2",
      );
      const before = await documents(manager);
      await manager.query(blocks.restore);
      expect(await manager.query('SELECT ROW_COUNT() AS changed')).toEqual([
        { changed: 0 },
      ]);
      expect(await documents(manager)).toEqual(before);
    });
  });
});
