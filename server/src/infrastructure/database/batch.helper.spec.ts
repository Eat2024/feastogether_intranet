import { readInBatches, writeInBatches } from './batch.helper';

describe('readInBatches', () => {
  it('依序分批讀取並合併各批結果', async () => {
    const readBatches: number[][] = [];
    let activeReads = 0;
    let maxActiveReads = 0;

    const rows = await readInBatches([1, 2, 3, 4, 5], 2, async (batch) => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      readBatches.push([...batch]);
      activeReads -= 1;
      return batch.map((value) => `row-${value}`);
    });

    expect(readBatches).toEqual([[1, 2], [3, 4], [5]]);
    expect(maxActiveReads).toBe(1);
    expect(rows).toEqual(['row-1', 'row-2', 'row-3', 'row-4', 'row-5']);
  });

  it('沒有查詢條件時不執行讀取', async () => {
    const readBatch = jest.fn<
      Promise<readonly string[]>,
      [readonly number[]]
    >();

    await expect(readInBatches([], 100, readBatch)).resolves.toEqual([]);
    expect(readBatch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    '拒絕無效的 batch size：%s',
    async (batchSize) => {
      await expect(
        readInBatches([], batchSize, () => Promise.resolve([])),
      ).rejects.toThrow('batchSize 必須是正整數');
    },
  );
});

describe('writeInBatches', () => {
  it('依序分批寫入並累加影響列數', async () => {
    const writtenBatches: number[][] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;

    const affectedRows = await writeInBatches(
      [1, 2, 3, 4, 5],
      2,
      async (batch) => {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        await Promise.resolve();
        writtenBatches.push([...batch]);
        activeWrites -= 1;
        return batch.length;
      },
    );

    expect(writtenBatches).toEqual([[1, 2], [3, 4], [5]]);
    expect(maxActiveWrites).toBe(1);
    expect(affectedRows).toBe(5);
  });

  it('沒有資料時不執行寫入', async () => {
    const writeBatch = jest.fn<Promise<number>, [readonly number[]]>();

    await expect(writeInBatches([], 100, writeBatch)).resolves.toBe(0);
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    '拒絕無效的 batch size：%s',
    async (batchSize) => {
      await expect(
        writeInBatches([], batchSize, () => Promise.resolve(0)),
      ).rejects.toThrow('batchSize 必須是正整數');
    },
  );
});
