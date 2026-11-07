import { AuditLogService, buildChanges } from './audit-log.service';

const manager = { queryRunner: { isTransactionActive: true } };

describe('AuditLogService', () => {
  it('以欄位差異寫入通用 audit log，並保留呼叫端裁切後的快照', async () => {
    const logs = { append: jest.fn().mockResolvedValue(undefined) };
    const service = new AuditLogService(logs as never);

    await service.record(
      {
        action: 'role.updated',
        entityType: 'role',
        entityId: 7,
        actorKind: 'super_user',
        source: 'http',
        moduleKey: 'esign',
        beforeSnapshot: { roleName: '舊名稱', isActive: true },
        afterSnapshot: { roleName: '新名稱', isActive: true },
      },
      manager as never,
    );

    expect(logs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role.updated',
        entityType: 'role',
        entityId: '7',
        changes: { roleName: ['舊名稱', '新名稱'] },
        beforeSnapshot: { roleName: '舊名稱', isActive: true },
        afterSnapshot: { roleName: '新名稱', isActive: true },
      }),
      manager,
    );
  });

  it('快照沒有差異時不寫入', async () => {
    const logs = { append: jest.fn() };
    const service = new AuditLogService(logs as never);

    await service.record(
      {
        action: 'role.updated',
        entityType: 'role',
        entityId: '7',
        actorKind: 'operator',
        source: 'repl',
        beforeSnapshot: { roleName: '相同' },
        afterSnapshot: { roleName: '相同' },
      },
      manager as never,
    );

    expect(logs.append).not.toHaveBeenCalled();
  });

  it('拒絕在業務交易外寫入', async () => {
    const service = new AuditLogService({ append: jest.fn() } as never);

    await expect(
      service.record(
        {
          action: 'role.created',
          entityType: 'role',
          entityId: '7',
          actorKind: 'system',
          source: 'migration',
          beforeSnapshot: null,
          afterSnapshot: { roleName: '建立' },
        },
        { queryRunner: { isTransactionActive: false } } as never,
      ),
    ).rejects.toThrow('稽核必須在業務交易內寫入');
  });

  it('拒絕明顯敏感欄位進入通用快照', async () => {
    const service = new AuditLogService({ append: jest.fn() } as never);

    await expect(
      service.record(
        {
          action: 'role.updated',
          entityType: 'role',
          entityId: '7',
          actorKind: 'super_user',
          source: 'http',
          beforeSnapshot: null,
          afterSnapshot: { roleName: '管理者', accessToken: 'secret' },
        },
        manager as never,
      ),
    ).rejects.toThrow('稽核 snapshot 含疑似敏感欄位：accessToken');
  });
});

describe('buildChanges', () => {
  it('新增、修改與移除欄位皆使用 [before, after]，未變欄位省略', () => {
    expect(
      buildChanges(
        { kept: true, changed: 1, removed: 'value' },
        { kept: true, changed: 2, added: 'value' },
      ),
    ).toEqual({
      changed: [1, 2],
      removed: ['value', null],
      added: [null, 'value'],
    });
  });
});
