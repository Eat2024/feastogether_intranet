import type { AuthSecurityEvent } from '../entities/auth-security-event.entity';
import type { SuperUserAccess } from '../entities/super-user-access.entity';
import { AuthSecurityEventService } from './auth-security-event.service';
import { SuperUserAccessService } from './super-user-access.service';

const FINGERPRINT = 'f'.repeat(64);
const OLD_ENTRY = 'E'.repeat(43);
const SYSTEM = { kind: 'system' } as const;
const taipei = (local: string) => new Date(`${local}+08:00`);

/**
 * 以記憶體模擬 super_user_access／auth_security_events 與交易：transaction 失敗時還原快照，
 * 等同 MySQL rollback。只模擬 SuperUserAccessService 依賴的查詢語意。
 */
function setup(periodStartAt: Date | null) {
  let state = {
    access: periodStartAt
      ? ({
          id: 1,
          entryKey: OLD_ENTRY,
          entryGeneration: 1,
          rotatedAt: periodStartAt,
          periodStartAt,
          activeCredentialFingerprint: FINGERPRINT,
          credentialGeneration: 3,
          credentialActivatedAt: periodStartAt,
        } as SuperUserAccess)
      : null,
    events: [] as Array<Partial<AuthSecurityEvent>>,
  };
  const locks: string[] = [];
  const failures: { save?: Error } = {};
  const manager = {};
  const mysql = {
    getManager: () => manager,
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
  const access = {
    find: () => Promise.resolve(state.access),
    findForUpdate: () => {
      locks.push('access');
      return Promise.resolve(state.access);
    },
    insertIfAbsent: (fields: SuperUserAccess) => {
      if (state.access) return Promise.resolve(false);
      state.access = { ...fields, id: 1 };
      return Promise.resolve(true);
    },
    save: (row: SuperUserAccess) => {
      if (failures.save) return Promise.reject(failures.save);
      state.access = { ...row };
      return Promise.resolve();
    },
  };
  const events = new AuthSecurityEventService(
    mysql as never,
    {
      append: (event: Partial<AuthSecurityEvent>) => {
        state.events.push(event);
        return Promise.resolve();
      },
    } as never,
    { isActive: () => false } as never,
    { warn: jest.fn() } as never,
  );
  const service = new SuperUserAccessService(
    mysql as never,
    access as never,
    { fingerprint: FINGERPRINT } as never,
    events,
  );
  return {
    service,
    locks,
    failures,
    get state() {
      return state;
    },
  };
}

describe('SuperUserAccessService.rotateEntryIfDue', () => {
  afterEach(() => jest.useRealTimers());

  it('週一台北 03:59:59 仍屬已處理週期：no-op，不改任何欄位、不寫事件', async () => {
    const context = setup(taipei('2026-10-26T04:00'));
    const before = structuredClone(context.state);
    jest.useFakeTimers({ now: taipei('2026-11-02T03:59:59.999') });

    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'not_due',
    });
    expect(context.state).toEqual(before);
    expect(context.locks).toEqual(['access']);
  });

  it('週一台北 04:00 到期：鎖 singleton 後換新入口、entry generation +1，同交易寫事件；帳密版本不變', async () => {
    const context = setup(taipei('2026-10-26T04:00'));
    const now = taipei('2026-11-02T04:00');
    jest.useFakeTimers({ now });

    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'rotated',
      entryGeneration: 2,
    });

    const access = context.state.access!;
    expect(access.entryKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(access.entryKey).not.toBe(OLD_ENTRY);
    expect(access).toMatchObject({
      entryGeneration: 2,
      rotatedAt: now,
      periodStartAt: now,
      activeCredentialFingerprint: FINGERPRINT,
      credentialGeneration: 3,
      credentialActivatedAt: taipei('2026-10-26T04:00'),
    });
    expect(context.locks).toEqual(['access']);
    expect(context.state.events).toEqual([
      expect.objectContaining({
        eventType: 'entry.rotated',
        actorKind: 'system',
        actorUserId: null,
        sessionId: null,
        outcomeCode: 'succeeded',
        entryGeneration: 2,
        credentialGeneration: null,
      }),
    ]);
  });

  it('同一週期再次執行（重試、重啟或另一個 worker）不再換入口', async () => {
    const context = setup(taipei('2026-10-26T04:00'));
    jest.useFakeTimers({ now: taipei('2026-11-02T04:00') });
    await context.service.rotateEntryIfDue(SYSTEM);
    const rotated = structuredClone(context.state);

    jest.setSystemTime(taipei('2026-11-09T03:59:59.999'));
    await expect(
      context.service.rotateEntryIfDue({ kind: 'operator' }),
    ).resolves.toEqual({ status: 'not_due' });
    expect(context.state).toEqual(rotated);
  });

  it('跨年：新年第一個週一 04:00 前不換，04:00 換到新年週期', async () => {
    const context = setup(taipei('2026-12-28T04:00'));
    jest.useFakeTimers({ now: taipei('2027-01-04T03:59:59.999') });
    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'not_due',
    });

    jest.setSystemTime(taipei('2027-01-04T04:00'));
    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'rotated',
      entryGeneration: 2,
    });
    expect(context.state.access!.periodStartAt).toEqual(
      taipei('2027-01-04T04:00'),
    );
  });

  it('停機錯過多個週期：恢復後只補一次到最近到期週期，之後回到每週一次', async () => {
    const context = setup(taipei('2026-10-05T04:00'));
    jest.useFakeTimers({ now: taipei('2026-11-04T10:00') });

    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'rotated',
      entryGeneration: 2,
    });
    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'not_due',
    });
    expect(context.state.access).toMatchObject({
      entryGeneration: 2,
      periodStartAt: taipei('2026-11-02T04:00'),
    });
    expect(context.state.events).toHaveLength(1);
  });

  it('初始化後同一週期不輪換，下一個週一 04:00 才輪換', async () => {
    const context = setup(null);
    jest.useFakeTimers({ now: taipei('2026-11-04T10:00') });
    await context.service.initialize();
    const entry = context.state.access!.entryKey;

    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'not_due',
    });
    jest.setSystemTime(taipei('2026-11-09T04:00'));
    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'rotated',
      entryGeneration: 2,
    });
    expect(context.state.access!.entryKey).not.toBe(entry);
  });

  it('未初始化：回明確結果，不建立入口或帳密版本、不寫事件', async () => {
    const context = setup(null);
    jest.useFakeTimers({ now: taipei('2026-11-02T04:00') });

    await expect(context.service.rotateEntryIfDue(SYSTEM)).resolves.toEqual({
      status: 'uninitialized',
    });
    expect(context.state).toEqual({ access: null, events: [] });
  });

  it('寫入失敗整筆 rollback：保留原入口與版本，錯誤交給呼叫端', async () => {
    const context = setup(taipei('2026-10-26T04:00'));
    const before = structuredClone(context.state);
    context.failures.save = new Error('合成 DB 故障');
    jest.useFakeTimers({ now: taipei('2026-11-02T04:00') });

    await expect(context.service.rotateEntryIfDue(SYSTEM)).rejects.toThrow(
      '合成 DB 故障',
    );
    expect(context.state).toEqual(before);
  });
});
