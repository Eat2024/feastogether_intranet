import type { EntityManager } from 'typeorm';
import { AuditEventRepository } from '../repositories/audit-event.repository';
import {
  auditEventHash,
  EsignAuditService,
  type AppendEsignAuditEvent,
} from './esign-audit.service';
import type { EsignAuditEvent } from '../entities/esign-audit-event.entity';

describe('同文件批次稽核', () => {
  const manager = {
    queryRunner: { isTransactionActive: true },
  } as EntityManager;
  const event = (index: number): AppendEsignAuditEvent => ({
    documentId: 10,
    eventType: index === 5001 ? 'document.initiated' : 'signer.assigned',
    occurredAt: new Date(1000 - index),
    metadata: { status: ' pending ', ...{ token: '不得保存' } },
  });
  const setup = () => {
    const repository = {
      lockDocument: jest.fn().mockResolvedValue({ id: 10 }),
      findLatestDocumentEvent: jest
        .fn()
        .mockResolvedValue({ eventHash: 'a'.repeat(64) }),
      insertMany: jest.fn().mockResolvedValue(undefined),
    };
    return {
      repository,
      service: new EsignAuditService(
        repository as unknown as AuditEventRepository,
      ),
    };
  };
  it('5002筆只鎖一次、讀鏈尾一次，依輸入順序接續既有hash且裁切metadata', async () => {
    const { service, repository } = setup();
    const inputs = Array.from({ length: 5002 }, (_, index) => event(index));
    const hashes = await service.appendMany(inputs, manager);
    expect(repository.lockDocument).toHaveBeenCalledTimes(1);
    expect(repository.findLatestDocumentEvent).toHaveBeenCalledTimes(1);
    expect(repository.insertMany).toHaveBeenCalledTimes(1);
    const calls = repository.insertMany.mock.calls as unknown as Array<
      [EsignAuditEvent[], EntityManager]
    >;
    const rows = calls[0][0];
    expect(repository.findLatestDocumentEvent).toHaveBeenCalledWith(
      10,
      manager,
      true,
    );
    let previous = 'a'.repeat(64);
    rows.forEach((row, index) => {
      expect(row.metadataJson).toEqual({ status: 'pending' });
      expect(row.previousEventHash).toBe(previous);
      expect(row.eventHash).toBe(
        auditEventHash(previous, {
          ...inputs[index],
          metadata: { status: 'pending' },
        }),
      );
      expect(hashes[index]).toBe(row.eventHash);
      previous = row.eventHash;
    });
    expect(rows).toHaveLength(5002);
    expect(rows.at(-1)?.eventType).toBe('document.initiated');
  });
  it('空集合不查詢；混文件與非交易在寫入前拒絕', async () => {
    const { service, repository } = setup();
    expect(await service.appendMany([], manager)).toEqual([]);
    await expect(
      service.appendMany([event(0), { ...event(1), documentId: 11 }], manager),
    ).rejects.toThrow();
    await expect(
      service.appendMany([event(0)], {} as EntityManager),
    ).rejects.toThrow();
    expect(repository.lockDocument).not.toHaveBeenCalled();
    expect(repository.insertMany).not.toHaveBeenCalled();
  });
  it('文件不存在或寫入失敗往上拋出，交由呼叫端交易回滾', async () => {
    const { service, repository } = setup();
    repository.lockDocument.mockResolvedValueOnce(null);
    await expect(service.appendMany([event(0)], manager)).rejects.toMatchObject(
      { status: 404 },
    );
    expect(repository.insertMany).not.toHaveBeenCalled();
    repository.insertMany.mockRejectedValueOnce(new Error('合成寫入錯誤'));
    await expect(service.appendMany([event(0)], manager)).rejects.toThrow(
      '合成寫入錯誤',
    );
  });
  it('repository以500筆分批insert，不做逐筆save或改序', async () => {
    const builder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      updateEntity: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    const repository = new AuditEventRepository();
    const rows = Array.from({ length: 1001 }, (_, id) => ({
      eventHash: String(id),
    }));
    await repository.insertMany(rows, {
      createQueryBuilder: () => builder,
    } as unknown as EntityManager);
    const calls = builder.values.mock.calls as unknown as Array<[unknown[]]>;
    expect(calls.map((call) => call[0].length)).toEqual([500, 500, 1]);
    expect(calls.flatMap((call) => call[0])).toEqual(rows);
    expect(builder.updateEntity).toHaveBeenCalledTimes(3);
    expect(builder.updateEntity).toHaveBeenCalledWith(false);
    expect(builder.execute).toHaveBeenCalledTimes(3);
  });
});
