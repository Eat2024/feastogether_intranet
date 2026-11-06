import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Portal MySQL 唯讀連線設定（PORTAL_MYSQL_*）。
 *
 * 採延遲驗證：取用時才檢查必填值，設定缺漏不影響 HTTP 與 worker 啟動，
 * 只讓查詢 Portal 的功能失敗。缺漏時拋一般 Error，由呼叫端轉成各自的錯誤碼；訊息只含變數名稱。
 */
@Injectable()
export class PortalConfig {
  constructor(private readonly config: ConfigService) {}

  get host(): string {
    return this.require('PORTAL_MYSQL_HOST');
  }

  get port(): number {
    return Number(this.config.get<string>('PORTAL_MYSQL_PORT') || 3306);
  }

  get user(): string {
    return this.require('PORTAL_MYSQL_USER');
  }

  /** 可留空，與 DB_MYSQL_PASS 相同（MySQL 允許空密碼；合成 Portal 沿用本機測試 DB 的帳密）。 */
  get password(): string {
    return this.config.get<string>('PORTAL_MYSQL_PASS') ?? '';
  }

  get database(): string {
    return this.require('PORTAL_MYSQL_DB');
  }

  private require(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Portal 連線設定缺少 ${key}`);
    }
    return value;
  }
}
