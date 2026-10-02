'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { emailSignerId, isValidEmail, normalizeEmail } from '@/lib/email';
import { getStaff } from './orgChart';
import { signedCount } from './status';
import {
  getCurrentUser,
  getForm,
  insertForm,
  nextDocNumber,
  updateForm,
} from './store';
import type { Signer, UploadInfo } from './types';

export type ActionResult = { error: string } | undefined;

function revalidateLists() {
  revalidatePath('/forms');
  revalidatePath('/my-signature');
}

/** 步驟一：建立或更新上傳文件。草稿接著前往設定簽署；已發起的文件存完回列表 */
export async function saveUploadDocument(input: {
  id?: string;
  name: string;
  upload: UploadInfo;
}): Promise<ActionResult> {
  const name = input.name.trim();
  const { upload } = input;
  if (!name) return { error: '請輸入文件名稱' };
  if (upload.pages <= 0) return { error: '請先上傳文件' };
  if (upload.mode === 'inline' && upload.fields.length === 0) {
    return { error: '請至少指定一個簽名位置，或改用系統簽署確認頁' };
  }
  const cleanUpload: UploadInfo = {
    ...upload,
    fields: upload.mode === 'inline' ? upload.fields : [],
  };

  if (input.id) {
    const form = getForm(input.id);
    if (!form) return { error: '找不到此文件' };
    if (signedCount(form) > 0 || form.status === 'stopped') {
      return { error: '此文件已有人簽署或已停止，無法再修改' };
    }
    updateForm(form.id, { name, upload: cleanUpload, docType: 'upload' });
    revalidateLists();
    if (form.status === 'draft') redirect(`/forms/${form.id}/signers`);
    redirect('/forms?flash=updated');
  }

  const id = `f${Date.now()}`;
  const me = getCurrentUser();
  insertForm({
    id,
    name,
    docNumber: nextDocNumber(),
    docType: 'upload',
    status: 'draft',
    startAt: null,
    endAt: null,
    signers: [],
    createdBy: { name: me.name, employeeNo: me.employeeNo },
    upload: cleanUpload,
  });
  revalidateLists();
  redirect(`/forms/${id}/signers`);
}

/** 步驟二：儲存簽署人與簽署期間；publish 為 true 時同時發起簽署 */
export async function saveSigners(input: {
  id: string;
  signerIds: string[];
  /** 以 Email 加入、未列入組織架構的簽署人 */
  emailSigners: { email: string; name: string }[];
  deadline: { start: string | null; end: string | null };
  publish: boolean;
}): Promise<ActionResult> {
  const form = getForm(input.id);
  if (!form) return { error: '找不到此文件' };
  if (form.status !== 'draft') return { error: '此文件已發起簽署，無法再修改簽署設定' };
  if (input.signerIds.length + input.emailSigners.length === 0) {
    return { error: '請至少選擇一位需簽署人員' };
  }
  const emails = input.emailSigners.map((e) => ({ email: normalizeEmail(e.email), name: e.name.trim().slice(0, 50) }));
  if (emails.some((e) => !isValidEmail(e.email))) return { error: 'Email 格式不正確' };
  if (new Set(emails.map((e) => e.email)).size !== emails.length) return { error: 'Email 不可重複加入' };
  if (input.publish) {
    const { start, end } = input.deadline;
    if (!start || !end) return { error: '請選擇簽署期間的開始日與結束日' };
    // 日期格式 YYYY/MM/DD，字串比較即為日期先後
    if (end < start) return { error: '結束日不能早於開始日' };
  }

  // 保留原本已設定簽署人的狀態，新加入的為待簽署
  const prevById = new Map(form.signers.map((s) => [s.id, s]));
  const signers: Signer[] = input.signerIds.flatMap((sid) => {
    const prev = prevById.get(sid);
    if (prev) return [prev];
    const emp = getStaff(sid);
    return emp
      ? [{ id: emp.id, name: emp.name, employeeNo: emp.employeeNo, status: 'pending' as const }]
      : [];
  });
  for (const { email, name } of emails) {
    const id = emailSignerId(email);
    // 未填姓名時以 email 顯示
    signers.push(prevById.get(id) ?? { id, name: name || email, employeeNo: '', email, status: 'pending' });
  }

  if (!input.publish) {
    updateForm(form.id, { signers });
    revalidateLists();
    redirect('/forms?flash=saved');
  }

  updateForm(form.id, {
    signers,
    status: 'active',
    startAt: input.deadline.start,
    endAt: input.deadline.end,
  });
  revalidateLists();
  redirect(`/forms?flash=published&count=${signers.length}`);
}
