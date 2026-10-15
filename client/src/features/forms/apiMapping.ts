// 後端回應轉成畫面資料形狀時共用的純函式（server 與瀏覽器皆可使用）。
import { toTaipeiDate } from '@/lib/dates';
import type { DocumentDetail } from './serverApi';
import type { EFormDoc } from './types';

/** 後端狀態轉成 EFormDoc.status；已完成與產生完成檔中，由 deriveStatus() 依「全員已簽」推導為已完成 */
export function formStatus(status: DocumentDetail['status']): EFormDoc['status'] {
  return status === 'draft' || status === 'stopped' ? status : 'active';
}

/** 簽署期間轉成台北日期；截止時間點不含在期間內，結束日為截止前一刻的日期 */
export function signingDates(start: string | null, end: string | null) {
  return {
    startAt: start ? toTaipeiDate(new Date(start)) : null,
    endAt: end ? toTaipeiDate(new Date(new Date(end).getTime() - 1)) : null,
  };
}

/** 只需要人數時，依簽署／待簽數產生不含個資的占位簽署人 */
export function placeholderSigners(signed: number, pending: number): EFormDoc['signers'] {
  return [
    ...Array.from({ length: signed }, (_, i) => ({
      id: `signed-${i}`,
      name: '',
      employeeNo: '',
      status: 'signed' as const,
    })),
    ...Array.from({ length: pending }, (_, i) => ({
      id: `pending-${i}`,
      name: '',
      employeeNo: '',
      status: 'pending' as const,
    })),
  ];
}
