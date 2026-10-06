// mysql-lifecycle.service.ts
// 關閉應用時銷毀 MySQL 連線池。
//
// 為什麼需要：MYSQL_MAIN 由 useFactory 建立 `new DataSource()` 並 initialize()，
// 而 Nest 的 app.close() 只會呼叫「實作了生命週期介面的 provider」——一個普通的
// DataSource 物件不在此列，因此連線池從未被銷毀。
//
// 後果有二：
//   1. e2e 單一 Jest process 內跨 suite 累積：30 個建立 app 的 suite × pool 5 ≈ 150，
//      加上基線即逼近 max_connections（151），造成偶發的 "Too many connections"。
//      該錯誤回應為 HTTP 500，與真正的程式錯誤難以分辨。
//   2. 正式環境容器停止時連線留到 MySQL wait_timeout（預設 28800 秒）才釋放；
//      滾動部署期間新舊容器並存，兩邊各持一個 pool。
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MYSQL_MAIN } from './mysql.tokens';

@Injectable()
export class MysqlLifecycleService implements OnModuleDestroy {
  private readonly logger = new Logger(MysqlLifecycleService.name);

  constructor(@Inject(MYSQL_MAIN) private readonly dataSource: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.dataSource.isInitialized) return;
    try {
      await this.dataSource.destroy();
    } catch (error) {
      // 關閉失敗不得阻擋應用結束；記錄後放行，讓連線由 wait_timeout 回收。
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to destroy MySQL connection pool: ${reason}`);
    }
  }
}
