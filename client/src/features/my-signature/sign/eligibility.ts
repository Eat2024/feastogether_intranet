import { getSignLayout } from '@/features/forms/signLayout';
import { deriveStatus, signingPeriod } from '@/features/forms/status';
import type { EFormDoc, Signer } from '@/features/forms/types';
import { daysUntil } from '@/lib/dates';

/** 目前不能簽署的原因；可以簽署時回傳 null（簽署頁與送出時的檢查共用） */
export function getSignBlock(form: EFormDoc, me: Signer, today: Date): string | null {
  if (me.status === 'signed') return `你已於 ${me.signedAt} 完成簽署。`;
  if (me.status === 'rejected') return `你已於 ${me.rejectedAt} 拒絕簽署。`;
  if (form.status === 'stopped') return '此文件已停止簽署，無法再簽署。';
  // 期限以目前的簽署期間為準（補簽中為補簽期間）
  const { startAt, endAt, resign } = signingPeriod(form);
  const status = deriveStatus(form, today);
  if (status === 'expired') {
    return `已超過簽署期限（${endAt}），無法簽署，如有需要請聯絡發起人 ${form.createdBy.name}。`;
  }
  if (status !== 'active') return '此文件目前無法簽署。';
  if (!getSignLayout(form)) return '此文件沒有可簽署的內容，請聯絡發起人。';
  if (startAt && daysUntil(startAt, today) > 0) {
    return `${resign ? '補簽' : '簽署'}期間自 ${startAt} 開始，目前尚無法簽署。`;
  }
  return null;
}
