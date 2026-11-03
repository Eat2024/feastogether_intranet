import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  ESIGN_DOCUMENT_INITIATION_QUEUE,
  ESIGN_MAINTENANCE_JOB,
  ESIGN_MAINTENANCE_QUEUE,
} from '#app/features/esign/esign-queue.constants';
import { AppLoggerService } from '#app/infrastructure/logging/appLog/app-logger.service';

@Injectable()
export class EsignMaintenanceScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private clients: Array<Awaited<Queue['client']>> = [];
  private epoch = 0;
  private stopped = false;
  private configured = false;
  private waiters: Array<(ready: boolean) => void> = [];
  private retryTimer?: NodeJS.Timeout;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    @InjectQueue(ESIGN_MAINTENANCE_QUEUE) private readonly queue: Queue,
    @InjectQueue(ESIGN_DOCUMENT_INITIATION_QUEUE)
    private readonly initiation: Queue,
    private readonly logger: AppLoggerService,
  ) {}

  get ready(): boolean {
    return this.configured && !this.stopped;
  }

  waitUntilReady(): Promise<boolean> {
    if (this.ready || this.stopped) return Promise.resolve(this.ready);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private releaseWaiters(ready: boolean): void {
    for (const resolve of this.waiters.splice(0)) resolve(ready);
  }

  async onModuleInit(): Promise<void> {
    this.clients = [
      ...new Set(
        await Promise.all([this.queue.client, this.initiation.client]),
      ),
    ];
    for (const client of this.clients) {
      client.on('close', this.onClose);
      client.on('ready', this.onReady);
    }
    // client Promise 通常在 ready 後才解決，不能只等待下一次 ready。
    await this.restore();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.releaseWaiters(false);
    this.configured = false;
    this.epoch++;
    clearTimeout(this.retryTimer);
    for (const client of this.clients) {
      client.off('close', this.onClose);
      client.off('ready', this.onReady);
    }
  }

  private readonly onClose = (): void => {
    this.epoch++;
    this.configured = false;
    clearTimeout(this.retryTimer);
  };

  private readonly onReady = (): void => {
    this.epoch++;
    this.configured = false;
    clearTimeout(this.retryTimer);
    this.restoreAfterReconnect(this.epoch, 1_000);
  };

  private restoreAfterReconnect(epoch: number, delayMs: number): void {
    void this.restore().catch(() => {
      if (this.stopped || epoch !== this.epoch) return;
      this.logger.error({
        event: 'esign.queue_restore_failed',
        message: '背景發起排程恢復失敗，稍後重試',
      });
      // 只有一個可取消的連線設定重試，沿用同一個 Bull maintenance scheduler。
      this.retryTimer = setTimeout(() => {
        if (!this.stopped && epoch === this.epoch) {
          this.restoreAfterReconnect(epoch, Math.min(delayMs * 2, 30_000));
        }
      }, delayMs);
      this.retryTimer.unref();
    });
  }

  private restore(): Promise<void> {
    const epoch = this.epoch;
    const next = this.pending.then(async () => {
      if (
        this.stopped ||
        epoch !== this.epoch ||
        this.clients.some((client) => client.status !== 'ready')
      )
        return;
      await this.initiation.setGlobalConcurrency(1);
      if (this.stopped || epoch !== this.epoch) return;
      await this.queue.upsertJobScheduler(
        'esign-maintenance:30s',
        { every: 30_000 },
        { name: ESIGN_MAINTENANCE_JOB, data: {} },
      );
      if (!this.stopped && epoch === this.epoch) {
        this.configured = true;
        this.releaseWaiters(true);
      }
    });
    // 序列化重連事件；較新的 epoch 仍有自己的恢復工作，不會被舊 promise 吃掉。
    this.pending = next.catch(() => undefined);
    return next;
  }
}
