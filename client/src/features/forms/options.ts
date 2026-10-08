// 文件的可選功能（設定簽署第二步設定）；舊資料沒有設定時使用預設值
import type { EFormDoc } from './types';

export type FormOptions = {
  /** 匯出／下載的已簽署文件（PDF）加上浮水印 */
  watermark: boolean;
  /** 簽署人可以拒絕簽署 */
  allowReject: boolean;
};

export const DEFAULT_FORM_OPTIONS: FormOptions = { watermark: false, allowReject: true };

/** 浮水印文字 */
export const WATERMARK_TEXT = '饗賓集團 內部文件 請勿外流';

export function formOptions(form: Pick<EFormDoc, 'options'>): FormOptions {
  return { ...DEFAULT_FORM_OPTIONS, ...form.options };
}
