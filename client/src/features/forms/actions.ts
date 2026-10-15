'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { addExportRecord } from '@/features/export-history/store';
import { emailSignerId, isValidEmail, normalizeEmail } from '@/lib/email';
import { getCurrentUser, getStaff } from './orgChart';
import { normalizeSignerNote } from './detail/signerNote';
import { getStoredFile } from './files';
import { isValidFieldBox } from './signLayout';
import { validateResign } from './resign';
import { sheetExportData, type SheetExport } from './sheet/exportData';
import { validateSheet } from './sheet/rules';
import { deriveStatus, pendingCount, signedCount } from './status';
import {
  getForm,
  insertForm,
  nextDocNumber,
  todayStr,
  toSignerView,
  updateForm,
} from './store';
import type { EFormDoc, SheetInfo, Signer, UploadInfo } from './types';
import { ACTION_FAILED_MESSAGE } from '@/lib/actionError';
import { EsignApiError } from '@/lib/api/esign';
import {
  getDocument,
  initiateDocument,
  listSignerCandidates,
  replaceFields,
  replaceSigners,
  deleteDraftDocument,
  stopDocument,
  type SignerInput,
} from './serverApi';

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
  // 新文件必須上傳原始檔，頁數以伺服器讀出的為準；
  // 舊資料（沒有原始檔）編輯時若沒重新上傳，沿用原本的示意頁數
  let fileId: string | undefined;
  if (upload.fileId || !input.id) {
    const stored = getStoredFile(upload.fileId);
    if (!stored) return { error: '找不到上傳的檔案，請重新上傳文件' };
    if (upload.pages !== stored.pages) return { error: '文件頁數與上傳的檔案不符，請重新上傳文件' };
    fileId = stored.id;
  }
  if (upload.fields.some((f) => f.page < 1 || f.page > upload.pages)) {
    return { error: '簽名位置超出文件頁數，請重新指定' };
  }
  if (upload.fields.some((f) => (f.type !== 'sign' && f.type !== 'date') || !isValidFieldBox(f))) {
    return { error: '欄位位置或大小不正確，請重新調整' };
  }
  const cleanUpload: UploadInfo = {
    ...upload,
    fileId,
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
  // 不在 mock store 的是後端文件
  if (!form) return saveApiSigners(input);
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
    // 記下加入時的單位與職稱（簽到表顯示用）
    return emp
      ? [{ id: emp.id, name: emp.name, employeeNo: emp.employeeNo, unit: emp.dept, title: emp.title, status: 'pending' as const }]
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 後端文件的設定簽署（畫面沿用 SignersEditor，由 saveSigners 轉呼叫）。
 * 欄位位置以後端草稿為準；畫面沒有指定欄位簽署人的地方，只有一位簽署人時所有欄位都屬於他。
 * 可選功能（浮水印、拒絕簽署）於發起時送出；暫存設定不保存。
 */
async function saveApiSigners(input: {
  id: string;
  signerIds: string[];
  emailSigners: { email: string; name: string }[];
  deadline: { start: string | null; end: string | null };
  options: { watermark: boolean; allowReject: boolean };
  publish: boolean;
}): Promise<ActionResult> {
  if (!/^[1-9][0-9]*$/.test(input.id)) return { error: '找不到此文件' };
  const count = input.signerIds.length + input.emailSigners.length;
  if (count === 0) return { error: '請至少選擇一位需簽署人員' };
  if (count > 50) return { error: '簽署人不可超過 50 位' };
  const emails = input.emailSigners.map((e) => ({ email: normalizeEmail(e.email), name: e.name.trim() }));
  if (emails.some((e) => !isValidEmail(e.email))) return { error: 'Email 格式不正確' };
  if (new Set(emails.map((e) => e.email)).size !== emails.length) return { error: 'Email 不可重複加入' };
  if (typeof input.options?.watermark !== 'boolean' || typeof input.options?.allowReject !== 'boolean') {
    return { error: '可選功能的設定不正確' };
  }

  let period: { signStartAt: string; signEndAt: string } | undefined;
  if (input.publish) {
    const { start, end } = input.deadline;
    if (!start || !end) return { error: '請選擇簽署期間的開始日與結束日' };
    // 日期格式 YYYY/MM/DD，字串比較即為日期先後
    if (end < start) return { error: '結束日不能早於開始日' };
    const startAt = new Date(`${start.replaceAll('/', '-')}T00:00:00+08:00`);
    // 後端的簽署期間不含截止時間點，截止設為結束日隔天 00:00（台北），結束日當天仍可簽署
    const endAt = new Date(new Date(`${end.replaceAll('/', '-')}T00:00:00+08:00`).getTime() + DAY_MS);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) return { error: '簽署期間不正確' };
    if (endAt.getTime() <= Date.now()) return { error: '結束日不能早於今天' };
    period = { signStartAt: startAt.toISOString(), signEndAt: endAt.toISOString() };
  }

  try {
    // 組織架構的同仁以員工編號對應後端的 user id
    const internal = await Promise.all(
      input.signerIds.map(async (sid) => {
        const staff = getStaff(sid);
        const employeeNo = staff?.employeeNo ?? sid;
        const candidates = await listSignerCandidates(employeeNo);
        return { name: staff?.name ?? sid, candidate: candidates.find((c) => c.employeeNo === employeeNo) };
      }),
    );
    const missing = internal.filter((s) => !s.candidate).map((s) => s.name);
    if (missing.length > 0) {
      return { error: `以下人員尚未在電子簽系統建立帳號，無法指定為簽署人：${missing.join('、')}` };
    }
    const signers: SignerInput[] = [
      ...internal.flatMap((s) => (s.candidate ? [{ type: 'user' as const, userId: s.candidate.id }] : [])),
      // 未填姓名時以 Email 作為姓名（後端姓名必填，上限 100 字）
      ...emails.map((e) => ({ type: 'email' as const, email: e.email, name: (e.name || e.email).slice(0, 100) })),
    ];

    const document = await getDocument(input.id);
    if (document.status !== 'draft') return { error: '此文件已發起簽署，無法再修改簽署設定' };
    // 只取欄位位置送回後端（後端拒絕未定義的屬性）
    const positions = document.fields.map((f) => ({
      type: f.type,
      page: f.page,
      xPercent: f.xPercent,
      yPercent: f.yPercent,
      widthPercent: f.widthPercent,
      heightPercent: f.heightPercent,
      sortOrder: f.sortOrder,
    }));
    const single = signers.length === 1;

    if (period) {
      if (positions.length === 0) return { error: '此文件沒有簽名欄位，無法發起簽署' };
      if (!single) return { error: '目前只支援一位簽署人發起簽署（多位簽署人需指定每個欄位由誰簽署）' };
      if (!positions.some((p) => p.type === 'signature')) return { error: '每位簽署人至少需要一個簽名欄位' };
      await initiateDocument(input.id, {
        signers,
        fields: positions.map((p) => ({ ...p, signerIndex: 0 })),
        ...period,
        watermark: input.options.watermark,
        allowReject: input.options.allowReject,
      });
    } else {
      // 取代簽署人會解除所有欄位的指派；只有一位簽署人時寫回指派
      const saved = await replaceSigners(input.id, signers);
      const signerPublicId = single ? (saved[0]?.publicId ?? null) : null;
      await replaceFields(input.id, positions.map((p) => ({ ...p, signerPublicId })));
    }
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof EsignApiError ? error.message : ACTION_FAILED_MESSAGE };
  }

  revalidateLists();
  redirect(input.publish ? `/forms?flash=published&count=${count}` : '/forms?flash=saved');
}

