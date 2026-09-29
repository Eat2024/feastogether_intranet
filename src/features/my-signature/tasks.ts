import { deriveStatus } from '@/features/forms/status';
import type { EFormDoc, Signer } from '@/features/forms/types';

export type MySignTab = 'pending' | 'signed' | 'rejected';

export const MY_SIGN_TABS: { key: MySignTab; label: string }[] = [
  { key: 'pending', label: '待簽署' },
  { key: 'signed', label: '已簽署' },
  { key: 'rejected', label: '已拒絕' },
];

/** 一份需要我簽署的文件，以及我在這份文件的簽署紀錄 */
export type MySignTask = { form: EFormDoc; me: Signer };

export function parseTab(value: string | string[] | undefined): MySignTab {
  return MY_SIGN_TABS.some((t) => t.key === value) ? (value as MySignTab) : 'pending';
}

/** 依目前使用者整理三個分頁的文件，並各自排序 */
export function getMySignTasks(
  forms: EFormDoc[],
  userId: string,
): Record<MySignTab, MySignTask[]> {
  const tasks = forms.flatMap((form) => {
    const me = form.signers.find((s) => s.id === userId);
    // 草稿尚未發起，不會出現在簽署人這裡
    return me && form.status !== 'draft' ? [{ form, me }] : [];
  });

  return {
    // 只有簽署中的文件能簽；已停止的文件不再列為待簽署
    pending: tasks
      .filter((t) => t.me.status === 'pending' && deriveStatus(t.form) === 'active')
      .sort((a, b) => (a.form.endAt ?? '').localeCompare(b.form.endAt ?? '')),
    signed: tasks
      .filter((t) => t.me.status === 'signed')
      .sort((a, b) => (b.me.signedAt ?? '').localeCompare(a.me.signedAt ?? '')),
    rejected: tasks
      .filter((t) => t.me.status === 'rejected')
      .sort((a, b) => (b.me.rejectedAt ?? '').localeCompare(a.me.rejectedAt ?? '')),
  };
}

/** 今天到期限還有幾天（日期格式 YYYY/MM/DD；負數表示已逾期） */
export function daysUntil(date: string, today: Date) {
  const [y, m, d] = date.split('/').map(Number);
  const due = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}
