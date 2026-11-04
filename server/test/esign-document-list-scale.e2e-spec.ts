import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { EsignViewMapper } from '#app/features/esign/services/esign-view.mapper';
import { DocumentRepository } from '#app/features/esign/repositories/document.repository';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';

/** 重現 UAT：22 份文件、256 KiB sort buffer，以及 deleted_at 索引後 filesort。 */
describe('文件列表大型快照回歸', () => {
  jest.setTimeout(60000);

  it('排序不攜帶完整簽署快照，保留原始截止時間與文件順序', async () => {
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
          await runner.query('SET SESSION sort_buffer_size = 262144');
          const manager = runner.manager;
          const creator = await manager.save(User, {
            empid: 'LIST0001',
            name: '合成建立人',
            departmentCode: 'LIST',
          });
          const originalEnd = '2026-11-01T00:00:00.000Z';
          const largePayload = {
            period: { endAt: originalEnd },
            signers: Array.from({ length: 5000 }, (_, i) => ({
              id: String(i),
              publicId: randomUUID(),
              name: '合成簽署人',
              email: `synthetic${i}@example.invalid`,
              department: '合成部門'.repeat(20),
              title: '合成職稱',
            })),
          };
          expect(
            Buffer.byteLength(JSON.stringify(largePayload)),
          ).toBeGreaterThan(262144);
          const documents: EsignDocument[] = [];
          for (let i = 0; i < 22; i++) {
            documents.push(
              await manager.save(EsignDocument, {
                docNumber: randomUUID(),
                title: `合成文件${i}`,
                createdByUserId: creator.id,
                createdByDepartmentCode: 'LIST',
                status: 'active',
                signStartAt: new Date('2026-01-01T00:00:00Z'),
                signEndAt: new Date('2026-12-01T00:00:00Z'),
                updatedAt: new Date('2026-11-03T00:00:00Z'),
                signingPayloadJson:
                  i === 0 ? largePayload : { period: { endAt: originalEnd } },
              }),
            );
          }
          const signerRows = Array.from({ length: 5000 }, (_, i) => ({
            publicId: randomUUID(),
            documentId: documents[0].id,
            signerType: 'email',
            email: `signer${i}@example.invalid`,
            nameSnapshot: '合成簽署人',
            status: i < 3000 ? 'pending' : i < 4000 ? 'signed' : 'rejected',
            completionStatus: i >= 3000 && i < 4000 ? 'pending' : null,
            signedAt: i >= 3000 && i < 4000 ? new Date() : null,
            rejectedAt: i >= 4000 ? new Date() : null,
            rejectRequestId: i >= 4000 ? randomUUID() : null,
            rejectReason: i >= 4000 ? '合成拒簽原因' : null,
          }));
          for (let offset = 0; offset < signerRows.length; offset += 250) {
            await manager.insert(
              EsignSigner,
              signerRows.slice(offset, offset + 250),
            );
          }
          await manager.insert(EsignSigner, {
            publicId: randomUUID(),
            documentId: documents[0].id,
            signerType: 'email',
            email: 'deleted@example.invalid',
            nameSnapshot: '合成刪除簽署人',
            status: 'pending',
            deletedAt: new Date(),
          });
          const otherCreator = await manager.save(User, {
            empid: 'OTHER0001',
            name: '其他部門建立人',
          });
          await manager.save(EsignDocument, {
            docNumber: randomUUID(),
            title: '其他部門文件',
            createdByUserId: otherCreator.id,
            createdByDepartmentCode: 'OTHER',
          });
          const deleted = await manager.save(EsignDocument, {
            docNumber: randomUUID(),
            title: '已刪除文件',
            createdByUserId: creator.id,
            createdByDepartmentCode: 'LIST',
            deletedAt: new Date(),
          });
          // 固定成線上已觀察到的執行計畫；不依賴本機 optimizer 的索引選擇。
          const query = runner.query.bind(runner);
          const querySpy = jest
            .spyOn(runner, 'query')
            .mockImplementation(
              (sql: string, parameters?: unknown[], structured?: boolean) =>
                query(
                  sql.replace(
                    /FROM `esign_documents` `([^`]+)`/g,
                    '$& USE INDEX (`idx_esign_documents_deleted_at`)',
                  ),
                  parameters,
                  structured,
                ),
            );
          try {
            const repository = new DocumentRepository();
            const mapper = new EsignViewMapper({
              verificationUrl: () => null,
            } as never);
            const readers = [
              () => repository.findByDepartment('LIST', manager),
              () => repository.findListCreatedByUser(creator.id, manager),
              () =>
                repository.findListByIds(
                  [...documents.map((row) => row.id), deleted.id],
                  manager,
                ),
            ];
            for (const read of readers) {
              querySpy.mockClear();
              const rows = await read();
              expect(querySpy).toHaveBeenCalledTimes(2);
              expect(rows.map((row) => row.id)).toEqual(
                documents.map((row) => row.id).reverse(),
              );
              for (const row of rows) {
                expect(row.signingPayloadJson).toEqual({
                  period: { endAt: originalEnd },
                });
                expect(
                  mapper.documentListItem(
                    row,
                    { pendingCount: 1, signedCount: 0 },
                    creator,
                    new Date('2026-11-03T00:00:00Z'),
                    creator.id,
                  ),
                ).toMatchObject({
                  originalSignEndAt: originalEnd,
                  isReopened: true,
                  isCreator: true,
                  signEndAt: '2026-12-01T00:00:00.000Z',
                  status: 'active',
                });
              }
            }
            querySpy.mockClear();
            const counts = await new SignerRepository().countsByDocumentIds(
              documents.map((row) => row.id),
              manager,
            );
            expect(querySpy).toHaveBeenCalledTimes(1);
            expect(counts.get(documents[0].id)).toEqual({
              pendingCount: 3000,
              signedCount: 1000,
            });
            expect(counts.has(documents[1].id)).toBe(false);
            querySpy.mockClear();
            expect(await repository.findListByIds([], manager)).toEqual([]);
            expect(
              await new SignerRepository().countsByDocumentIds([], manager),
            ).toEqual(new Map());
            expect(querySpy).not.toHaveBeenCalled();

            // JSON null、缺少或非字串的原始時間，沿用 mapper 的 null 規則。
            for (const payload of [
              {},
              { period: { endAt: null } },
              { period: { endAt: 123 } },
            ]) {
              await manager.update(EsignDocument, documents[1].id, {
                signingPayloadJson: payload,
              });
              const [row] = await repository.findListByIds(
                [documents[1].id],
                manager,
              );
              expect(
                mapper.documentListItem(
                  row,
                  { pendingCount: 0, signedCount: 0 },
                  creator,
                ),
              ).toMatchObject({
                originalSignEndAt: null,
                isReopened: false,
              });
            }
            // 同一筆列表 SQL 推導背景狀態，不載入任務的大型 JSON。
            const draft = await manager.save(EsignDocument, {
              docNumber: randomUUID(),
              title: '背景發起測試',
              createdByUserId: creator.id,
              createdByDepartmentCode: 'LIST',
              status: 'draft',
            });
            await manager.query(
              `INSERT INTO esign_initiation_jobs
                (public_id, document_id, created_by_user_id, request_key, request_hash,
                 input_json, document_version_json, total_count, accepted_at, deadline_at)
               VALUES (?, ?, ?, ?, ?, '{}', '{}', 1, UTC_TIMESTAMP(6),
                 DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 HOUR))`,
              [
                randomUUID(),
                draft.id,
                creator.id,
                randomUUID(),
                'a'.repeat(64),
              ],
            );
            const readStatus = async () => {
              const [row] = await repository.findListByIds([draft.id], manager);
              return mapper.documentListItem(
                row,
                { pendingCount: 0, signedCount: 0 },
                creator,
              ).status;
            };
            expect(await readStatus()).toBe('initiating');
            await manager.query(
              `UPDATE esign_initiation_jobs SET status = 'processing', stage = 'resolving',
                lease_token = ?, lease_expires_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE)
                WHERE document_id = ?`,
              [randomUUID(), draft.id],
            );
            expect(await readStatus()).toBe('initiating');
            await manager.query(
              `UPDATE esign_initiation_jobs SET status = 'failed', stage = 'failed',
                error_code = 'TEST_FAILURE', completed_at = UTC_TIMESTAMP(6),
                lease_token = NULL, lease_expires_at = NULL WHERE document_id = ?`,
              [draft.id],
            );
            expect(await readStatus()).toBe('draft');
          } finally {
            querySpy.mockRestore();
          }
        } finally {
          await runner.release();
        }
      } finally {
        await ds.destroy();
      }
    });
  });
});
