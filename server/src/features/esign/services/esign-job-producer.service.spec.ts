import { EsignJobProducerService } from './esign-job-producer.service';

describe('EsignJobProducerService', () => {
  it('個人副本入列失敗只記告警，不把已提交的簽署回報成失敗', async () => {
    const add = jest.fn().mockRejectedValue(new Error('redis unavailable'));
    const warn = jest.fn();
    const service = new EsignJobProducerService(
      {} as never,
      { add } as never,
      { warn } as never,
    );
    await expect(service.enqueueFinalization(10, 20)).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      event: 'esign.finalization_enqueue_failed',
      context: EsignJobProducerService.name,
    });
  });

  it('超過一批的邀請完整入列，單批至多 100 筆', async () => {
    const addBulk = jest
      .fn<
        Promise<unknown[]>,
        [Array<{ data: { notificationLogId: number } }>]
      >()
      .mockResolvedValue([]);
    const service = new EsignJobProducerService(
      { addBulk } as never,
      {} as never,
      { warn: jest.fn() } as never,
    );
    await service.enqueueInvitations(
      Array.from({ length: 205 }, (_, i) => i + 1),
    );
    expect(addBulk.mock.calls.map(([jobs]) => jobs.length)).toEqual([
      100, 100, 5,
    ]);
    expect(
      addBulk.mock.calls.flatMap(([jobs]) =>
        jobs.map(
          (job: { data: { notificationLogId: number } }) =>
            job.data.notificationLogId,
        ),
      ),
    ).toEqual(Array.from({ length: 205 }, (_, i) => i + 1));
  });

  it('Redis 失效後不再堆積請求，已提交的名單交由 maintenance 補工作', async () => {
    const addBulk = jest.fn().mockRejectedValue(new Error('redis unavailable'));
    const warn = jest.fn();
    const service = new EsignJobProducerService(
      { addBulk } as never,
      {} as never,
      { warn } as never,
    );
    await expect(
      service.enqueueInvitations(Array.from({ length: 205 }, (_, i) => i + 1)),
    ).resolves.toBeUndefined();
    expect(addBulk).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('個人產製工作只攜帶文件與簽署人 ID', async () => {
    const add = jest.fn().mockResolvedValue({});
    const service = new EsignJobProducerService(
      {} as never,
      { add } as never,
      { warn: jest.fn() } as never,
    );
    await service.enqueueFinalization(10, 20);
    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      { documentId: 10, signerId: 20 },
      expect.any(Object),
    );
  });
});