const BACKEND_ID = /^[1-9][0-9]*$/;

/** 不在 mock store 的文件：後端文件（數字 id）目前沒有對應功能的 API，其餘視為找不到 */
function notInMockStore(formId: string): { error: string } {
  return { error: BACKEND_ID.test(formId) ? '正式電子簽流程尚未提供此功能' : '找不到此文件' };
}

// 確認視窗沒有填寫理由的欄位，先以固定理由送出（後端理由必填）
const STOP_REASON = '建立人停止簽署';

/** 停止簽署：後端文件呼叫停止 API；示意資料（mock store）維持原型尚未實作的狀態 */
export async function stopSigning(input: { formId: string }): Promise<ActionResult> {
  if (getForm(input.formId)) return undefined;
  if (!BACKEND_ID.test(input.formId)) return { error: '找不到此文件' };
  try {
    await stopDocument(input.formId, STOP_REASON);
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof EsignApiError ? error.message : ACTION_FAILED_MESSAGE };
  }
  revalidateLists();
}

/** 刪除文件：後端文件呼叫刪除 API（只限草稿）；示意資料（mock store）維持原型尚未實作的狀態 */
export async function deleteDocument(input: { formId: string }): Promise<ActionResult> {
  if (getForm(input.formId)) return undefined;
  if (!BACKEND_ID.test(input.formId)) return { error: '找不到此文件' };
  try {
    await deleteDraftDocument(input.formId);
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof EsignApiError ? error.message : ACTION_FAILED_MESSAGE };
  }
  revalidateLists();
}

