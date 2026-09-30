import type { EFormDoc, UploadField } from './types';

// 欄位尺寸：上傳編輯器中為 108×46px、頁面寬 460px，這裡換算成頁面寬高的百分比，
// 讓預覽、實際簽署與產生 PDF 在任何尺寸下位置都一致
const EDITOR_PAGE_W = 460;
const EDITOR_PAGE_H = (EDITOR_PAGE_W * 297) / 210;
export const FIELD_W_PCT = (108 / EDITOR_PAGE_W) * 100;
export const FIELD_H_PCT = (46 / EDITOR_PAGE_H) * 100;

// 系統簽署確認頁上的固定欄位（id 用負數，避免與上傳時指定的欄位衝突）
const CONFIRM_FIELDS: Omit<UploadField, 'page'>[] = [
  { id: -1, x: 10, y: 66, type: 'sign' },
  { id: -2, x: 60, y: 66, type: 'date' },
];

export type SignLayout = {
  /** 含系統確認頁的總頁數 */
  pageCount: number;
  /** 原文件頁數 */
  originalPages: number;
  /** 系統簽署確認頁的頁碼；沒有則為 null */
  confirmPage: number | null;
  fields: UploadField[];
};

/** 簽署時的版面；沒有上傳文件設定（例如草稿）時回傳 null */
export function getSignLayout(form: EFormDoc): SignLayout | null {
  const up = form.upload;
  if (!up || up.pages <= 0) return null;
  if (up.mode === 'confirmPage') {
    const confirmPage = up.pages + 1;
    return {
      pageCount: confirmPage,
      originalPages: up.pages,
      confirmPage,
      fields: CONFIRM_FIELDS.map((f) => ({ ...f, page: confirmPage })),
    };
  }
  return { pageCount: up.pages, originalPages: up.pages, confirmPage: null, fields: up.fields };
}

/** 需要手寫簽名的欄位，依頁碼、由上而下排序 */
export function signFields(layout: SignLayout) {
  return layout.fields
    .filter((f) => f.type === 'sign')
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}
