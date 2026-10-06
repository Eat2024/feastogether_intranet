import type { INestApplicationContext } from '@nestjs/common';
import { createWorkerShutdown } from './worker.shutdown';

describe('createWorkerShutdown', () => {
  const setup = () => {
    const close = jest.fn();
    const app = { close } as unknown as INestApplicationContext;
    const exit = jest.fn();
    const log = jest.fn();
    const error = jest.fn();
    return { app, close, exit, logger: { log, error }, error };
  };

  it('收到 signal 時正常關閉 Nest application context', async () => {
    const { app, close, exit, logger } = setup();
    close.mockResolvedValueOnce(undefined);
    const shutdown = createWorkerShutdown(app, exit, logger);

    await shutdown('SIGINT');

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('重複收到 signal 時只執行一次關機', async () => {
    const { app, close, exit, logger } = setup();
    close.mockResolvedValueOnce(undefined);
    const shutdown = createWorkerShutdown(app, exit, logger);

    await Promise.all([shutdown('SIGINT'), shutdown('SIGTERM')]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('關機 hook 失敗時記錄錯誤並以非零狀態結束', async () => {
    const { app, close, exit, logger, error } = setup();
    close.mockRejectedValueOnce(new Error('close failed'));
    const shutdown = createWorkerShutdown(app, exit, logger);

    await expect(shutdown('SIGTERM')).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      '[worker] graceful shutdown failed',
      expect.any(Error),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });
});
