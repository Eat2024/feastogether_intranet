/** 今天到指定日期還有幾天（日期格式 YYYY/MM/DD；負數表示已過） */
export function daysUntil(date: string, today: Date) {
  const [y, m, d] = date.split('/').map(Number);
  const due = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

/** YYYY/MM/DD → 當天開始（00:00）或結束（23:59:59.999）的 ISO 時間（本地時區） */
export function dayBoundary(date: string, edge: 'start' | 'end') {
  const [y, m, d] = date.split('/').map(Number);
  return (edge === 'start' ? new Date(y, m - 1, d) : new Date(y, m - 1, d, 23, 59, 59, 999)).toISOString();
}
