import type { Job } from 'bullmq';
import { DocumentInitiationProcessor } from './document-initiation.processor';

describe('背景發起 consumer 恢復 gate', () => {
  it('配置尚未恢復時不 claim；設定完成後才啟動 consumer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = {
      ready: false,
      waitUntilReady: async () => {
        await gate;
        return scheduler.ready;
      },
    };
    const jobs = { process: jest.fn() };
    const worker = { run: jest.fn(() => Promise.resolve()) };
    const processor = new DocumentInitiationProcessor(
      jobs as never,
      scheduler as never,
      { error: jest.fn() } as never,
    );
    jest.spyOn(processor, 'worker', 'get').mockReturnValue(worker as never);
    const bootstrap = processor.onApplicationBootstrap();
    await processor.process({ data: { jobId: 1 } } as Job<{ jobId: number }>);
    expect(jobs.process).not.toHaveBeenCalled();
    expect(worker.run).not.toHaveBeenCalled();
    scheduler.ready = true;
    release();
    await bootstrap;
    expect(worker.run).toHaveBeenCalledTimes(1);
    await processor.process({ data: { jobId: 1 } } as Job<{ jobId: number }>);
    expect(jobs.process).toHaveBeenCalledWith(1);
  });
});
