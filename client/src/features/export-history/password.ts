// 重新下載檔案的開啟密碼規則（前後端共用）
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

/** 回傳錯誤訊息；符合規則時回傳 null */
export function checkPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `密碼至少需 ${PASSWORD_MIN} 個字元`;
  if (password.length > PASSWORD_MAX) return `密碼最多 ${PASSWORD_MAX} 個字元`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密碼需同時包含英文字母與數字';
  return null;
}
