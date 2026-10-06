// mysql.provider.ts
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { buildMysqlOptions } from './mysql.options';
import { MYSQL_MAIN } from './mysql.tokens';

const logger = new Logger('MysqlProvider');

export const MysqlProvider = {
  provide: MYSQL_MAIN,
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    // 連線設定與 migration CLI 共用同一份（mysql.options.ts），避免漂移。
    const dataSource = new DataSource(
      buildMysqlOptions((key) => config.get<string>(key)),
    );

    try {
      await dataSource.initialize();
      logger.log('[MySQL] main connected');
    } catch (err: unknown) {
      // ⚠️ 不 throw：服務先起來
      logger.error(
        `[MySQL] connect failed, service still running: ${getErrorMessage(err)}`,
      );
    }

    return dataSource;
  },
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
