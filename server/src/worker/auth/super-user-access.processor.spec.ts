import { SuperUserAccessProcessor } from './super-user-access.processor';

function setup(rotate: jest.Mock) {
  const logger = { warn: jest.fn(), error: jest.fn() };
  const processor = new SuperUserAccessProcessor(
    { rotateEntryIfDue: rotate } as never,
    logger as never,
  );
  return { processor, logger };
}

describe('SuperUserAccessProcessor', () => {
  it.each([
    [{ status: 'rotated', entryGeneration: 2 }],
    [{ status: 'not_due' }],
  ])('以 system 身分到期才輪換，結果成為 job 回傳值：%o', async (result) => {
    const rotate = jest.fn().mockResolvedValue(result);
    const { processor, logger } = setup(rotate);

    await expect(processor.process()).resolves.toEqual(result);
    expect(rotate).toHaveBeenCalledWith({ kind: 'system' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('未初始化：job 正常完成並回明確結果，另記警告；不建立入口', async () => {
    const rotate = jest.fn().mockResolvedValue({ status: 'uninitialized' });
    const { processor, logger } = setup(rotate);

    await expect(processor.process()).resolves.toEqual({
      status: 'uninitialized',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.entry_rotation_uninitialized' }),
    );
  });

  it('DB 不可用讓 job 失敗：failedReason 與 log 只有錯誤類型，不含原始訊息或 SQL', async () => {
    const raw = Object.assign(
      new Error("UPDATE super_user_access SET entry_key = 'synthetic-key'"),
      { code: 'ECONNREFUSED' },
    );
    const { processor, logger } = setup(jest.fn().mockRejectedValue(raw));

    const failure = await processor.process().catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('維護入口輪換失敗（ECONNREFUSED）');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.entry_rotation_failed',
        metadata: { errorType: 'ECONNREFUSED' },
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'synthetic-key',
    );
    expect(
      JSON.stringify(failure, Object.getOwnPropertyNames(failure)),
    ).not.toContain('synthetic-key');
  });
});
