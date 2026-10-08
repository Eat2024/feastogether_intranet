// 補簽的輸入規則（Server Action 與畫面共用）
export const RESIGN_REASON_MAX = 200;

const DATE = /^(\d{4})\/(\d{2})\/(\d{2})$/;

/** 是否為存在的日期（YYYY/MM/DD） */
function isValidDate(v: string) {
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export type ResignInput = { startAt: string; endAt: string; reason: string };

/**
 * 檢查補簽期間與原因；today 為 YYYY/MM/DD。
 * 規則：開始日不可早於今天、結束日不可早於開始日、原因必填且不超過上限。
 */
export function validateResign(
  input: { startAt: unknown; endAt: unknown; reason: unknown },
  today: string,
): ResignInput | { error: string } {
  const { startAt, endAt, reason } = input;
  if (typeof startAt !== 'string' || !isValidDate(startAt)) return { error: '請選擇補簽開始日' };
  if (typeof endAt !== 'string' || !isValidDate(endAt)) return { error: '請選擇補簽結束日' };
  // YYYY/MM/DD 可直接以字串比較先後
  if (startAt < today) return { error: '補簽開始日不可早於今天' };
  if (endAt < startAt) return { error: '補簽結束日不可早於開始日' };
  if (typeof reason !== 'string' || !reason.trim()) return { error: '請填寫補簽原因' };
  const trimmed = reason.trim();
  if (Array.from(trimmed).length > RESIGN_REASON_MAX) return { error: `補簽原因最多 ${RESIGN_REASON_MAX} 個字` };
  return { startAt, endAt, reason: trimmed };
}
