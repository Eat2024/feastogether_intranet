'use server';

import { CURRENT_USER_ID } from '@/features/forms/mock';
import { getSignLayout, signFields } from '@/features/forms/signLayout';
import { getForm } from '@/features/forms/store';
import type { Signer } from '@/features/forms/types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSignBlock } from './sign/eligibility';
import { SIGN_TERMS_VERSION } from './sign/terms';

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

function findMe(formId: string): { signer: Signer; form: NonNullable<ReturnType<typeof getForm>> } | { error: string } {
  const form = getForm(formId);
  if (!form) return { error: '找不到此文件' };
  const signer = form.signers.find((s) => s.id === CURRENT_USER_ID);
  if (!signer) return { error: '你不是此文件的簽署人' };
  const block = getSignBlock(form, signer, new Date());
  if (block) return { error: block };
  return { signer, form };
}

function revalidateLists() {
  revalidatePath('/forms');
  revalidatePath('/my-signature', 'layout');
}

/** 送出簽署：每個簽名欄位都必須有手寫簽名 */
export async function signDocument(input: {
  formId: string;
  signatures: Record<number, string>;
  consent: { version: string; agreedAt: string };
}): Promise<ActionResult> {
  const found = findMe(input.formId);
  if ('error' in found) return found;
  const { form, signer } = found;

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

  Object.assign(signer, {
    status: 'signed',
    signedAt: nowStr(),
    signatures: Object.fromEntries(required.map((f) => [f.id, input.signatures[f.id]])),
    consent: input.consent,
  } satisfies Partial<Signer>);
  revalidateLists();
  redirect('/my-signature?tab=signed&flash=signed');
}

/** 拒絕簽署；原因選填。其他簽署人仍可繼續簽署 */
export async function rejectDocument(input: { formId: string; reason: string }): Promise<ActionResult> {
  const found = findMe(input.formId);
  if ('error' in found) return found;
  const reason = input.reason.trim();

  Object.assign(found.signer, {
    status: 'rejected',
    rejectedAt: nowStr(),
    rejectReason: reason || undefined,
  } satisfies Partial<Signer>);
  revalidateLists();
  redirect('/my-signature?tab=rejected&flash=rejected');
}
