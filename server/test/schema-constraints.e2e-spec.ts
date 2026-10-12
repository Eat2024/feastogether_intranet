import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';

const optionsFor = (database: string) =>
  buildMysqlOptions((key) =>
    key === 'DB_MYSQL_DB' ? database : process.env[key],
  );

describe('e-sign schema database constraints', () => {
  jest.setTimeout(60_000);

  it('由 MySQL 保證 FK、必要結構 CHECK、unique 與 defaults', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const ds = new DataSource(optionsFor(database));
      await ds.initialize();
      try {
        await ds.runMigrations();
        await ds.query(
          `INSERT INTO hr_departments (department_name,start_date) VALUES ('資訊部','2026-01-01')`,
        );
        await ds.query(
          `INSERT INTO users (empid,name,department_id) VALUES ('E001','王小明',1)`,
        );
        await expectRejected(
          ds,
          `INSERT INTO users (empid,name,department_id) VALUES ('bad-fk','甲',999999)`,
        );
        await expectRejected(
          ds,
          `INSERT INTO users (empid,name) VALUES ('E001','重複')`,
        );

        await ds.query(
          `INSERT INTO esign_documents (doc_number,title,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000003','聘書',1)`,
        );
        const defaults = await ds.query<
          Array<{ watermark_enabled: number; allow_reject: number }>
        >(
          `SELECT watermark_enabled,allow_reject FROM esign_documents WHERE id=1`,
        );
        expect(Number(defaults[0]?.watermark_enabled)).toBe(0);
        expect(Number(defaults[0]?.allow_reject)).toBe(1);

        await ds.query(
          `INSERT INTO esign_signers (document_id,signer_type,user_id,empid_snapshot,name_snapshot) VALUES (1,'user',1,'E001','王小明')`,
        );
        await ds.query(
          `INSERT INTO esign_signers (document_id,signer_type,email,name_snapshot) VALUES (1,'email','candidate@example.com','候選人')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_signers (document_id,signer_type,name_snapshot) VALUES (1,'user','缺身分')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_signers (document_id,signer_type,user_id,email,empid_snapshot,name_snapshot) VALUES (1,'user',1,'x@example.com','E001','雙重身分')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_signers (document_id,signer_type,email,name_snapshot) VALUES (1,'email','CANDIDATE@EXAMPLE.COM','重複候選人')`,
        );
        await ds.query(
          `UPDATE esign_signers SET status='rejected',rejected_at=NOW(6) WHERE id=1`,
        );
        const signerStates = await ds.query<Array<{ status: string }>>(
          `SELECT status FROM esign_signers WHERE document_id=1 ORDER BY id`,
        );
        expect(signerStates.map(({ status }) => status)).toEqual([
          'rejected',
          'pending',
        ]);

        await expectRejected(
          ds,
          `INSERT INTO esign_signature_records (signer_id,document_sha256,signing_payload_sha256,consent_version,authentication_method,authentication_event_id,signed_at_utc) VALUES (999,'${'a'.repeat(64)}','${'b'.repeat(64)}','v1','INTRANET_SSO','auth-1',NOW(6))`,
        );
        await ds.query(
          `INSERT INTO esign_notification_batches (document_id,filter_type,target_count) VALUES (1,'all',1)`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_file_objects (file_purpose,object_key,mime_type,file_size,sha256) VALUES ('source_pdf','a','application/pdf',1,'${'a'.repeat(64)}')`,
        );
        const checks = await ds.query<Array<{ CONSTRAINT_NAME: string }>>(
          `SELECT CONSTRAINT_NAME FROM information_schema.table_constraints
            WHERE constraint_schema = ? AND constraint_type = 'CHECK'
            ORDER BY CONSTRAINT_NAME`,
          [database],
        );
        expect(checks.map(({ CONSTRAINT_NAME }) => CONSTRAINT_NAME)).toEqual([
          'chk_esign_file_objects_owner',
          'chk_esign_signers_identity',
        ]);
      } finally {
        await ds.destroy();
      }
    });
  });
});

async function expectRejected(ds: DataSource, sql: string): Promise<void> {
  await expect(ds.query(sql)).rejects.toBeDefined();
}
