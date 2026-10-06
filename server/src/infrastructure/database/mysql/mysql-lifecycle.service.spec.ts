import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { MysqlLifecycleService } from './mysql-lifecycle.service';

/**
 * 釘住「關閉時必須真的銷毀連線池」。
 *
 * MYSQL_MAIN 由 useFactory 建立普通 DataSource 物件，Nest 不會對它呼叫生命週期；
 * 少了這個 provider，連線會留到 MySQL wait_timeout（預設 8 小時）才釋放，
 * 在 e2e 單一 process 內跨 suite 累積後造成偶發的 "Too many connections"。
 */
describe('MysqlLifecycleService', () => {
  afterEach(() => jest.restoreAllMocks());

  function build(overrides: Partial<DataSource> = {}) {
    const destroy = jest.fn(() => Promise.resolve());
    const dataSource = {
      isInitialized: true,
      destroy,
      ...overrides,
    } as unknown as DataSource;
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    return {
      service: new MysqlLifecycleService(dataSource),
      destroy,
      logError,
    };
  }

  it('關閉時銷毀連線池', async () => {
    const { service, destroy } = build();
    await service.onModuleDestroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('未初始化時不呼叫 destroy（避免對未連線的 DataSource 擲錯）', async () => {
    const { service, destroy } = build({ isInitialized: false });
    await service.onModuleDestroy();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('銷毀失敗不得阻擋應用結束，但要留下線索', async () => {
    const { service, logError } = build({
      destroy: jest.fn(() => Promise.reject(new Error('connection reset'))),
    });

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
