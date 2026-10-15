import { getProgress, signingPeriod, type FormProgress } from '@/features/forms/status';
import { getSignBlock } from './sign/eligibility';
import type { EFormDoc, Signer } from '@/features/forms/types';

export type MySignTab = 'pending' | 'signed' | 'rejected';

export const MY_SIGN_TABS: { key: MySignTab; label: string }[] = [
  { key: 'pending', label: '待簽署' },
  { key: 'signed', label: '已簽署' },
  { key: 'rejected', label: '已拒絕' },
];

/**
 * 一份需要我簽署的文件與我的簽署紀錄。
 * progress、signBlock 以完整資料在伺服器端計算；傳到畫面前 form 只會保留本人（見 toSignerView）。
 */
export type MySignTask = { form: EFormDoc; me: Signer; progress: FormProgress; signBlock: string | null };

export function parseTab(value: string | string[] | undefined): MySignTab {
  return MY_SIGN_TABS.some((t) => t.key === value) ? (value as MySignTab) : 'pending';
}

/** 依目前使用者整理三個分頁的文件，並各自排序 */
export function getMySignTasks(
  forms: EFormDoc[],
  userId: string,
  today: Date,
): Record<MySignTab, MySignTask[]> {
  const tasks: MySignTask[] = forms.flatMap((form) => {
    const me = form.signers.find((s) => s.id === userId);
    // 草稿尚未發起，不會出現在簽署人這裡
    return me && form.status !== 'draft'
      ? [{ form, me, progress: getProgress(form), signBlock: getSignBlock(form, me, today) }]
      : [];
  });

  return {
    // 簽署中的文件可以簽；已到期的仍列出（顯示已逾期，等待補簽）；已停止的文件不再列為待簽署
    pending: tasks
      .filter((t) => t.me.status === 'pending' && (t.progress.status === 'active' || t.progress.status === 'expired'))
      .sort((a, b) => (signingPeriod(a.form).endAt ?? '').localeCompare(signingPeriod(b.form).endAt ?? '')),
    signed: tasks
      .filter((t) => t.me.status === 'signed')
      .sort((a, b) => (b.me.signedAt ?? '').localeCompare(a.me.signedAt ?? '')),
    rejected: tasks
      .filter((t) => t.me.status === 'rejected')
      .sort((a, b) => (b.me.rejectedAt ?? '').localeCompare(a.me.rejectedAt ?? '')),
  };
}

// 相容既有引用
export { daysUntil } from '@/lib/dates';
