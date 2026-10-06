// data-source.ts
// 供 TypeORM CLI（migration:generate / run / revert）使用的 DataSource。
// 僅相對 import（CLI 走 ts-node commonjs，無法解析 #app 子路徑）。
import { DataSource } from 'typeorm';
import { buildMysqlOptions } from './mysql.options';

export default new DataSource(buildMysqlOptions());
