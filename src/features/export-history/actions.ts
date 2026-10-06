'use server';

import { buildListExport } from '@/features/forms/export/listExport';
import { getForm, toSignerView } from '@/features/forms/store';
import type { EFormDoc, Signer } from '@/features/forms/types';
import officeCrypto from 'officecrypto-tool';
import { revalidatePath } from 'next/cache';
import { isAdmin } from './admin';
import { checkPassword } from './password';
import { getExportRecord, markRedownloaded } from './store';
import type { ExportRecord } from './types';

type Fail = { error: string };

function loadRecord(recordId: string): Fail | { record: ExportRecord; form: EFormDoc } {
  if (!isAdmin()) return { error: '只有管理者可以重新下載匯出文件' };
  const record = getExportRecord(recordId);
  if (!record) return { error: '找不到此匯出紀錄' };
  const form = getForm(record.formId);
  if (!form || form.status === 'draft') return { error: '原文件已不存在，無法重新下載' };
  return { record, form };
}

/**
 * 重新下載簽署紀錄清單：依當時的匯出條件以目前資料重新產生。
 * 有 password 時以 Office 標準加密，開啟時需輸入密碼（目前畫面暫不提供設定密碼）。
 * 回傳 base64，由瀏覽器端組成檔案下載。
 */
export async function redownloadList(input: {
  recordId: string;
  password?: string;
}): Promise<Fail | { fileName: string; base64: string }> {
  const loaded = loadRecord(input.recordId);
  if ('error' in loaded) return loaded;
  const { record, form } = loaded;
  if (record.kind !== 'list' || !record.query) return { error: '匯出紀錄類型不符' };
  if (input.password !== undefined) {
    const invalid = checkPassword(input.password);
    if (invalid) return { error: invalid };
  }

  const { file, fileName } = await buildListExport(form, record.query);
  const output: Buffer = input.password ? officeCrypto.encrypt(file, { password: input.password }) : file;
  markRedownloaded(record);
  revalidatePath('/export-history');
  return { fileName, base64: output.toString('base64') };
}

/**
 * 重新下載個人已簽署文件所需的資料（只含該簽署人的紀錄）。
 * PDF 在瀏覽器端產生（需要加密時也在瀏覽器端處理，密碼不會傳到伺服器）。
 */
export async function getRedownloadCopy(input: {
  recordId: string;
}): Promise<Fail | { form: EFormDoc; signer: Signer; fileName: string }> {
  const loaded = loadRecord(input.recordId);
  if ('error' in loaded) return loaded;
  const { record, form } = loaded;
  if (record.kind !== 'signerCopy') return { error: '匯出紀錄類型不符' };
  const signer = form.signers.find((s) => s.id === record.signerId);
  if (!signer || signer.status !== 'signed') return { error: '此簽署人的簽署紀錄已不存在，無法重新下載' };

  markRedownloaded(record);
  revalidatePath('/export-history');
  return {
    form: toSignerView(form, signer.id),
    signer,
    fileName: `${form.docNumber ?? form.id}_${form.name}_${signer.name}${signer.employeeNo}_已簽署.pdf`,
  };
}