/** 通知（提醒）簽署人；未指定 signerIds 時通知所有待簽署者。只會通知待簽署的人，回傳實際通知人數 */
export async function notifySigners(input: {
  formId: string;
  signerIds?: string[];
}): Promise<{ error: string } | { count: number }> {
  const form = getForm(input.formId);
  if (!form) return notInMockStore(input.formId);
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
  if (!form) return notInMockStore(input.formId);
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
  if (!form) return notInMockStore(input.formId);
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

/**
 * 新增或修改簽到表（流程第一步）：表頭欄位自行設定，表格依簽署名單自動產生。
 */
export async function saveSheetDocument(input: {
  id?: string;
  name: string;
  sheet: SheetInfo;
}): Promise<ActionResult> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { error: '請輸入文件名稱' };
  const sheet = validateSheet(input.sheet);
  if ('error' in sheet) return sheet;

  if (input.id) {
    const form = getForm(input.id);
    if (!form) return { error: '找不到此文件' };
    if (signedCount(form) > 0 || form.status === 'stopped') {
      return { error: '此文件已有人簽署或已停止，無法再修改' };
    }
    if (form.signers.some((s) => s.walkIn) && sheet.walkInSlots < form.signers.filter((s) => s.walkIn).length) {
      return { error: '空白列數不可少於已使用的列數' };
    }
    updateForm(form.id, { name, sheet, docType: 'sheet', upload: undefined });
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
    docType: 'sheet',
    status: 'draft',
    startAt: null,
    endAt: null,
    signers: [],
    createdBy: { name: me.name, employeeNo: me.employeeNo },
    sheet,
    // 簽到表不開放拒絕簽署
    options: { watermark: false, allowReject: false },
  });
  revalidateLists();
  redirect(`/forms/${id}/signers`);
}

/**
 * 匯出整份簽到表所需的資料（含所有人的簽到簽名），每次呼叫都會記入匯出紀錄。
 * TODO: 串接登入與權限後，限制只有文件建立人或管理者可以匯出
 */
export async function getSheetExport(input: { formId: string }): Promise<{ error: string } | SheetExport> {
  const form = getForm(input.formId);
  if (!form || form.docType !== 'sheet' || !form.sheet) return { error: '找不到此簽到表' };
  if (form.status === 'draft') return { error: '簽到表尚未發起，沒有可匯出的資料' };
  const data = sheetExportData(form);
  addExportRecord({
    kind: 'sheet',
    formId: form.id,
    formName: form.name,
    docNumber: form.docNumber ?? null,
    scope: `整份簽到表（應到 ${data.attendance.expected} 人；實到 ${data.attendance.actual} 人）`,
    count: data.attendance.actual,
  });
  return data;
}
