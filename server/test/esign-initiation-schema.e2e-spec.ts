import { revertAfter } from './schema-migration.helper';
import { EsignInitiationJob } from '#app/features/esign/entities/esign-initiation-job.entity';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';

async function withJobs(run: (ds: DataSource) => Promise<void>) {
  await withSchemaTestDatabase(async ({ database }) => {
    const ds = await new DataSource(
      buildMysqlOptions((key) =>
        key === 'DB_MYSQL_DB' ? database : process.env[key],
      ),
    ).initialize();
    try {
      await ds.runMigrations();
      await ds.query(
        "INSERT INTO users (empid,name) VALUES ('JOB001','合成員工')",
      );
      await ds.query(
        "INSERT INTO esign_documents (doc_number,title,created_by_user_id) VALUES (?, '合成文件',1)",
        [randomUUID()],
      );
      await run(ds);
    } finally {
      await ds.destroy();
    }
  });
}

async function insertJob(ds: DataSource, key = randomUUID()) {
  await ds.query(
    `INSERT INTO esign_initiation_jobs
    (public_id, document_id, created_by_user_id, request_key, request_hash,
     input_json, document_version_json, total_count, accepted_at, deadline_at)
    VALUES (?,1,1,?,REPEAT('a',64),'{}','{}',1,UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 HOUR))`,
    [randomUUID(), key],
  );
}

describe('背景發起工作 schema', () => {
  jest.setTimeout(60000);
  it('一份文件只有一個非終態工作，終態後可重新受理但不可重用 key', async () => {
    await withJobs(async (ds) => {
      const key = randomUUID();
      await insertJob(ds, key);
      await expect(insertJob(ds)).rejects.toThrow(/Duplicate entry/);
      await ds.query(
        "UPDATE esign_initiation_jobs SET status='failed',stage='failed',error_code='ESIGN_INITIATION_INPUT_INVALID',completed_at=UTC_TIMESTAMP(6) WHERE id=1",
      );
      await expect(insertJob(ds, key)).rejects.toThrow(/Duplicate entry/);
      await revertAfter(ds, 'BackgroundSignatureInitiation1793750401000');
      await insertJob(ds);
      expect(
        await ds.query('SELECT COUNT(*) AS count FROM esign_initiation_jobs'),
      ).toEqual([{ count: 2 }]);
    });
  });
  it('一般工作讀取不載入敏感 JSON，維護掃描索引涵蓋狀態與時間', async () => {
    await withJobs(async (ds) => {
      await insertJob(ds);
      const job = await ds.manager.findOneByOrFail(EsignInitiationJob, {
        id: 1,
      });
      expect(job.inputJson).toBeUndefined();
      expect(job.documentVersionJson).toBeUndefined();
      expect(job.issuesJson).toBeUndefined();
      const indexes = await ds.query<
        Array<{ Key_name: string; Column_name: string; Seq_in_index: number }>
      >('SHOW INDEX FROM esign_initiation_jobs');
      for (const [name, columns] of [
        [
          'idx_esign_initiation_jobs_retry',
          ['status', 'next_attempt_at', 'id'],
        ],
        [
          'idx_esign_initiation_jobs_lease',
          ['status', 'lease_expires_at', 'id'],
        ],
        [
          'idx_esign_initiation_jobs_completed',
          ['status', 'completed_at', 'id'],
        ],
      ] as const) {
        expect(
          indexes
            .filter((index) => index.Key_name === name)
            .sort((a, b) => a.Seq_in_index - b.Seq_in_index)
            .map((index) => index.Column_name),
        ).toEqual(columns);
      }
    });
  });
  it('非法狀態、計數、租約與非終態清理均由資料庫拒絕', async () => {
    await withJobs(async (ds) => {
      await revertAfter(ds, 'BackgroundSignatureInitiation1793750401000');
      await insertJob(ds);
      for (const mutation of [
        "status='unknown'",
        "stage='unknown'",
        'total_count=0',
        'processed_count=2',
        'attempt_count=4',
        'input_json=NULL',
        'document_version_json=NULL',
        "status='processing'",
        "lease_token='00000000-0000-4000-8000-000000000001'",
        'completed_at=UTC_TIMESTAMP(6)',
        "status='succeeded',stage='completed',completed_at=UTC_TIMESTAMP(6),error_code='oops'",
      ])
        await expect(
          ds.query(`UPDATE esign_initiation_jobs SET ${mutation} WHERE id=1`),
        ).rejects.toThrow();
      await expect(
        ds.query('DELETE FROM esign_documents WHERE id=1'),
      ).rejects.toThrow();
      await expect(ds.query('DELETE FROM users WHERE id=1')).rejects.toThrow();
    });
  });
  it('非空工作表拒絕 down，空表可 down/up', async () => {
    await withJobs(async (ds) => {
      await revertAfter(ds, 'BackgroundSignatureInitiation1793750401000');
      await insertJob(ds);
      await expect(ds.undoLastMigration()).rejects.toThrow('無法回滾');
      expect(
        await ds.query('SELECT COUNT(*) AS count FROM esign_initiation_jobs'),
      ).toEqual([{ count: 1 }]);
      await ds.query('DELETE FROM esign_initiation_jobs');
      await ds.undoLastMigration();
      await ds.runMigrations();
      expect(
        await ds.query('SELECT COUNT(*) AS count FROM esign_initiation_jobs'),
      ).toEqual([{ count: 0 }]);
    });
  });
});
