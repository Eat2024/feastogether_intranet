// TypeORM 的 query() 回傳 any；MySQL INSERT／UPDATE／DELETE 的執行結果
// 則由 mysql2 提供 affectedRows。此 helper 集中驗證該不可信的 driver 邊界。

/** 取得 MySQL 寫入操作影響的列數；結果格式不符時明確失敗。 */
export function getAffectedRowCount(result: unknown): number {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('affectedRows' in result) ||
    typeof result.affectedRows !== 'number'
  ) {
    throw new TypeError('MySQL mutation result 缺少數字型別的 affectedRows');
  }

  return result.affectedRows;
}
