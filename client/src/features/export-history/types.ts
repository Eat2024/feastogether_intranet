import type { ExportQuery } from '@/features/forms/export/exportQuery';
import type { Employee } from '@/features/forms/types';

/** list：簽署紀錄清單（Excel）；signerCopy：個人已簽署文件（PDF） */
export type ExportKind = 'list' | 'signerCopy';

export type ExportRecord = {
  id: string;
  kind: ExportKind;
  formId: string;
  /** 匯出當時的文件名稱與編號（文件之後被改名或刪除仍可辨識） */
  formName: string;
  docNumber: string | null;
  /** YYYY/MM/DD HH:mm */
  exportedAt: string;
  exportedBy: Employee & { id: string };
  /** 匯出範圍的文字說明 */
  scope: string;
  /** 匯出筆數（PDF 為 1） */
  count: number;
  /** 重新下載用：Excel 的匯出條件 */
  query?: ExportQuery;
  /** 重新下載用：PDF 的簽署人 */
  signerId?: string;
  redownloads: number;
  lastRedownloadAt?: string;
};
