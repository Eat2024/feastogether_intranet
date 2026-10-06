import { Redis } from 'ioredis';
import { Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

describe('RedisService permission cache primitives', () => {
  afterEach(() => jest.restoreAllMocks());

  const setup = () => {
    const client = {
      status: 'ready',
      get: jest.fn(),
      set: jest.fn(),
      eval: jest.fn(),
      del: jest.fn(),
      connect: jest.fn(),
      quit: jest.fn(),
      disconnect: jest.fn(),
    };
    const logger = {
      error: jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined),
    };
    return {
      service: new RedisService(client as unknown as Redis),
      client,
      logger,
    };
  };

  describe('get', () => {
    it('key 存在時回傳原始值', async () => {
      const { service, client } = setup();
      client.get.mockResolvedValueOnce('{"userId":101}');

      await expect(service.get('authz:user:101')).resolves.toBe(
        '{"userId":101}',
      );
    });

    it('key 不存在時回傳 null', async () => {
      const { service, client } = setup();
      client.get.mockResolvedValueOnce(null);

      await expect(service.get('authz:user:101')).resolves.toBeNull();
    });

    it('Redis command 失敗時直接拋錯，不得偽裝成 miss', async () => {
      const { service, client, logger } = setup();
      client.get.mockRejectedValueOnce(new Error('synthetic disconnect'));

      await expect(service.get('authz:user:101')).rejects.toThrow(
        'synthetic disconnect',
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Redis command failed: get (synthetic disconnect)',
      );
    });

    it('Redis command 失敗時直接拋錯，不得回傳假 OK', async () => {
      const { service, client, logger } = setup();
      client.set.mockRejectedValueOnce(new Error('synthetic disconnect'));

      await expect(
        service.set('authz:user:101', 'value', 86400),
      ).rejects.toThrow('synthetic disconnect');
      expect(logger.error).toHaveBeenCalledWith(
        'Redis command failed: set (synthetic disconnect)',
      );
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
        'authz:user:101',
      );
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('value');
    });
  });

  describe('update', () => {
    it('只更新既有 key 並保留原 TTL', async () => {
      const { service, client } = setup();
      client.set.mockResolvedValueOnce('OK');

      await expect(
        service.update('authz:user:101', { userId: 101 }),
      ).resolves.toBe(true);
      expect(client.set).toHaveBeenCalledWith(
        'authz:user:101',
        '{"userId":101}',
        'KEEPTTL',
        'XX',
      );
    });

    it('key 不存在時不建立並回傳 false', async () => {
      const { service, client } = setup();
      client.set.mockResolvedValueOnce(null);

      await expect(service.update('authz:user:101', 'value')).resolves.toBe(
        false,
      );
    });
  });

  describe('incrementAtLeast', () => {
    it('以 Lua 原子校正 DB 下限並取得下一號', async () => {
      const { service, client } = setup();
      client.eval.mockResolvedValueOnce(13);

      await expect(
        service.incrementAtLeast('batch:260901', 12, 259200),
      ).resolves.toBe(13);
      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('INCR', KEYS[1])"),
        1,
        'batch:260901',
        '12',
        '259200',
      );
    });

    it('Lua 執行失敗時記錄 operation 並向上拋出', async () => {
      const { service, client, logger } = setup();
      client.eval.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.incrementAtLeast('batch:260901', 12, 259200),
      ).rejects.toThrow('redis down');
      expect(logger.error).toHaveBeenCalledWith(
        'Redis command failed: incrementAtLeast (redis down)',
      );
    });
  });

  describe('del', () => {
    it('回傳實際刪除數量', async () => {
      const { service, client } = setup();
      client.del.mockResolvedValueOnce(1);

      await expect(service.del('auth:101:synthetic-token')).resolves.toBe(1);
    });

    it('Redis command 失敗時記錄去敏感 log 並原樣拋出', async () => {
      const { service, client, logger } = setup();
      const error = new Error('synthetic disconnect');
      client.del.mockRejectedValueOnce(error);

      await expect(service.del('auth:101:synthetic-token')).rejects.toBe(error);
      expect(logger.error).toHaveBeenCalledWith(
        'Redis command failed: del (synthetic disconnect)',
      );
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
        'synthetic-token',
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('連線可用時以 QUIT 正常關閉 Redis', async () => {
      const { service, client } = setup();
      client.quit.mockResolvedValueOnce('OK');

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();

      expect(client.quit).toHaveBeenCalledTimes(1);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('連線已不可用時直接斷線，不再傳送 QUIT', async () => {
      const { service, client } = setup();
      client.status = 'end';

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();

      expect(client.quit).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    });

    it('QUIT 遇到競態失敗時記錄錯誤並強制斷線，不阻斷應用程式關機', async () => {
      const { service, client, logger } = setup();
      client.quit.mockRejectedValueOnce(new Error('synthetic disconnect'));

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Redis command failed: quit (synthetic disconnect)',
      );
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
