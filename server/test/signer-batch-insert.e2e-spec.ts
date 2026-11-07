import { randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignSigner } from '#app/features/esign/entities/esign-signer.entity';
import { SignerRepository } from '#app/features/esign/repositories/signer.repository';
import { AuditSubscriber } from '#app/infrastructure/database/audit.subscriber';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';

async function fixture(
  run: (ds: DataSource, documentId: number, actorId: number) => Promise<void>,
) {
  await withSchemaTestDatabase(async ({ database }) => {
    const ds = await new DataSource(
      buildMysqlOptions((key) =>
        key === 'DB_MYSQL_DB' ? database : process.env[key],
      ),
    ).initialize();
    try {
      await ds.runMigrations();
      const actor = await ds.manager.save(User, {
        empid: 'SYN00001',
        name: '合成建立人',
      });
      const document = await ds.manager.save(EsignDocument, {
        docNumber: randomUUID(),
        title: '合成批次測試',
        createdByUserId: actor.id,
      });
      await run(ds, document.id, actor.id);
    } finally {
      await ds.destroy();
    }
  });
}
function signers(ds: DataSource, documentId: number, count: number) {
  return Array.from({ length: count }, (_, index) =>
    ds.manager.create(EsignSigner, {
      publicId: randomUUID(),
      documentId,
      signerType: 'email',
      email: `synthetic${index}@example.invalid`,
      nameSnapshot: `合成人員${index}`,
    }),
  );
}
describe('簽署人真正批次新增', () => {
  it('按publicId對應非連續生成ID、完整defaults與原順序，查詢數依批次成長且subscriber補actor', async () => {
    await fixture(async (ds, documentId, actorId) => {
      const cls = {
        isActive: () => true,
        get: () => ({ kind: 'employee', userId: actorId }),
      } as unknown as ClsService;
      new AuditSubscriber(ds, cls);
      const inputs = signers(ds, documentId, 501).reverse();
      const querySpy = jest.spyOn(ds.logger, 'logQuery');
      const result = await ds.transaction(async (manager) => {
        await manager.query('SET SESSION auto_increment_increment = 3');
        querySpy.mockClear();
        return new SignerRepository().insertMany(inputs, manager);
      });
      const queries = querySpy.mock.calls.map(([sql]) => sql);
      querySpy.mockRestore();
      expect(
        queries.filter((sql) => /^INSERT INTO `esign_signers`/i.test(sql)),
      ).toHaveLength(3);
      expect(queries.filter((sql) => /^SELECT /i.test(sql))).toHaveLength(3);
      expect(result.map((row) => row.publicId)).toEqual(
        inputs.map((row) => row.publicId),
      );
      expect(new Set(result.map((row) => row.id)).size).toBe(501);
      expect(result[1].id - result[0].id).toBe(3);
      for (const row of result) {
        expect(row).toBeInstanceOf(EsignSigner);
        expect(row).toMatchObject({
          status: 'pending',
          note: '',
          sortOrder: 0,
          completionStatus: null,
          deletedAt: null,
          createdByUserId: actorId,
          updatedByUserId: actorId,
        });
        expect(row.createdAt).toBeInstanceOf(Date);
        expect(row.updatedAt).toBeInstanceOf(Date);
      }
    });
  });
  it('無context保留明確actor，空集合不查詢', async () => {
    await fixture(async (ds, documentId, actorId) => {
      const cls = { isActive: () => false } as unknown as ClsService;
      new AuditSubscriber(ds, cls);
      const input = signers(ds, documentId, 1);
      input[0].createdByUserId = actorId;
      input[0].updatedByUserId = actorId;
      const repository = new SignerRepository();
      const result = await ds.transaction((manager) =>
        repository.insertMany(input, manager),
      );
      expect(result[0]).toMatchObject({
        createdByUserId: actorId,
        updatedByUserId: actorId,
      });
      const query = jest.spyOn(ds.logger, 'logQuery');
      expect(await repository.insertMany([], ds.manager)).toEqual([]);
      expect(query).not.toHaveBeenCalled();
      query.mockRestore();
    });
  });
  it('第二批唯一鍵失敗時外層交易回滾第一批，不留下部分簽署人', async () => {
    await fixture(async (ds, documentId) => {
      const input = signers(ds, documentId, 251);
      input[250].publicId = input[0].publicId;
      await expect(
        ds.transaction((manager) =>
          new SignerRepository().insertMany(input, manager),
        ),
      ).rejects.toMatchObject({ driverError: { code: 'ER_DUP_ENTRY' } });
      expect(await ds.manager.count(EsignSigner)).toBe(0);
    });
  });
});
