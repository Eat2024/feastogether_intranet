import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { User } from '#app/features/users/entities/user.entity';
import { EsignDocument } from '#app/features/esign/entities/esign-document.entity';
import { EsignAuditEvent } from '#app/features/esign/entities/esign-audit-event.entity';
import {
  EsignAuditService,
  auditEventHash,
} from '#app/features/esign/services/esign-audit.service';
import { AuditEventRepository } from '#app/features/esign/repositories/audit-event.repository';
import { buildMysqlOptions } from '#app/infrastructure/database/mysql/mysql.options';
import { withSchemaTestDatabase } from '#app/infrastructure/database/test/schema-test-database';

it('批次稽核跨500筆仍接續原鏈，後批寫入失敗時整批回滾', async () => {
  await withSchemaTestDatabase(async ({ database }) => {
    const ds = await new DataSource(
      buildMysqlOptions((key) =>
        key === 'DB_MYSQL_DB' ? database : process.env[key],
      ),
    ).initialize();
    try {
      await ds.runMigrations();
      const owner = await ds.manager.save(User, {
        empid: 'AUDIT0001',
        name: '合成建立人',
        isActive: true,
      });
      const document = await ds.manager.save(EsignDocument, {
        docNumber: randomUUID(),
        title: '合成稽核',
        status: 'draft',
        createdByUserId: owner.id,
      });
      const service = new EsignAuditService(new AuditEventRepository());
      const event = (index: number) => ({
        documentId: document.id,
        actorUserId: owner.id,
        eventType: 'signer.assigned',
        occurredAt: new Date(100000 - index),
        metadata: { status: 'pending' },
      });
      await ds.transaction((manager) => service.append(event(0), manager));
      await ds.transaction((manager) =>
        service.appendMany(
          Array.from({ length: 501 }, (_, index) => event(index + 1)),
          manager,
        ),
      );
      const rows = await ds.manager.find(EsignAuditEvent, {
        where: { documentId: document.id },
        order: { id: 'ASC' },
      });
      expect(rows).toHaveLength(502);
      let previous: string | null = null;
      rows.forEach((row) => {
        expect(row.previousEventHash ?? null).toBe(previous);
        expect(row.eventHash).toBe(
          auditEventHash(previous, { ...row, metadata: row.metadataJson }),
        );
        previous = row.eventHash;
      });
      await expect(
        ds.transaction((manager) =>
          service.appendMany(
            Array.from({ length: 501 }, (_, index) => ({
              ...event(index),
              ...(index === 500 ? { actorUserId: 99999999 } : {}),
            })),
            manager,
          ),
        ),
      ).rejects.toThrow();
      expect(
        await ds.manager.find(EsignAuditEvent, {
          where: { documentId: document.id },
          order: { id: 'ASC' },
        }),
      ).toEqual(rows);
      // 呼叫端先建立 RR 舊快照，另一交易再追加；批次必須讀到最新鏈尾。
      await ds.transaction('REPEATABLE READ', async (manager) => {
        await manager.count(EsignAuditEvent);
        await ds.transaction((other) => service.append(event(700), other));
        await service.appendMany([event(701)], manager);
      });
      const tail = await ds.manager.find(EsignAuditEvent, {
        where: { documentId: document.id },
        order: { id: 'DESC' },
        take: 2,
      });
      expect(tail[0].previousEventHash).toBe(tail[1].eventHash);
    } finally {
      await ds.destroy();
    }
  });
}, 120000);
