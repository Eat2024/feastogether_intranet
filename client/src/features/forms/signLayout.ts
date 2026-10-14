import { SHEET_SIGN_FIELD_ID } from './sheet/rules';
import type { EFormDoc, UploadField } from './types';

// 欄位尺寸：上傳編輯器中為 108×46px、頁面寬 460px，這裡換算成頁面寬高的百分比，
// 讓預覽、實際簽署與產生 PDF 在任何尺寸下位置都一致
const EDITOR_PAGE_W = 460;
const EDITOR_PAGE_H = (EDITOR_PAGE_W * 297) / 210;
export const FIELD_W_PCT = (108 / EDITOR_PAGE_W) * 100;
export const FIELD_H_PCT = (46 / EDITOR_PAGE_H) * 100;

// 可調整的欄位尺寸範圍（頁面寬高的百分比）：太小無法簽名、太大會蓋住內容
export const FIELD_MIN_W_PCT = 8;
export const FIELD_MAX_W_PCT = 70;
export const FIELD_MIN_H_PCT = 2.5;
export const FIELD_MAX_H_PCT = 25;

/** 欄位的實際寬高（百分比）；未設定時為預設尺寸 */
export function fieldSize(f: Pick<UploadField, 'w' | 'h'>) {
  return { w: f.w ?? FIELD_W_PCT, h: f.h ?? FIELD_H_PCT };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 把寬高限制在允許範圍內，且不超出頁面（x、y 為左上角） */
export function clampFieldSize(x: number, y: number, w: number, h: number) {
  return {
    w: clamp(w, FIELD_MIN_W_PCT, Math.min(FIELD_MAX_W_PCT, 100 - x)),
    h: clamp(h, FIELD_MIN_H_PCT, Math.min(FIELD_MAX_H_PCT, 100 - y)),
  };
}

/** 檢查欄位位置與尺寸是否合理（server 端儲存前使用） */
export function isValidFieldBox(f: UploadField): boolean {
  const { w, h } = fieldSize(f);
  const nums = [f.x, f.y, w, h];
  const EPS = 0.01;
  return (
    nums.every(Number.isFinite) &&
    f.x >= 0 &&
    f.y >= 0 &&
    w >= FIELD_MIN_W_PCT - EPS &&
    w <= FIELD_MAX_W_PCT + EPS &&
    h >= FIELD_MIN_H_PCT - EPS &&
    h <= FIELD_MAX_H_PCT + EPS &&
    f.x + w <= 100 + EPS &&
    f.y + h <= 100 + EPS
  );
}

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
  // 簽到表只有一個簽到格（版面由簽到表畫面與 PDF 自行處理，這裡只提供欄位）
  if (form.docType === 'sheet') {
    return form.sheet
      ? { pageCount: 1, originalPages: 1, confirmPage: null, fields: [{ id: SHEET_SIGN_FIELD_ID, page: 1, x: 0, y: 0, type: 'sign' }] }
      : null;
  }
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
