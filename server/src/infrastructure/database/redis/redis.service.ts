import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_MAIN } from './redis.provider';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_MAIN) private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logError('get', error);
      throw error;
    }
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    try {
      if (ttl !== undefined) {
        await this.client.set(key, serialized, 'EX', ttl);
        return;
      }
      await this.client.set(key, serialized);
    } catch (error) {
      this.logError('set', error);
      throw error;
    }
  }

  /**
   * 就地更新既有 key：只換值，不動 TTL、也不無中生有。
   * - `XX`：只在 key 存在時才寫；不存在就整個不做事並回 null（→ 本方法回 false），
   *   避免替已過期／從未快取過的對象憑空種一筆沒人會失效的資料。
   * - `KEEPTTL`：沿用原本的到期時間。SET 預設會「清掉」TTL 讓 key 變成永不過期，
   *   少了這個旗標，每刷新一次內容就等於幫該筆快取續命成永久。
   * 對照 {@link set}：set 是「寫入並（可選）重設 TTL」，update 是「就地改值、不續命」。
   * 需 Redis 6.0+（KEEPTTL 自 6.0 起提供）。
   */
  async update(key: string, value: unknown): Promise<boolean> {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    try {
      const result = await this.client.set(key, serialized, 'KEEPTTL', 'XX');
      return result === 'OK';
    } catch (error) {
      this.logError('update', error);
      throw error;
    }
  }

  /**
   * 原子地把 counter 校正到 DB 已知下限後取下一號。
   * key 已存在且較新時保留原值與 TTL；遺失／落後時才以 minimum 重建。
   */
  async incrementAtLeast(
    key: string,
    minimum: number,
    ttl: number,
  ): Promise<number> {
    const script = `
      local current = redis.call('GET', KEYS[1])
      local minimum = tonumber(ARGV[1])
      if (not current) or (tonumber(current) < minimum) then
        redis.call('SET', KEYS[1], minimum, 'EX', ARGV[2])
      end
      return redis.call('INCR', KEYS[1])
    `;
    try {
      const result = await this.client.eval(
        script,
        1,
        key,
        String(minimum),
        String(ttl),
      );
      return Number(result);
    } catch (error) {
      this.logError('incrementAtLeast', error);
      throw error;
    }
  }

  /**
   * 原子取值並刪除（GETDEL，Redis 6.2+）：一次性憑證的唯一正確取法——
   * 兩個並發呼叫者只會有一個拿到值，不能以 GET→DEL 兩道命令模擬。
   * key 不存在回 null。
   */
  async getDel(key: string): Promise<string | null> {
    try {
      return await this.client.getdel(key);
    } catch (error) {
      this.logError('getDel', error);
      throw error;
    }
  }

  async del(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      this.logError('del', error);
      throw error;
    }
  }

  /**
   * 刪除符合 pattern 的所有 key（以 SCAN 逐批取、非阻塞的 KEYS）。
   * 停用帳號時撤該 user 全部 session（`auth:<uid>:*`）。
   * 回傳刪除的 key 數。
   */
  async deleteByPattern(pattern: string): Promise<number> {
    try {
      let cursor = '0';
      let deleted = 0;
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length > 0) deleted += await this.client.del(...keys);
      } while (cursor !== '0');
      return deleted;
    } catch (error) {
      this.logError('deleteByPattern', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'ready') {
      this.client.disconnect();
      return;
    }

    try {
      await this.client.quit();
    } catch (error) {
      this.logError('quit', error);
      this.client.disconnect();
    }
  }

  private logError(operation: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.error(`Redis command failed: ${operation} (${reason})`);
  }
}
