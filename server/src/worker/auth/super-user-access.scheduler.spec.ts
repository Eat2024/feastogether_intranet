import { SUPER_USER_ENTRY_ROTATION_JOB } from './super-user-access.constants';
import { SuperUserEntryRotationError } from './super-user-access.processor';
import { SuperUserAccessScheduler } from './super-user-access.scheduler';

function setup(next: number | null) {
  const calls: string[] = [];
  const queue = {
    getJobScheduler: jest.fn(() => {
      calls.push('getJobScheduler');
      // 排程不存在時 BullMQ 5 回傳 undefined；存在時帶下次執行時間。
      return Promise.resolve(
        next === null ? undefined : { key: 'super-user-entry-weekly', next },
      );
    }),
    upsertJobScheduler: jest.fn(() => {
      calls.push('upsertJobScheduler');
      return Promise.resolve();
    }),
  };
  const rotation = {
    process: jest.fn(() => {
      calls.push('catch-up');
      return Promise.resolve({ status: 'not_due' });
    }),
  };
  const scheduler = new SuperUserAccessScheduler(
    queue as never,
    rotation as never,
  );
  return { scheduler, queue, rotation, calls };
}

describe('SuperUserAccessScheduler', () => {
  it('啟動先以 DB 補做，再註冊每週一台北 04:00、空 payload、重試 3 次的排程', async () => {
    const { scheduler, queue, calls } = setup(null);

    await scheduler.onModuleInit();

    expect(calls).toEqual([
      'catch-up',
      'getJobScheduler',
      'upsertJobScheduler',
    ]);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'super-user-entry-weekly',
      { pattern: '0 4 * * 1', tz: 'Asia/Taipei' },
      {
        name: SUPER_USER_ENTRY_ROTATION_JOB,
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      },
    );
  });

  it('停機錯過的那一次已到期、尚未執行時不覆寫；它執行時由 DB 週期判定', async () => {
    const { scheduler, queue, calls } = setup(Date.now() - 60_000);

    await scheduler.onModuleInit();

    expect(calls).toEqual(['catch-up', 'getJobScheduler']);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('下一次還沒到時照常 upsert，部署時套用目前的排程設定', async () => {
    const { scheduler, queue } = setup(Date.now() + 60_000);

    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it('補做失敗時 worker 照常啟動並註冊排程，等下次排程或 REPL 補做', async () => {
    const { scheduler, queue, rotation } = setup(null);
    rotation.process.mockRejectedValueOnce(
      new SuperUserEntryRotationError('ER_NO_SUCH_TABLE'),
    );

    await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });
});
