export interface BatchCollection<T> {
  readonly batch: readonly T[];
  readonly previous: BatchCollection<T> | null;
}

/** 以 O(1) 保存新批次，不重複複製先前已收集的資料。 */
export function collectBatch<T>(
  collection: BatchCollection<T> | null,
  batch: readonly T[],
): BatchCollection<T> | null {
  return batch.length === 0 ? collection : { batch, previous: collection };
}

/** 將反向串接的批次一次攤平為原始讀取順序。 */
export function flattenBatchCollection<T>(
  collection: BatchCollection<T> | null,
): T[] {
  const newestFirst = Array.from(batchValuesNewestFirst(collection));
  return newestFirst.flatMap(
    (_, index) => newestFirst[newestFirst.length - index - 1],
  );
}

/**
 * 將查詢條件依固定批次依序讀取，避免同時送出多個資料庫查詢，並合併各批結果。
 */
export async function readInBatches<TInput, TResult>(
  items: readonly TInput[],
  batchSize: number,
  readBatch: (batch: readonly TInput[]) => Promise<readonly TResult[]>,
): Promise<TResult[]> {
  assertValidBatchSize(batchSize);

  let batches: BatchCollection<TResult> | null = null;
  for (let index = 0; index < items.length; index += batchSize) {
    const rows = await readBatch(items.slice(index, index + batchSize));
    batches = collectBatch(batches, rows);
  }
  return flattenBatchCollection(batches);
}

/**
 * 將資料依固定批次依序寫入，避免同時送出多個資料庫 mutation，並累加影響列數。
 */
export async function writeInBatches<T>(
  rows: readonly T[],
  batchSize: number,
  writeBatch: (batch: readonly T[]) => Promise<number>,
): Promise<number> {
  assertValidBatchSize(batchSize);

  let affectedRows = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    affectedRows += await writeBatch(rows.slice(index, index + batchSize));
  }
  return affectedRows;
}

function assertValidBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('batchSize 必須是正整數');
  }
}

function* batchValuesNewestFirst<T>(
  collection: BatchCollection<T> | null,
): Generator<readonly T[]> {
  let current = collection;
  while (current) {
    yield current.batch;
    current = current.previous;
  }
}
