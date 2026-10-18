import { type DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

/** API producer 有限等待；worker 保留可持續重連的連線。 */
@Module({})
export class BullRootModule {
  static register(role: 'producer' | 'worker'): DynamicModule {
    return {
      module: BullRootModule,
      imports: [
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: {
              host: config.get<string>('REDIS_HOST', '127.0.0.1'),
              port: config.get<number>('REDIS_PORT', 6379),
              password: config.get<string>('REDIS_PASSWORD') || undefined,
              db: config.get<number>('REDIS_DB', 0),
              ...(role === 'producer'
                ? {
                    maxRetriesPerRequest: 0,
                    enableOfflineQueue: false,
                    connectTimeout: 500,
                    commandTimeout: 500,
                  }
                : { maxRetriesPerRequest: null }),
            },
          }),
        }),
      ],
      exports: [BullModule],
    };
  }
}
