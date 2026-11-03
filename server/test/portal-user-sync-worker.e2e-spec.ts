import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { defaultRepeatStrategy, Queue } from 'bullmq';
import { formatInTaipei } from '#app/common/date-time.helper';
import {
  PortalUserSyncError,
  PortalUserSyncService,
} from '#app/features/users/services/portal-user-sync.service';
import { WorkerModule } from '#app/worker.module';
import {
  PORTAL_USER_SYNC_JOB,
  PORTAL_USER_SYNC_QUEUE,
} from '#app/worker/users/portal-user-sync.constants';
import { PortalUserSyncScheduler } from '#app/worker/users/portal-user-sync.scheduler';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SCHEDULE = { pattern: '0 4 * * *', tz: 'Asia/Taipei' };

/**
 * SC-006：每日匯入的排程。worker 用正式的 WorkerModule 連測試 Redis，只把匯入服務換成替身；
 * 匯入本身的行為由 portal-user-sync.e2e-spec.ts 驗證。
 */
describe('Portal 員工主檔每日排程（worker）', () => {
  const run = jest.fn();
  let queue: Queue;
  let workers: INestApplicationContext[] = [];

  async function startWorker(): Promise<void> {
    const worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PortalUserSyncService)
      .useValue({ run })
      .compile();
    await worker.init();
    workers.push(worker);
  }

  async function stopWorkers(): Promise<void> {
    await Promise.all(workers.map((worker) => worker.close()));
    workers = [];
  }

  /**
   * 模擬前一天 03:00 有 worker 註冊排程，之後所有 worker 停機到 04:00 以後：
   * 錯過的那一次仍在 Redis 等待執行。回傳錯過的時間與下一次的台北 04:00。
   */
  async function registerBeforeMissedRun() {
    const upcoming = defaultRepeatStrategy(Date.now(), SCHEDULE)!;
    const missed = upcoming - DAY;
    await queue.waitUntilReady();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(missed - HOUR);
    try {
      await new PortalUserSyncScheduler(queue).onModuleInit();
    } finally {
      clock.mockRestore();
    }
    expect(await queue.getJobScheduler('portal-user-sync:daily')).toMatchObject(
      { next: missed },
    );
    return { missed, upcoming };
  }

  beforeAll(() => {
    if (process.env.NODE_ENV !== 'test' || process.env.REDIS_DB === '0') {
      throw new Error('queue e2e 只允許使用隔離的 test Redis DB');
    }
    queue = new Queue(PORTAL_USER_SYNC_QUEUE, {
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD || undefined,
        db: Number(process.env.REDIS_DB),
      },
    });
  });

  beforeEach(async () => {
    run.mockReset();
    await queue.obliterate({ force: true });
  });

  afterEach(stopWorkers);

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('兩個 worker 同時啟動：Redis 只有一個台北 04:00 的排程，連續 7 天每天恰好觸發一次', async () => {
    await Promise.all([startWorker(), startWorker()]);

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toEqual([
      expect.objectContaining({
        key: 'portal-user-sync:daily',
        name: PORTAL_USER_SYNC_JOB,
        pattern: '0 4 * * *',
        tz: 'Asia/Taipei',
        // BullMQ 不保存空的 template data。
        template: {
          opts: { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 },
        },
      }),
    ]);
    expect(
      await queue.getJobCounts('wait', 'delayed', 'active', 'completed'),
    ).toEqual({ wait: 0, delayed: 1, active: 0, completed: 0 });

    // 從 Redis 中的下次執行時間起，用 BullMQ 排下一次的同一個計算往後推 7 次。
    const [{ next, pattern, tz }] = schedulers;
    const runs = [next!];
    while (runs.length < 7) {
      runs.push(defaultRepeatStrategy(runs[runs.length - 1], { pattern, tz })!);
    }
    expect(runs[0]).toBeGreaterThan(Date.now());
    expect(runs[0]).toBeLessThanOrEqual(Date.now() + DAY);
    expect(runs.map((at) => formatInTaipei(at, 'HH:mm:ss.SSS'))).toEqual(
      Array(7).fill('04:00:00.000'),
    );
    // 7 個不同日期落在 6 天的跨度內 → 連續 7 天、每天一次。
    expect(
      new Set(runs.map((at) => formatInTaipei(at, 'yyyy-MM-dd'))).size,
    ).toBe(7);
    expect(runs[6] - runs[0]).toBe(6 * DAY);
  });

  it('worker 在 04:00 停機：恢復後兩個 worker 只補跑一次，之後回到每天台北 04:00', async () => {
    const { upcoming } = await registerBeforeMissedRun();
    run.mockResolvedValue({ summary: {} });

    await Promise.all([startWorker(), startWorker()]);
    await waitFor(async () => (await queue.getCompletedCount()) === 1);
    await stopWorkers();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ trigger: 'schedule', dryRun: false });
    expect(await queue.getJobScheduler('portal-user-sync:daily')).toMatchObject(
      { next: upcoming },
    );
    expect(
      await queue.getJobCounts(
        'wait',
        'delayed',
        'active',
        'completed',
        'failed',
      ),
    ).toEqual({ wait: 0, delayed: 1, active: 0, completed: 1, failed: 0 });
  });

  it('匯入失敗：job 不重試，失敗原因不含原始錯誤，隔天台北 04:00 照常執行', async () => {
    const { upcoming } = await registerBeforeMissedRun();
    const failure = new PortalUserSyncError('source', 'ECONNREFUSED');
    run.mockRejectedValue(failure);

    await startWorker();
    await waitFor(async () => (await queue.getFailedCount()) === 1);
    await stopWorkers();

    expect(run).toHaveBeenCalledTimes(1);
    const [failed] = await queue.getFailed();
    expect(failed).toMatchObject({
      attemptsMade: 1,
      failedReason: failure.message,
    });
    expect(await queue.getJobScheduler('portal-user-sync:daily')).toMatchObject(
      { next: upcoming },
    );
    expect(
      await queue.getJobCounts(
        'wait',
        'delayed',
        'active',
        'completed',
        'failed',
      ),
    ).toEqual({ wait: 0, delayed: 1, active: 0, completed: 0, failed: 1 });
  });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('等待 queue 狀態逾時');
}
