import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_MAIN = 'REDIS_MAIN';

export const redisProviders: Provider[] = [
  {
    provide: REDIS_MAIN,
    inject: [ConfigService],
    useFactory: async (config: ConfigService) => {
      const client = new Redis({
        host: config.get<string>('REDIS_HOST'),
        port: config.get<number>('REDIS_PORT'),
        password: config.get<string>('REDIS_PASSWORD'),
        // 環境隔離:REDIS_DB 未設定→db 0(dev/UAT/prod 不變);e2e 以 .env.test 設 1。
        db: Number(config.get<string>('REDIS_DB') ?? '0'),
        lazyConnect: true,
        enableOfflineQueue: false,
        retryStrategy() {
          return null;
        },
        reconnectOnError() {
          return false;
        },
      });

      await client.connect();

      return client;
    },
  },
];
