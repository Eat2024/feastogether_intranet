/** 今天到指定日期還有幾天（日期格式 YYYY/MM/DD；負數表示已過） */
export function daysUntil(date: string, today: Date) {
  const [y, m, d] = date.split('/').map(Number);
  const due = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

const taipeiDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** API 的 ISO 時間固定以台北時間顯示，不受瀏覽器時區與語系格式影響。 */
export function formatTaipeiDateTime(iso: string): string {
  const parts = Object.fromEntries(taipeiDateTime.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

export const formatTaipeiDate = (iso: string) => formatTaipeiDateTime(iso).slice(0, 10);

/** 日期選擇器的日界線固定為台北時間，送往後端時轉成 UTC。 */
export const taipeiDayBoundary = (date: string, edge: 'start' | 'end') =>
  new Date(`${date.replaceAll('/', '-')}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}+08:00`).toISOString();
