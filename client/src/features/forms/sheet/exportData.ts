// 整份簽到表匯出所需的資料（僅供伺服器端使用）：只保留產生簽到表需要的欄位
import type { EFormDoc } from '../types';
import { attendance, sheetRows, type SheetRow } from './rules';

export type SheetExport = {
  form: EFormDoc;
  rows: SheetRow[];
  attendance: { expected: number; actual: number };
  fileName: string;
};

export function sheetExportData(stored: EFormDoc): SheetExport {
  // 不帶出管理端備註、條款同意紀錄與簽名識別碼
  const form: EFormDoc = {
    ...stored,
    signers: stored.signers.map((s) => ({ ...s, note: undefined, consent: undefined, signatureIds: undefined })),
  };
  return {
    form,
    rows: sheetRows(form),
    attendance: attendance(form),
    fileName: `${form.docNumber ?? form.id}_${form.name}_簽到表.pdf`,
  };
}
