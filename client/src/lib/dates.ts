/** 今天到指定日期還有幾天（日期格式 YYYY/MM/DD；負數表示已過） */
export function daysUntil(date: string, today: Date) {
  const [y, m, d] = date.split('/').map(Number);
  const due = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}
