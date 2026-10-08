'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addExportRecord } from '@/features/export-history/store';
import { emailSignerId, isValidEmail, normalizeEmail } from '@/lib/email';
import { getCurrentUser, getStaff } from './orgChart';
import { normalizeSignerNote } from './detail/signerNote';
import { validateResign } from './resign';
import { deriveStatus, pendingCount, signedCount } from './status';
import {
  getForm,
  insertForm,
  nextDocNumber,
  todayStr,
  toSignerView,
  updateForm,
} from './store';
import type { EFormDoc, Signer, UploadInfo } from './types';

/** 現在時間，格式 YYYY/MM/DD HH:mm */
function nowStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export type ActionResult = { error: string } | undefined;

function revalidateLists() {
  // 'layout'：連同 /forms/[id] 等子頁面一起更新
  revalidatePath('/forms', 'layout');
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
  /** 可選功能：匯出文件加浮水印、允許拒絕簽署 */
  options: { watermark: boolean; allowReject: boolean };
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
  if (typeof input.options?.watermark !== 'boolean' || typeof input.options?.allowReject !== 'boolean') {
    return { error: '可選功能的設定不正確' };
  }
  const options = { watermark: input.options.watermark, allowReject: input.options.allowReject };
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
    updateForm(form.id, { signers, options });
    revalidateLists();
    redirect('/forms?flash=saved');
  }

  updateForm(form.id, {
    signers,
    options,
    status: 'active',
    startAt: input.deadline.start,
    endAt: input.deadline.end,
  });
  revalidateLists();
  redirect(`/forms?flash=published&count=${signers.length}`);
}

/** 通知（提醒）簽署人；未指定 signerIds 時通知所有待簽署者。只會通知待簽署的人，回傳實際通知人數 */
export async function notifySigners(input: {
  formId: string;
  signerIds?: string[];
}): Promise<{ error: string } | { count: number }> {
  const form = getForm(input.formId);
  if (!form) return { error: '找不到此文件' };
  if (deriveStatus(form) !== 'active') return { error: '只有簽署中的文件可以通知簽署人' };

  const wanted = input.signerIds ? new Set(input.signerIds) : null;
  const targets = form.signers.filter((s) => s.status === 'pending' && (!wanted || wanted.has(s.id)));
  if (targets.length === 0) return { error: '沒有可通知的待簽署者' };

  // TODO: 串接寄信／站內通知 API；目前僅記錄通知次數與時間
  const now = nowStr();
  for (const s of targets) {
    s.notifyCount = (s.notifyCount ?? 0) + 1;
    s.lastNotifiedAt = now;
  }
  revalidateLists();
  return { count: targets.length };
}

const signerLabel = (s: Signer) => `${s.name}（${s.employeeNo || s.email || '—'}）`;

/**
 * 取得某位簽署人已簽署副本所需的資料（含其手寫簽名），供管理端匯出個人的已簽署文件。
 * 只回傳該簽署人的紀錄，不帶出其他人的簽名；每次呼叫都會記入匯出紀錄。
 * TODO: 串接登入與權限後，限制只有文件建立人或管理者可以匯出
 */
export async function getSignerCopy(input: {
  formId: string;
  signerId: string;
}): Promise<{ error: string } | { form: EFormDoc; signer: Signer }> {
  const form = getForm(input.formId);
  if (!form) return { error: '找不到此文件' };
  const signer = form.signers.find((s) => s.id === input.signerId);
  if (!signer) return { error: '找不到此簽署人' };
  if (signer.status !== 'signed') return { error: '此簽署人尚未簽署，沒有可匯出的文件' };
  addExportRecord({
    kind: 'signerCopy',
    formId: form.id,
    formName: form.name,
    docNumber: form.docNumber ?? null,
    scope: signerLabel(signer),
    count: 1,
    signerId: signer.id,
  });
  return { form: toSignerView(form, signer.id), signer };
}

/**
 * 更新簽署人的備註（最多 30 字；空白表示清除）。
 * TODO: 串接登入與權限後，限制只有文件建立人或管理者可以修改
 */
export async function updateSignerNote(input: {
  formId: string;
  signerId: string;
  note: string;
}): Promise<{ error: string } | { note: string }> {
  const form = getForm(input.formId);
  if (!form) return { error: '找不到此文件' };
  const signer = form.signers.find((s) => s.id === input.signerId);
  if (!signer) return { error: '找不到此簽署人' };
  const result = normalizeSignerNote(input.note);
  if ('error' in result) return result;

  if (result.note) signer.note = result.note;
  else delete signer.note;
  revalidateLists();
  return { note: result.note };
}

/**
 * 補簽：文件到期後仍有人未簽署時，設定新的補簽期間與原因，重新開放未簽署者簽署。
 * 已簽署、已拒絕的人不受影響；補簽期間到期後若仍有人未簽署，可再次補簽。
 * TODO: 串接登入與權限後，限制只有文件建立人或管理者可以補簽；並通知未簽署者
 */
export async function reopenSigning(input: {
  formId: string;
  startAt: string;
  endAt: string;
  reason: string;
}): Promise<{ error: string } | { pending: number }> {
  const form = getForm(input.formId);
  if (!form) return { error: '找不到此文件' };
  if (deriveStatus(form) !== 'expired') return { error: '只有已到期且仍有人未簽署的文件可以補簽' };
  const result = validateResign(input, todayStr());
  if ('error' in result) return result;

  const me = getCurrentUser();
  form.resigns = [
    ...(form.resigns ?? []),
    {
      ...result,
      createdAt: nowStr(),
      createdBy: { name: me.name, employeeNo: me.employeeNo },
    },
  ];
  revalidateLists();
  return { pending: pendingCount(form) };
}
