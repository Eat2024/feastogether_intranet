/** 今天到指定日期還有幾天（日期格式 YYYY/MM/DD；負數表示已過） */
export function daysUntil(date: string, today: Date) {
  const [y, m, d] = date.split('/').map(Number);
  const due = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

/** 時間點轉成台北日期，格式 YYYY/MM/DD */
export function toTaipeiDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replaceAll('-', '/');
}

/** 時間點轉成台北時間，格式 YYYY/MM/DD HH:mm */
export function toTaipeiDateTime(date: Date) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${toTaipeiDate(date)} ${time}`;
}
