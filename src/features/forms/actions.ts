'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { signedCount } from './status';
import {
  getCurrentUser,
  getEmployees,
  getForm,
  insertForm,
  nextDocNumber,
  todayStr,
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
  deadline: { start: string | null; end: string | null };
  publish: boolean;
}): Promise<ActionResult> {
  const form = getForm(input.id);
  if (!form) return { error: '找不到此文件' };
  if (form.status !== 'draft') return { error: '此文件已發起簽署，無法再修改簽署設定' };
  if (input.signerIds.length === 0) return { error: '請至少選擇一位需簽署人員' };

  // 保留原本已設定簽署人的狀態，新加入的為待簽署
  const prevById = new Map(form.signers.map((s) => [s.id, s]));
  const employees = new Map(getEmployees().map((e) => [e.id, e]));
  const signers: Signer[] = input.signerIds.flatMap((sid) => {
    const prev = prevById.get(sid);
    if (prev) return [prev];
    const emp = employees.get(sid);
    return emp
      ? [{ id: emp.id, name: emp.name, employeeNo: emp.employeeNo, status: 'pending' as const }]
      : [];
  });

  if (!input.publish) {
    updateForm(form.id, { signers });
    revalidateLists();
    redirect('/forms?flash=saved');
  }

  updateForm(form.id, {
    signers,
    status: 'active',
    startAt: input.deadline.start ?? todayStr(),
    endAt: input.deadline.end,
  });
  revalidateLists();
  redirect(`/forms?flash=published&count=${signers.length}`);
}
