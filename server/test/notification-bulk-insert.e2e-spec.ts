import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { EsignNotificationBatch } from '#app/features/esign/entities/esign-notification-batch.entity';
import { EsignNotificationLog } from '#app/features/esign/entities/esign-notification-log.entity';
import { NotificationRepository } from '#app/features/esign/repositories/notification.repository';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';

describe('通知初建真正批次寫入', () => {
  jest.setTimeout(60000);
  it('跨批保序、使用完整唯一鍵回查非連續 ID，保存缺信箱／外部邀請世代與所有欄位', async () => {
    await withSchemaTestDatabase(async ({ database }) => {
      const ds = await new DataSource(
        buildMysqlOptions((key) =>
          key === 'DB_MYSQL_DB' ? database : process.env[key],
        ),
      ).initialize();
      try {
        await ds.runMigrations();
        const runner = ds.createQueryRunner();
        await runner.connect();
        try {
          await runner.startTransaction();
          const manager = runner.manager;
          const user = await manager.save(User, {
            empid: 'BULK0001',
            name: '合成員工',
            isActive: true,
          });
          const document = await manager.save(EsignDocument, {
            docNumber: randomUUID(),
            title: '合成批次文件',
            status: 'active',
            signStartAt: new Date('2026-01-01T00:00:00Z'),
            signEndAt: new Date('2026-12-31T00:00:00Z'),
            createdByUserId: user.id,
          });
          const batches = await manager.save(
            EsignNotificationBatch,
            [0, 1].map(() =>
              manager.create(EsignNotificationBatch, {
                documentId: document.id,
                filterType: 'all',
                targetCount: 251,
                kind: 'invitation',
              }),
            ),
          );
          await manager.insert(
            EsignSigner,
            Array.from({ length: 251 }, (_, index) => ({
              publicId: randomUUID(),
              documentId: document.id,
              signerType: index === 250 ? 'user' : 'email',
              userId: index === 250 ? user.id : null,
              empidSnapshot: index === 250 ? user.empid : null,
              email: index === 250 ? null : `bulk${index}@example.invalid`,
              nameSnapshot: '合成外部簽署人',
              sortOrder: index,
            })),
          );
          const signers = await manager.find(EsignSigner, {
            where: { documentId: document.id },
            order: { id: 'DESC' },
          });
          const time = new Date('2026-01-01T00:00:00.123Z');
          const logs = batches.flatMap((batch, b) =>
            signers.map((signer, i) =>
              manager.create(EsignNotificationLog, {
                batchId: batch.id,
                signerId: signer.id,
                channel: 'email',
                result: i === 0 ? 'skipped' : 'pending',
                errorCode: i === 0 ? 'RECIPIENT_UNAVAILABLE' : null,
                completedAt: i === 0 ? time : undefined,
                invitationGenerationSha256:
                  i === 0 ? null : String(b + 1).repeat(64),
                attemptCount: i === 1 ? 2 : 0,
                nextAttemptAt: time,
                processingStartedAt: time,
                dispatchDate: '2026-01-01',
                leaseToken: randomUUID(),
                reminderTokenSha256: null,
                reminderTokenCiphertext: 'synthetic-ciphertext',
                reminderExpiresAt: time,
                attemptHistoryJson: [
                  {
                    status: 'failed',
                    at: time.toISOString(),
                    reasonCode: 'SYNTHETIC',
                  },
                ],
              }),
            ),
          );
          await manager.query('SET SESSION auto_increment_increment = 7');
          let beforeInserts = 0;
          let afterInserts = 0;
          ds.subscribers.push({
            beforeInsert: (event) => {
              if (event.entity instanceof EsignNotificationLog) beforeInserts++;
            },
            afterInsert: (event) => {
              if (event.entity instanceof EsignNotificationLog) afterInserts++;
            },
          });
          const queries = jest.spyOn(ds.logger, 'logQuery');
          let persisted: EsignNotificationLog[];
          try {
            persisted = await new NotificationRepository().insertLogs(
              logs,
              manager,
            );
            const sql = queries.mock.calls.map(([query]) => query);
            expect(
              sql.filter((query) => query.startsWith('INSERT INTO')),
            ).toHaveLength(3);
            expect(
              sql.filter((query) => query.startsWith('SELECT')),
            ).toHaveLength(3);
          } finally {
            queries.mockRestore();
          }
          expect(persisted).toHaveLength(502);
          expect(beforeInserts).toBe(502);
          expect(afterInserts).toBe(502);
          for (const [index, log] of persisted.entries()) {
            expect(log).toMatchObject(
              Object.fromEntries(
                Object.entries(logs[index]).filter(
                  ([, value]) => value !== undefined,
                ),
              ),
            );
            expect(log.id).toEqual(expect.any(Number));
            expect(log.createdAt).toBeInstanceOf(Date);
            expect(log).toEqual(
              await manager.findOneByOrFail(EsignNotificationLog, {
                id: log.id,
              }),
            );
          }
          expect(persisted[1].id - persisted[0].id).toBe(7);
          expect(
            await new NotificationRepository().insertLogs([], manager),
          ).toEqual([]);
          await runner.rollbackTransaction();
        } finally {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.query('SET SESSION auto_increment_increment = 1');
          await runner.release();
        }
      } finally {
        await ds.destroy();
      }
    });
  });
});
