// 簽署人備註的規則（Server Action 與畫面共用）
export const SIGNER_NOTE_MAX = 30;

/** 以字元數計算（中文、emoji 都算一個字） */
export const noteLength = (text: string) => Array.from(text).length;

/** 去除前後空白並檢查長度；空字串表示清除備註 */
export function normalizeSignerNote(input: unknown): { note: string } | { error: string } {
  if (typeof input !== 'string') return { error: '備註格式不正確' };
  const note = input.trim();
  if (noteLength(note) > SIGNER_NOTE_MAX) return { error: `備註最多 ${SIGNER_NOTE_MAX} 個字` };
  return { note };
}
