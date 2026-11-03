import { PORTAL_USER_SYNC_JOB } from './portal-user-sync.constants';
import { PortalUserSyncScheduler } from './portal-user-sync.scheduler';

describe('PortalUserSyncScheduler', () => {
  it('註冊每天台北 04:00 的匯入排程，job 不重試', async () => {
    const queue = {
      // 排程不存在時 BullMQ 5 的實際回傳。
      getJobScheduler: jest
        .fn()
        .mockResolvedValue({ key: 'portal-user-sync:daily', next: null }),
      upsertJobScheduler: jest.fn(),
    };
    await new PortalUserSyncScheduler(queue as never).onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'portal-user-sync:daily',
      { pattern: '0 4 * * *', tz: 'Asia/Taipei' },
      {
        name: PORTAL_USER_SYNC_JOB,
        data: {},
        opts: { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
      },
    );
  });

  it('停機錯過的那一次已到期、尚未執行時不覆寫，留給 worker 補跑', async () => {
    const queue = {
      getJobScheduler: jest.fn().mockResolvedValue({
        key: 'portal-user-sync:daily',
        next: Date.now() - 60_000,
      }),
      upsertJobScheduler: jest.fn(),
    };
    await new PortalUserSyncScheduler(queue as never).onModuleInit();
    expect(queue.getJobScheduler).toHaveBeenCalledWith(
      'portal-user-sync:daily',
    );
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('下一次還沒到時照常 upsert，部署時套用目前的排程設定', async () => {
    const queue = {
      getJobScheduler: jest.fn().mockResolvedValue({
        key: 'portal-user-sync:daily',
        next: Date.now() + 60_000,
      }),
      upsertJobScheduler: jest.fn(),
    };
    await new PortalUserSyncScheduler(queue as never).onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });
});
