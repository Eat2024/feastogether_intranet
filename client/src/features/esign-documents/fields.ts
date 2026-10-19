// 前端編輯器的欄位（UploadField）與後端欄位格式（EsignFieldPlacement）互轉
import type { EsignFieldPlacement } from '@/api/types';
import { fieldSize } from '@/features/forms/signLayout';
import type { UploadField } from '@/features/forms/types';

/** 後端座標上限為 99.999%，避免貼齊右緣／下緣時被拒 */
const MAX_POS = 99.999;
const round = (v: number) => Math.round(v * 1000) / 1000;

/** 依頁碼、由上到下、由左到右排序並編號（sortOrder），簽署時依此順序填寫 */
export function toFieldPlacements(fields: UploadField[]): EsignFieldPlacement[] {
  return [...fields]
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    .map((f, i) => {
      const { w, h } = fieldSize(f);
      return {
        type: f.type === 'sign' ? 'signature' : 'date',
        page: f.page,
        xPercent: round(Math.min(MAX_POS, f.x)),
        yPercent: round(Math.min(MAX_POS, f.y)),
        widthPercent: round(w),
        heightPercent: round(h),
        sortOrder: i,
      };
    });
}
