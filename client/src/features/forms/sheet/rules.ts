// 簽到表的共用規則與資料整理（畫面、Server Action、PDF 共用）
import type { EFormDoc, FormStatus, SheetInfo, Signer } from '../types';

/** 簽到表只有一個簽名欄位（簽到格） */
export const SHEET_SIGN_FIELD_ID = 1;
/** PDF 每頁列數 */
export const SHEET_ROWS_PER_PAGE = 19;
export const SHEET_REMARK_MAX = 30;
export const SHEET_FIELDS_MAX = 12;
export const SHEET_LABEL_MAX = 10;
export const SHEET_VALUE_MAX = 60;
export const SHEET_TITLE_MAX = 30;
export const SHEET_CODE_MAX = 40;

export const DEFAULT_SHEET: SheetInfo = {
  title: '教育訓練簽到表',
  formCode: '',
  fields: [
    { label: '課程時間', value: '' },
    { label: '上課地點', value: '' },
    { label: '課程名稱', value: '' },
    { label: '立案編號', value: '' },
    { label: '講師', value: '' },
  ],
};

const chars = (s: string) => Array.from(s).length;

/** 檢查並整理簽到表設定（去除前後空白、略過標籤空白的欄位） */
export function validateSheet(input: unknown): SheetInfo | { error: string } {
  if (!input || typeof input !== 'object') return { error: '簽到表設定不正確' };
  const raw = input as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const formCode = typeof raw.formCode === 'string' ? raw.formCode.trim() : '';
  if (!title) return { error: '請輸入表單標題' };
  if (chars(title) > SHEET_TITLE_MAX) return { error: `表單標題最多 ${SHEET_TITLE_MAX} 個字` };
  if (chars(formCode) > SHEET_CODE_MAX) return { error: `表單編號最多 ${SHEET_CODE_MAX} 個字` };
  if (!Array.isArray(raw.fields)) return { error: '表頭欄位不正確' };
  const fields: SheetInfo['fields'] = [];
  for (const f of raw.fields as unknown[]) {
    const item = (f ?? {}) as Record<string, unknown>;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const value = typeof item.value === 'string' ? item.value.trim() : '';
    if (!label) {
      if (value) return { error: '有表頭欄位填了內容但沒有欄位名稱' };
      continue;
    }
    if (chars(label) > SHEET_LABEL_MAX) return { error: `欄位名稱最多 ${SHEET_LABEL_MAX} 個字` };
    if (chars(value) > SHEET_VALUE_MAX) return { error: `欄位內容最多 ${SHEET_VALUE_MAX} 個字` };
    fields.push({ label, value });
  }
  if (fields.length > SHEET_FIELDS_MAX) return { error: `表頭欄位最多 ${SHEET_FIELDS_MAX} 個` };
  return { title, formCode, fields };
}

/** 檢查簽到備註；空字串表示不填 */
export function normalizeRemark(input: unknown): { remark: string } | { error: string } {
  if (input === undefined) return { remark: '' };
  if (typeof input !== 'string') return { error: '備註格式不正確' };
  const remark = input.trim();
  if (chars(remark) > SHEET_REMARK_MAX) return { error: `備註最多 ${SHEET_REMARK_MAX} 個字` };
  return { remark };
}

/** 應到人數（含臨時追加的人）與實到人數（已簽到） */
export function attendance(form: EFormDoc) {
  return {
    expected: form.signers.length,
    actual: form.signers.filter((s) => s.status === 'signed').length,
  };
}

/** 簽到表的一列；signer 為 null 表示空白列（編輯時的預覽） */
export type SheetRow = { no: number; signer: Signer | null };

/**
 * 簽到表的所有列：原名單依加入順序，臨時追加的人接在後面。
 * only 指定時只保留該簽署人那一列（簽署人視角、個人副本），序號維持原本的位置。
 */
export function sheetRows(form: EFormDoc, opts: { only?: string } = {}): SheetRow[] {
  const ordered = [...form.signers.filter((s) => !s.lateAdded), ...form.signers.filter((s) => s.lateAdded)];
  const rows: SheetRow[] = ordered.map((signer, i) => ({ no: i + 1, signer }));
  return opts.only ? rows.filter((r) => r.signer?.id === opts.only) : rows;
}

/**
 * 簽到表發起後能否追加簽署人；可以時回傳 null，否則回傳原因。
 * 簽署中可追加；已完成追加後會回到簽署中；已到期需先補簽；已停止不可追加。
 */
export function sheetAddBlock(status: FormStatus): string | null {
  switch (status) {
    case 'active':
    case 'completed':
      return null;
    case 'expired':
      return '文件已到期，請先設定補簽再追加簽署人';
    case 'stopped':
      return '文件已停止簽署，無法追加簽署人';
    default:
      return '文件尚未發起，請在「設定簽署」中加入簽署人';
  }
}
