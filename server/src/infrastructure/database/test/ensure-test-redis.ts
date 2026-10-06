// ensure-test-redis.ts — e2e Redis 前置(環境隔離):開跑前清空 e2e 專屬 keyspace。
// fail-closed:REDIS_DB 必須為非 0 正整數才動作——db 0 是 dev/UAT/prod 的 keyspace,
// 比照 ensure-test-db 的 assertTestDbName 慣例,杜絕誤刷。
import Redis from 'ioredis';

/** 讀 e2e Redis db 並守門:未設定、0 或非法值一律拒絕(fail-closed)。共用單一事實來源。 */
export function assertTestRedisDb(): number {
  const raw = process.env.REDIS_DB;
  const db = Number(raw);
  if (raw === undefined || !Number.isInteger(db) || db <= 0) {
    throw new Error(
      `[test-redis] 拒絕:REDIS_DB="${raw ?? ''}" 必須為非 0 正整數(db 0 為 dev keyspace),避免清到 dev/prod`,
    );
  }
  return db;
}

/**
 * FLUSHDB e2e 專屬 db,清除跨輪殘留(cache key、queue job 等)。
 * 清理範圍受 REDIS_DB 隔離保護(FR-005):只刷守門通過的那一個 db。
 */
export async function flushTestRedis(): Promise<void> {
  const db = assertTestRedisDb();

  const client = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db,
    lazyConnect: true,
  });
  try {
    await client.connect();
    await client.flushdb();
  } finally {
    await client.quit();
  }
}
