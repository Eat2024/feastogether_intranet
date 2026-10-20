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
          `INSERT INTO auth_sessions (user_id,status,source,source_jti_hash,assertion_expires_at)
            VALUES (1,'validating','webview','${'a'.repeat(64)}',NOW(3))`,
        );
        await expectRejected(
          ds,
          `INSERT INTO auth_sessions (status,source_jti_hash,assertion_expires_at)
            VALUES ('validating','${'a'.repeat(64)}',NOW(3))`,
        );
        await expectRejected(
          ds,
          `INSERT INTO auth_sessions (status,source_jti_hash,assertion_expires_at)
            VALUES ('unknown','${'b'.repeat(64)}',NOW(3))`,
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
        expect(Number(defaults[0]?.allow_reject)).toBe(0);
        await ds.query(
          `UPDATE esign_documents SET sign_start_at='2026-01-01' WHERE id=1`,
        );
        await expectRejected(
          ds,
          `UPDATE esign_documents SET status='active' WHERE id=1`,
        );
        await ds.query(
          `UPDATE esign_documents SET status='expired',sign_end_at='2026-12-31' WHERE id=1`,
        );
        await expectRejected(
          ds,
          `UPDATE esign_documents SET status='unknown' WHERE id=1`,
        );
        await expectRejected(
          ds,
          `UPDATE esign_documents SET sign_start_at=NOW(6),sign_end_at=DATE_SUB(NOW(6), INTERVAL 1 SECOND) WHERE id=1`,
        );

        await ds.query(
          `INSERT INTO esign_signers (public_id,document_id,signer_type,user_id,empid_snapshot,name_snapshot) VALUES ('00000000-0000-4000-8000-000000000001',1,'user',1,'E001','王小明')`,
        );
        await ds.query(
          `INSERT INTO esign_signers (public_id,document_id,signer_type,email,name_snapshot) VALUES ('00000000-0000-4000-8000-000000000002',1,'email','candidate@example.com','候選人')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_signers (public_id,document_id,signer_type,name_snapshot) VALUES ('00000000-0000-4000-8000-000000000003',1,'user','缺身分')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_signers (public_id,document_id,signer_type,user_id,email,empid_snapshot,name_snapshot) VALUES ('00000000-0000-4000-8000-000000000004',1,'user',1,'x@example.com','E001','雙重身分')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_signers (public_id,document_id,signer_type,email,name_snapshot) VALUES ('00000000-0000-4000-8000-000000000005',1,'email','CANDIDATE@EXAMPLE.COM','重複候選人')`,
        );
        await expectRejected(
          ds,
          `UPDATE esign_signers SET status='rejected',rejected_at=NOW(6) WHERE id=1`,
        );
        await ds.query(
          `UPDATE esign_signers SET status='signed',signed_at=NOW(6),completion_status='pending' WHERE id=1`,
        );
        const signerStates = await ds.query<Array<{ status: string }>>(
          `SELECT status FROM esign_signers WHERE document_id=1 ORDER BY id`,
        );
        expect(signerStates.map(({ status }) => status)).toEqual([
          'signed',
          'pending',
        ]);

        await ds.query(
          `INSERT INTO esign_document_fields (document_id,field_type,page_number,x_percent,y_percent,width_percent,height_percent)
            VALUES (1,'signature',1,10,10,20,10)`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_document_fields (document_id,field_type,page_number,x_percent,y_percent,width_percent,height_percent)
            VALUES (1,'signature',1,90,10,20,10)`,
        );

        await expectRejected(
          ds,
          `INSERT INTO esign_signature_records (signer_id,document_sha256,signing_payload_sha256,consent_version,authentication_method,authentication_event_id,signed_at_utc) VALUES (999,'${'a'.repeat(64)}','${'b'.repeat(64)}','v1','INTRANET_SSO','auth-1',NOW(6))`,
        );
        await ds.query(
          `INSERT INTO esign_signature_records (signer_id,document_sha256,signing_payload_sha256,consent_version,authentication_method,authentication_event_id,signed_at_utc) VALUES (1,'${'a'.repeat(64)}','${'b'.repeat(64)}','v1','employee_session','auth-2',NOW(6))`,
        );
        await ds.query(
          `INSERT INTO esign_notification_batches (document_id,filter_type,target_count) VALUES (1,'external_invitation',1)`,
        );
        await ds.query(
          `INSERT INTO esign_notification_logs (batch_id,signer_id,channel,result) VALUES (1,2,'email','pending')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_notification_logs (batch_id,signer_id,channel,result) VALUES (1,1,'sms','pending')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_file_objects (file_purpose,object_key,mime_type,file_size,sha256) VALUES ('source_pdf','a','application/pdf',1,'${'a'.repeat(64)}')`,
        );
        await ds.query(
          `INSERT INTO esign_file_objects (document_id,file_purpose,object_key,mime_type,file_size,sha256) VALUES (1,'source_pdf','source-a','application/pdf',1,'${'a'.repeat(64)}')`,
        );
        await ds.query(
          `INSERT INTO esign_file_objects (signature_record_id,document_field_id,file_purpose,object_key,mime_type,file_size,sha256)
            VALUES ((SELECT id FROM esign_signature_records WHERE signer_id=1),(SELECT id FROM esign_document_fields WHERE document_id=1 LIMIT 1),'signature_png','signature-a','image/png',1,'${'b'.repeat(64)}')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_file_objects (signature_record_id,file_purpose,object_key,mime_type,file_size,sha256)
            VALUES ((SELECT id FROM esign_signature_records WHERE signer_id=1),'signature_png','signature-without-field','image/png',1,'${'b'.repeat(64)}')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_file_objects (document_id,file_purpose,object_key,mime_type,file_size,sha256) VALUES (1,'source_pdf','duplicate-source','application/pdf',1,'${'a'.repeat(64)}')`,
        );
        await ds.query(
          `INSERT INTO esign_signature_records (signer_id,document_sha256,signing_payload_sha256,consent_version,authentication_method,authentication_event_id,signed_at_utc) VALUES (2,'${'a'.repeat(64)}','${'b'.repeat(64)}','v1','email_invitation','auth-second',NOW(6))`,
        );
        await ds.query(
          `INSERT INTO esign_file_objects (signature_record_id,file_purpose,object_key,mime_type,file_size,sha256) VALUES ((SELECT id FROM esign_signature_records WHERE signer_id=2),'completed_pdf','second-personal-copy','application/pdf',1,'${'e'.repeat(64)}')`,
        );
        // 同文件的文件層級完成檔與個人副本可共存；各自仍只有一份。
        await ds.query(`INSERT INTO esign_file_objects (document_id,file_purpose,object_key,mime_type,file_size,sha256)
          VALUES (1,'completed_pdf','document-copy','application/pdf',1,'${'c'.repeat(64)}')`);
        await ds.query(`INSERT INTO esign_file_objects (signature_record_id,file_purpose,object_key,mime_type,file_size,sha256)
          VALUES ((SELECT id FROM esign_signature_records WHERE signer_id=1),'completed_pdf','personal-copy','application/pdf',1,'${'d'.repeat(64)}')`);
        await expectRejected(
          ds,
          `INSERT INTO esign_file_objects (signature_record_id,file_purpose,object_key,mime_type,file_size,sha256)
          VALUES ((SELECT id FROM esign_signature_records WHERE signer_id=1),'completed_pdf','duplicate-personal','application/pdf',1,'${'d'.repeat(64)}')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_file_objects (document_id,file_purpose,object_key,mime_type,file_size,sha256)
          VALUES (1,'completed_pdf','duplicate-document','application/pdf',1,'${'d'.repeat(64)}')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_file_objects (document_id,signature_record_id,file_purpose,object_key,mime_type,file_size,sha256)
          VALUES (1,(SELECT id FROM esign_signature_records WHERE signer_id=1),'completed_pdf','double-owner','application/pdf',1,'${'d'.repeat(64)}')`,
        );
        await expectRejected(
          ds,
          `INSERT INTO esign_file_objects (file_purpose,object_key,mime_type,file_size,sha256)
          VALUES ('completed_pdf','no-owner','application/pdf',1,'${'d'.repeat(64)}')`,
        );
        await expectRejected(
          ds,
          `UPDATE esign_signers SET completion_status='processing' WHERE id=1`,
        );
        await expectRejected(
          ds,
          `UPDATE esign_signers SET completion_status='ready' WHERE id=1`,
        );
        await expectRejected(
          ds,
          `UPDATE esign_signers SET completion_status='pending' WHERE id=2`,
        );
        await ds.query(
          `UPDATE esign_signers SET completion_status='ready',completion_ready_at=NOW(6) WHERE id=1`,
        );
        const checks = await ds.query<Array<{ CONSTRAINT_NAME: string }>>(
          `SELECT CONSTRAINT_NAME FROM information_schema.table_constraints
            WHERE constraint_schema = ? AND constraint_type = 'CHECK'
            ORDER BY CONSTRAINT_NAME`,
          [database],
        );
        expect(checks.map(({ CONSTRAINT_NAME }) => CONSTRAINT_NAME)).toEqual([
          'chk_auth_sessions_status',
          'chk_esign_document_fields_bounds',
          'chk_esign_document_fields_page',
          'chk_esign_document_fields_type',
          'chk_esign_documents_sign_period',
          'chk_esign_documents_status',
          'chk_esign_file_objects_completed_owner',
          'chk_esign_file_objects_owner',
          'chk_esign_file_objects_signature_field',
          'chk_esign_file_objects_source_owner',
          'chk_esign_notification_logs_channel',
          'chk_esign_notification_logs_result',
          'chk_esign_signers_completion',
          'chk_esign_signers_identity',
          'chk_esign_signers_status',
          'chk_esign_signers_terminal_times',
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
