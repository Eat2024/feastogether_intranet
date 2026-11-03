import { EventEmitter } from 'node:events';
import { EsignMaintenanceScheduler } from './esign-maintenance.scheduler';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const client = Object.assign(new EventEmitter(), { status: 'ready' });
  const queue = {
    client: Promise.resolve(client),
    upsertJobScheduler: jest.fn(() => Promise.resolve()),
  };
  const initiation = {
    client: Promise.resolve(client),
    setGlobalConcurrency: jest.fn(() => Promise.resolve()),
  };
  const logger = { error: jest.fn() };
  const scheduler = new EsignMaintenanceScheduler(
    queue as never,
    initiation as never,
    logger as never,
  );
  return { client, queue, initiation, logger, scheduler };
}

describe('背景發起連線設定恢復', () => {
  afterEach(() => jest.useRealTimers());

  it('同一 ready 後暫時失敗仍重試，不依賴下一次重連；shutdown 取消重試', async () => {
    const f = fixture();
    await f.scheduler.onModuleInit();
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    f.queue.upsertJobScheduler.mockRejectedValueOnce(
      new Error('synthetic configuration failure'),
    );
    f.client.emit('close');
    f.client.emit('ready');
    await flush();
    expect(f.scheduler.ready).toBe(false);
    expect(f.logger.error).toHaveBeenCalledWith({
      event: 'esign.queue_restore_failed',
      message: '背景發起排程恢復失敗，稍後重試',
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(f.scheduler.ready).toBe(true);
    expect(f.queue.upsertJobScheduler).toHaveBeenCalledTimes(3);
    f.queue.upsertJobScheduler.mockRejectedValue(new Error('synthetic'));
    f.client.emit('ready');
    await flush();
    f.scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(f.queue.upsertJobScheduler).toHaveBeenCalledTimes(4);
    expect(f.client.listenerCount('ready')).toBe(0);
  });

  it('舊 ready 配置未完成又斷線，不可開 gate；新 epoch 仍重新配置且不重疊', async () => {
    const f = fixture();
    await f.scheduler.onModuleInit();
    let release!: () => void;
    f.initiation.setGlobalConcurrency.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    f.client.emit('close');
    f.client.emit('ready');
    await flush();
    f.client.emit('close');
    release();
    await flush();
    expect(f.scheduler.ready).toBe(false);
    f.client.emit('ready');
    await flush();
    expect(f.scheduler.ready).toBe(true);
    expect(f.initiation.setGlobalConcurrency).toHaveBeenCalledTimes(3);
    f.scheduler.onModuleDestroy();
  });

  it('shutdown 時尚在配置的結果不得再註冊 scheduler 或啟動 consumer', async () => {
    const f = fixture();
    await f.scheduler.onModuleInit();
    let release!: () => void;
    f.initiation.setGlobalConcurrency.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    f.client.emit('ready');
    await flush();
    const waiting = f.scheduler.waitUntilReady();
    f.scheduler.onModuleDestroy();
    release();
    await flush();
    expect(await waiting).toBe(false);
    expect(f.queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(f.scheduler.ready).toBe(false);
  });

  it('初始化錯誤阻止啟動；正常 shutdown 釋放尚未啟動的 consumer', async () => {
    const f = fixture();
    f.queue.upsertJobScheduler.mockRejectedValueOnce(new Error('synthetic'));
    await expect(f.scheduler.onModuleInit()).rejects.toThrow('synthetic');
    const waiting = f.scheduler.waitUntilReady();
    f.scheduler.onModuleDestroy();
    await waiting;
    expect(f.scheduler.ready).toBe(false);
  });
});
