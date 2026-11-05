import { AppErrorCode } from '#app/common/errors/app-error-code';
import type { AuthSecurityEvent } from '../entities/auth-security-event.entity';
import type { SuperUserAccess } from '../entities/super-user-access.entity';
import { AuthSecurityEventService } from './auth-security-event.service';
import { SuperUserCredentialsService } from './super-user-credentials.service';

const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const ACTIVATED_AT = new Date('2026-11-02T01:00:00Z');

/**
 * 以記憶體模擬 singleton、維護會話撤銷與安全事件：transaction 失敗時還原快照，等同 MySQL rollback。
 * 撤銷的實際 SQL 範圍（只撤 active 維護會話、不動員工）由 super-user-console e2e 對真實 MySQL 驗證。
 */
function setup(access: Partial<SuperUserAccess> | null) {
  let state = {
    access: access && {
      id: 1,
      activeCredentialFingerprint: OLD,
      credentialGeneration: 1,
      credentialActivatedAt: ACTIVATED_AT,
      ...access,
    },
    superUserSessionsRevokedAt: [] as Date[],
    events: [] as Array<Partial<AuthSecurityEvent>>,
  };
  const failures: { eventType?: string } = {};
  const manager = {};
  const mysql = {
    transaction: async <T>(run: (m: object) => Promise<T>) => {
      const snapshot = structuredClone(state);
      try {
        return await run(manager);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };
  const accessRepository = {
    findForUpdate: () => Promise.resolve(state.access),
    save: (row: typeof state.access) => {
      state.access = row;
      return Promise.resolve(row);
    },
  };
  const sessions = {
    revokeActiveSuperUser: (revokedAt: Date) => {
      state.superUserSessionsRevokedAt.push(revokedAt);
      return Promise.resolve();
    },
  };
  const events = new AuthSecurityEventService(
    mysql as never,
    {
      append: (event: Partial<AuthSecurityEvent>) => {
        if (event.eventType === failures.eventType) {
          return Promise.reject(new Error('事件寫入失敗'));
        }
        state.events.push(event);
        return Promise.resolve();
      },
    } as never,
    { isActive: () => false } as never,
    { warn: jest.fn() } as never,
  );
  /** 載入指定本機設定的實例；同一份 state 代表共用的 DB。 */
  const instance = (fingerprint: string) =>
    new SuperUserCredentialsService(
      mysql as never,
      accessRepository as never,
      sessions as never,
      { fingerprint } as never,
      events,
    );
  return {
    instance,
    failures,
    get state() {
      return state;
    },
  };
}

describe('SuperUserCredentialsService.activate', () => {
  it('本機設定不同於已啟用版本：generation+1、更新指紋與生效時間、撤銷維護會話並記錄啟用事件', async () => {
    const db = setup({});

    await expect(
      db.instance(NEW).activate({ expectedGeneration: 1 }),
    ).resolves.toEqual({ activated: true });

    const { access, superUserSessionsRevokedAt, events } = db.state;
    expect(access).toMatchObject({
      activeCredentialFingerprint: NEW,
      credentialGeneration: 2,
    });
    expect(access!.credentialActivatedAt.getTime()).toBeGreaterThan(
      ACTIVATED_AT.getTime(),
    );
    // 撤銷時間就是新版本的生效時間。
    expect(superUserSessionsRevokedAt).toEqual([access!.credentialActivatedAt]);
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'credentials.activated',
        actorKind: 'operator',
        actorUserId: null,
        sessionId: null,
        outcomeCode: 'succeeded',
        credentialGeneration: 2,
      }),
    ]);
  });

  it('再次啟用先前的設定仍增加 generation，不回到舊版本號', async () => {
    const db = setup({});
    await db.instance(NEW).activate({ expectedGeneration: 1 });

    await expect(
      db.instance(OLD).activate({ expectedGeneration: 2 }),
    ).resolves.toEqual({ activated: true });

    expect(db.state.access).toMatchObject({
      activeCredentialFingerprint: OLD,
      credentialGeneration: 3,
    });
    expect(db.state.superUserSessionsRevokedAt).toHaveLength(2);
    expect(db.state.events.map((event) => event.credentialGeneration)).toEqual([
      2, 3,
    ]);
  });

  it('本機設定已是啟用版本時為 no-op：不加 generation、不撤會話、不寫事件', async () => {
    const db = setup({});
    const before = structuredClone(db.state);

    await expect(
      db.instance(OLD).activate({ expectedGeneration: 1 }),
    ).resolves.toEqual({ activated: false });
    expect(db.state).toEqual(before);
  });

  it.each([
    ['舊版本號', NEW, 0],
    ['未來版本號', NEW, 2],
    ['字串版本號', NEW, '1'],
    ['相同設定也一樣先比對版本', OLD, 2],
  ])(
    'expectedGeneration 不符（%s）時拒絕，不寫入',
    async (_label, fingerprint, expectedGeneration) => {
      const db = setup({});
      const before = structuredClone(db.state);

      await expect(
        db
          .instance(fingerprint)
          .activate({ expectedGeneration: expectedGeneration as number }),
      ).rejects.toMatchObject({
        code: AppErrorCode.AUTH_SUPER_USER_GENERATION_CONFLICT,
        status: 409,
      });
      expect(db.state).toEqual(before);
    },
  );

  it('事件寫入失敗時整筆 rollback：版本、指紋與會話撤銷都不留下', async () => {
    const db = setup({});
    db.failures.eventType = 'credentials.activated';
    const before = structuredClone(db.state);

    await expect(
      db.instance(NEW).activate({ expectedGeneration: 1 }),
    ).rejects.toThrow('事件寫入失敗');
    expect(db.state).toEqual(before);
  });

  it('尚未初始化時回 503，不建立入口或版本', async () => {
    const db = setup(null);

    await expect(
      db.instance(NEW).activate({ expectedGeneration: 1 }),
    ).rejects.toMatchObject({
      code: AppErrorCode.AUTH_SUPER_USER_UNAVAILABLE,
      status: 503,
    });
    expect(db.state.access).toBeNull();
    expect(db.state.events).toEqual([]);
  });
});
