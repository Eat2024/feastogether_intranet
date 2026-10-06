import { CLS_AUDIT_USER_ID } from '#app/infrastructure/database/audit-user.context';
import {
  CLS_CLIENT_IP,
  CLS_USER_AGENT,
} from '#app/framework/http/request.context';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  AUDIT_TARGET_KIND,
} from '#app/features/auth/auth.constants';
import { buildChanges, AuditLogService } from './audit-log.service';

describe('buildChanges', () => {
  it('只輸出實際異動欄位，支援 scalar / array / object', () => {
    expect(
      buildChanges(
        { roleName: '舊', permissionIds: [1, 2], meta: { a: 1 }, same: true },
        { roleName: '新', permissionIds: [1, 3], meta: { a: 2 }, same: true },
      ),
    ).toEqual({
      roleName: ['舊', '新'],
      permissionIds: [
        [1, 2],
        [1, 3],
      ],
      meta: [{ a: 1 }, { a: 2 }],
    });
  });

  it('create / delete 以 null 表示空 snapshot', () => {
    expect(buildChanges(null, { roleName: '新' })).toEqual({
      roleName: [null, '新'],
    });
    expect(buildChanges({ roleName: '舊' }, null)).toEqual({
      roleName: ['舊', null],
    });
  });

  it('物件 key 順序不同但內容相同時不視為異動', () => {
    expect(
      buildChanges(
        { meta: { role: 'admin', flags: { a: true, b: false } } },
        { meta: { flags: { b: false, a: true }, role: 'admin' } },
      ),
    ).toEqual({});
  });
});

describe('AuditLogService', () => {
  const build = (clsValues: Record<string, string | undefined>) => {
    const repo = {
      saveManyWithTargets: jest.fn().mockResolvedValue(undefined),
    };
    const cls = {
      isActive: () => true,
      get: jest.fn((key: string) => clsValues[key]),
    } as never;
    return {
      service: new AuditLogService(repo as never, cls),
      repo,
    };
  };

  it('寫入含 actor / ip / ua / changes / primary target', async () => {
    const { service, repo } = build({
      [CLS_AUDIT_USER_ID]: '7',
      [CLS_CLIENT_IP]: '1.2.3.4',
      [CLS_USER_AGENT]: 'jest-agent',
    });

    await service.recordHistory({
      action: AUDIT_ACTION.ROLE_UPDATED,
      entityType: AUDIT_ENTITY.ROLE,
      entityId: 9,
      beforeSnapshot: { roleName: 'old' },
      afterSnapshot: { roleName: 'new' },
    });

    expect(repo.saveManyWithTargets).toHaveBeenCalledTimes(1);
    expect(repo.saveManyWithTargets).toHaveBeenCalledWith(
      [
        {
          log: expect.objectContaining({
            actorUserId: 7,
            action: AUDIT_ACTION.ROLE_UPDATED,
            entityType: AUDIT_ENTITY.ROLE,
            entityId: '9',
            changes: { roleName: ['old', 'new'] },
            beforeSnapshot: { roleName: 'old' },
            afterSnapshot: { roleName: 'new' },
            ipAddress: '1.2.3.4',
            userAgent: 'jest-agent',
          }) as Record<string, unknown>,
          targets: [
            {
              kind: AUDIT_TARGET_KIND.PRIMARY,
              type: AUDIT_ENTITY.ROLE,
              id: 9,
            },
          ],
        },
      ],
      undefined,
    );
  });

  it('可寫入 associated targets，並略過 null target', async () => {
    const { service, repo } = build({});
    await service.recordHistory({
      action: AUDIT_ACTION.USER_ROLE_UPDATED,
      entityType: AUDIT_ENTITY.USER,
      entityId: 1,
      beforeSnapshot: { roleId: null },
      afterSnapshot: { roleId: 2 },
      associatedTargets: [
        { type: AUDIT_ENTITY.ROLE, id: null },
        { type: AUDIT_ENTITY.ROLE, id: 2 },
      ],
    });

    const [[firstEntry]] = repo.saveManyWithTargets.mock.calls[0] as [
      Array<{ targets: unknown[] }>,
    ];
    expect(firstEntry.targets).toEqual([
      { kind: AUDIT_TARGET_KIND.PRIMARY, type: AUDIT_ENTITY.USER, id: 1 },
      { kind: AUDIT_TARGET_KIND.ASSOCIATED, type: AUDIT_ENTITY.ROLE, id: 2 },
    ]);
  });

  it('無實際 changes 時不寫入', async () => {
    const { service, repo } = build({});
    await service.recordHistory({
      action: AUDIT_ACTION.ROLE_UPDATED,
      entityType: AUDIT_ENTITY.ROLE,
      entityId: 1,
      beforeSnapshot: { roleName: 'same' },
      afterSnapshot: { roleName: 'same' },
    });
    expect(repo.saveManyWithTargets).not.toHaveBeenCalled();
  });

  it('recordHistoryBatch：多筆合成一次寫入，無異動者個別剔除', async () => {
    const { service, repo } = build({});
    await service.recordHistoryBatch([
      {
        action: AUDIT_ACTION.ROLE_UPDATED,
        entityType: AUDIT_ENTITY.ROLE,
        entityId: 1,
        beforeSnapshot: { roleName: 'a' },
        afterSnapshot: { roleName: 'b' },
      },
      // 無異動 → 不該佔一個位置，但也不該讓整批被跳過
      {
        action: AUDIT_ACTION.ROLE_UPDATED,
        entityType: AUDIT_ENTITY.ROLE,
        entityId: 2,
        beforeSnapshot: { roleName: 'same' },
        afterSnapshot: { roleName: 'same' },
      },
      {
        action: AUDIT_ACTION.ROLE_UPDATED,
        entityType: AUDIT_ENTITY.ROLE,
        entityId: 3,
        beforeSnapshot: { roleName: 'c' },
        afterSnapshot: { roleName: 'd' },
      },
    ]);

    expect(repo.saveManyWithTargets).toHaveBeenCalledTimes(1);
    const [entries] = repo.saveManyWithTargets.mock.calls[0] as [
      Array<{ log: { entityId: string } }>,
    ];
    expect(entries.map((e) => e.log.entityId)).toEqual(['1', '3']);
  });

  it('recordHistoryBatch：全部無異動 → 完全不觸發寫入', async () => {
    const { service, repo } = build({});
    await service.recordHistoryBatch([
      {
        action: AUDIT_ACTION.ROLE_UPDATED,
        entityType: AUDIT_ENTITY.ROLE,
        entityId: 1,
        beforeSnapshot: { roleName: 'same' },
        afterSnapshot: { roleName: 'same' },
      },
    ]);
    expect(repo.saveManyWithTargets).not.toHaveBeenCalled();
  });
});
