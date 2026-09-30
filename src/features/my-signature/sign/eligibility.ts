import { getSignLayout } from '@/features/forms/signLayout';
import { deriveStatus } from '@/features/forms/status';
import type { EFormDoc, Signer } from '@/features/forms/types';
import { daysUntil } from '../tasks';

/** 目前不能簽署的原因；可以簽署時回傳 null（簽署頁與送出時的檢查共用） */
export function getSignBlock(form: EFormDoc, me: Signer, today: Date): string | null {
  if (me.status === 'signed') return `你已於 ${me.signedAt} 完成簽署。`;
  if (me.status === 'rejected') return `你已於 ${me.rejectedAt} 拒絕簽署。`;
  if (form.status === 'stopped') return '此文件已停止簽署，無法再簽署。';
  if (deriveStatus(form) !== 'active') return '此文件目前無法簽署。';
  if (!getSignLayout(form)) return '此文件沒有可簽署的內容，請聯絡發起人。';
  if (form.startAt && daysUntil(form.startAt, today) > 0) {
    return `簽署期間自 ${form.startAt} 開始，目前尚無法簽署。`;
  }
  if (form.endAt && daysUntil(form.endAt, today) < 0) {
    return `已超過簽署期限（${form.endAt}），無法簽署，如有需要請聯絡發起人 ${form.createdBy.name}。`;
  }
  return null;
}
