import type { INestApplicationContext } from '@nestjs/common';

interface WorkerShutdownLogger {
  log(message: string): void;
  error(message: string, error: unknown): void;
}

/** 建立只會執行一次的 worker graceful shutdown handler。 */
export function createWorkerShutdown(
  app: INestApplicationContext,
  exit: (code: number) => unknown = (code) => process.exit(code),
  logger: WorkerShutdownLogger = console,
): (signal: string) => Promise<void> {
  let isClosing = false;

  return async (signal: string): Promise<void> => {
    if (isClosing) return;
    isClosing = true;

    logger.log(`[worker] received ${signal}, closing gracefully...`);
    try {
      await app.close();
      exit(0);
    } catch (error) {
      logger.error('[worker] graceful shutdown failed', error);
      exit(1);
    }
  };
}
