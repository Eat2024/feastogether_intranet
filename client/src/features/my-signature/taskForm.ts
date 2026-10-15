// 簽署任務（內部與外部簽署人）轉成簽署畫面使用的資料（server 與瀏覽器皆可使用）。
import { formStatus, placeholderSigners, signingDates } from '@/features/forms/apiMapping';
import type { DocumentField, DocumentListItem } from '@/features/forms/serverApi';
import { getProgress } from '@/features/forms/status';
import type { EFormDoc, Signer } from '@/features/forms/types';
import { toTaipeiDateTime } from '@/lib/dates';
import { getSignBlock } from './sign/eligibility';
import type { MySignTask } from './tasks';

export type SigningTask = {
  signerPublicId: string;
  /** 內部簽署人的任務含簽署期間與發起人；外部簽署人只有文件摘要 */
  document: Omit<DocumentListItem, 'signStartAt' | 'signEndAt' | 'createdBy'> &
    Partial<Pick<DocumentListItem, 'signStartAt' | 'signEndAt' | 'createdBy'>>;
  signer: {
    publicId: string;
    name: string;
    employeeNo: string | null;
    status: 'pending' | 'signed';
    signedAt: string | null;
  };
  /** 只有本人的欄位 */
  fields: DocumentField[];
  /** 伺服器目前生效的電子簽名告知（簽署時須同意此版本） */
  consent: { version: string; text: string; sha256: string };
};

/**
 * 後端簽署任務轉成「我的電子簽」使用的資料。
 * 以 signerPublicId 作為 id（簽署相關 API 皆以此識別）；
 * 進度以其他簽署人的人數產生占位資料計算，畫面只會拿到本人（見 toSignerView）。
 */
export function toMySignTask(task: SigningTask, today: Date, pageCount?: number): MySignTask {
  const { document } = task;
  const me: Signer = {
    id: task.signerPublicId,
    name: task.signer.name,
    employeeNo: task.signer.employeeNo ?? '',
    status: task.signer.status,
    signedAt: task.signer.signedAt
      ? toTaipeiDateTime(new Date(task.signer.signedAt))
      : undefined,
  };
  const others = placeholderSigners(
    document.signedCount - (me.status === 'signed' ? 1 : 0),
    document.pendingCount - (me.status === 'pending' ? 1 : 0),
  );
  const form: EFormDoc = {
    id: task.signerPublicId,
    name: document.title,
    // 後端的文件編號為 UUID，不顯示
    docNumber: null,
    docType: 'upload',
    status: formStatus(document.status),
    ...signingDates(document.signStartAt ?? null, document.signEndAt ?? null),
    signers: [me, ...others],
    createdBy: document.createdBy ?? { name: '', employeeNo: '' },
    // Spec 03 沒有拒絕簽署，可選功能固定關閉
    options: { watermark: false, allowReject: false },
    // 本人的欄位（欄位 id 沿用後端的欄位 id）；原始 PDF 由 /files/forms/[id] 轉向後端讀取。
    // 未提供頁數時（列表）只供判斷是否有可簽署的內容
    upload: {
      fileName: '',
      fileId: task.signerPublicId,
      pages: pageCount ?? Math.max(1, ...task.fields.map((f) => f.page)),
      mode: 'inline',
      fields: task.fields.map((f) => ({
        id: Number(f.id),
        page: f.page,
        x: f.xPercent,
        y: f.yPercent,
        w: f.widthPercent,
        h: f.heightPercent,
        type: f.type === 'signature' ? 'sign' : 'date',
      })),
    },
  };
  return { form, me, progress: getProgress(form), signBlock: getSignBlock(form, me, today) };
}
