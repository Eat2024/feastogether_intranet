import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { createWorkerShutdown } from './worker.shutdown';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });

  console.log('[worker] background worker started');
  const shutdown = createWorkerShutdown(app);
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
