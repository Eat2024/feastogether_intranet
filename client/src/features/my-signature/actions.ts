'use server';

import { getCurrentUserId, getStaff } from '@/features/forms/orgChart';
import { normalizeRemark, remainingWalkIns, walkInSigner } from '@/features/forms/sheet/rules';
import { getSignLayout, signFields } from '@/features/forms/signLayout';
import { getForm } from '@/features/forms/store';
import type { Signer } from '@/features/forms/types';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { isValidSignatureId } from '@/lib/signatureQr';
import { formOptions } from '@/features/forms/options';
import { getSignBlock } from './sign/eligibility';
import { SIGN_TERMS_VERSION } from './sign/terms';
import { randomUUID } from 'node:crypto';
import { ACTION_FAILED_MESSAGE } from '@/lib/actionError';
import { EsignApiError } from '@/lib/api/esign';
import { openSigningTask, submitSignatures } from './serverApi';

type ActionResult = { error: string } | undefined;

const PNG_PREFIX = 'data:image/png;base64,';
// 單一簽名圖檔上限（base64 字元數），避免異常大的內容
const MAX_SIGNATURE_LENGTH = 400_000;

/** 現在時間，格式 YYYY/MM/DD HH:mm */
function nowStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 找出目前使用者在此文件的簽署紀錄。
 * 簽到表還有空白列時，名單外的同仁也可以簽到：回傳尚未加入文件的簽署人（walkIn），送出簽到時才加入。
 */
function findMe(
  formId: string,
): { signer: Signer; form: NonNullable<ReturnType<typeof getForm>>; isNew: boolean } | { error: string } {
  const form = getForm(formId);
  if (!form) return { error: '找不到此文件' };
  const userId = getCurrentUserId();
  let signer = form.signers.find((s) => s.id === userId);
  let isNew = false;
  if (!signer) {
    const staff = getStaff(userId);
    if (!staff || remainingWalkIns(form) === 0) return { error: '你不是此文件的簽署人' };
    signer = walkInSigner(staff);
    isNew = true;
  }
  const block = getSignBlock(form, signer, new Date());
  if (block) return { error: block };
  return { signer, form, isNew };
}

function revalidateLists() {
  revalidatePath('/forms');
  revalidatePath('/my-signature', 'layout');
}

/** 送出簽署：每個簽名欄位都必須有手寫簽名 */
export async function signDocument(input: {
  formId: string;
  signatures: Record<number, string>;
  /** 各簽名欄位的識別碼（追蹤 QR code 用） */
  signatureIds: Record<number, string>;
  consent: { version: string; agreedAt: string };
  /** 簽到表：簽署人自行填寫的備註（選填） */
  remark?: string;
}): Promise<ActionResult> {
  // 不在 mock store 的是後端簽署任務（id 為 signerPublicId）
  if (!getForm(input.formId)) return signApiTask(input);
  const found = findMe(input.formId);
  if ('error' in found) return found;
  const { form, signer, isNew } = found;
  const remark = normalizeRemark(input.remark);
  if ('error' in remark) return remark;

  if (input.consent.version !== SIGN_TERMS_VERSION) {
    return { error: '電子簽名使用條款已更新，請重新閱讀並同意' };
  }
  const required = signFields(getSignLayout(form)!);
  const missing = required.filter((f) => !input.signatures[f.id]);
  if (missing.length > 0) return { error: `還有 ${missing.length} 個簽名欄位尚未簽名` };
  const invalid = required.some((f) => {
    const sig = input.signatures[f.id];
    return !sig.startsWith(PNG_PREFIX) || sig.length > MAX_SIGNATURE_LENGTH;
  });
  if (invalid) return { error: '簽名資料格式不正確，請重新簽名' };
  const ids = required.map((f) => input.signatureIds[f.id]);
  if (ids.some((id) => !id || !isValidSignatureId(id)) || new Set(ids).size !== ids.length) {
    return { error: '簽名識別碼不正確，請重新簽名' };
  }

  Object.assign(signer, {
    status: 'signed',
    signedAt: nowStr(),
    signatures: Object.fromEntries(required.map((f) => [f.id, input.signatures[f.id]])),
    signatureIds: Object.fromEntries(required.map((f) => [f.id, input.signatureIds[f.id]])),
    consent: input.consent,
    // 簽到表才有簽署人備註
    ...(form.docType === 'sheet' && remark.remark ? { remark: remark.remark } : {}),
  } satisfies Partial<Signer>);
  // 名單外人員使用空白列簽到：簽到完成才加入文件（加入前再確認仍有空白列）
  if (isNew) {
    if (remainingWalkIns(form) === 0) return { error: '空白列已用完，無法簽到，請聯絡發起人' };
    form.signers.push(signer);
  }
  revalidateLists();
  redirect('/my-signature?tab=signed&flash=signed');
}

const SIGNER_PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 後端簽署任務：先開啟任務（記錄開啟並確認仍可簽署），再送出本人所有簽名欄位。
 * 條款版本、欄位與簽名格式由後端驗證；日期欄位由後端依簽署時間帶入。
 */
async function signApiTask(input: {
  formId: string;
  signatures: Record<number, string>;
  consent: { version: string };
}): Promise<ActionResult> {
  if (!SIGNER_PUBLIC_ID.test(input.formId)) return { error: '找不到此文件' };
  const signatures = Object.entries(input.signatures).map(([fieldId, pngDataUrl]) => ({ fieldId, pngDataUrl }));
  if (signatures.length === 0) return { error: '請完成所有簽名欄位' };
  try {
    await openSigningTask(input.formId);
    await submitSignatures(input.formId, {
      requestId: randomUUID(),
      consentVersion: input.consent.version,
      accepted: true,
      signatures,
    });
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof EsignApiError ? error.message : ACTION_FAILED_MESSAGE };
  }
  revalidateLists();
  redirect('/my-signature?tab=signed&flash=signed');
}

/** 拒絕簽署；原因選填。其他簽署人仍可繼續簽署 */
export async function rejectDocument(input: { formId: string; reason: string }): Promise<ActionResult> {
  const found = findMe(input.formId);
  if ('error' in found) return found;
  if (!formOptions(found.form).allowReject) return { error: '此文件不開放拒絕簽署' };
  const reason = input.reason.trim();

  Object.assign(found.signer, {
    status: 'rejected',
    rejectedAt: nowStr(),
    rejectReason: reason || undefined,
  } satisfies Partial<Signer>);
  revalidateLists();
  redirect('/my-signature?tab=rejected&flash=rejected');
}
