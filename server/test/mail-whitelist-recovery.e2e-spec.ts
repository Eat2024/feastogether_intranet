import { DataSource } from 'typeorm';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';

describe('寄信白名單通知復原', () => {
  jest.setTimeout(60_000);
  it('只復原尚可重試的政策故障，排除跳過與耗盡但保留既有 SMTP 重試', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const ds = await new DataSource(
        buildMysqlOptions((key) =>
          key === 'DB_MYSQL_DB' ? database : process.env[key],
        ),
      ).initialize();
      try {
        await ds.runMigrations();
        await ds.query(
          "INSERT INTO users (empid,name) VALUES ('RECOVERY01','合成建立人')",
        );
        await ds.query(
          "INSERT INTO esign_documents (doc_number,title,created_by_user_id,status,sign_start_at,sign_end_at) VALUES (UUID(),'政策重試測試',1,'active',DATE_SUB(NOW(6),INTERVAL 1 DAY),DATE_ADD(NOW(6),INTERVAL 1 DAY))",
        );
        await ds.query(
          "INSERT INTO esign_notification_batches (document_id,filter_type,target_count) VALUES (1,'all',4)",
        );
        const cases = [
          {
            result: 'failed',
            error: 'MAIL_WHITELIST_CHECK_FAILED',
            attempts: 2,
          },
          {
            result: 'failed',
            error: 'MAIL_WHITELIST_CHECK_FAILED',
            attempts: 3,
          },
          {
            result: 'skipped',
            error: 'MAIL_RECIPIENT_NOT_WHITELISTED',
            attempts: 1,
          },
          { result: 'failed', error: 'MAIL_DELIVERY_FAILED', attempts: 5 },
        ];
        for (const [index, item] of cases.entries()) {
          const digest = String(index + 1).repeat(64);
          await ds.query(
            "INSERT INTO esign_signers (public_id,document_id,signer_type,email,name_snapshot,invitation_token_sha256,invitation_token_ciphertext,invitation_expires_at) VALUES (UUID(),1,'email',?,'合成人員',?,'synthetic-ciphertext',DATE_ADD(NOW(6),INTERVAL 1 DAY))",
            [`recovery${index}@example.test`, digest],
          );
          await ds.query(
            "INSERT INTO esign_notification_logs (batch_id,signer_id,channel,result,error_code,attempt_count,invitation_generation_sha256,next_attempt_at) VALUES (1,?,'email',?,?,?,?,NULL)",
            [index + 1, item.result, item.error, item.attempts, digest],
          );
        }
        const rows =
          await new NotificationRepository().findEligibleInvitationLogIds(
            new Date(),
            new Date(Date.now() - 600_000),
            ds.manager,
          );
        expect(rows.map((row) => Number(row.id))).toEqual([1, 4]);
      } finally {
        await ds.destroy();
      }
    });
  });
});
