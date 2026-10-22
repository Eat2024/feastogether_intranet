// 本人的簽署任務（server/src/features/esign/dto/signing-task.dto.ts、signature-submission.dto.ts）
import type { EsignDocumentListItem, EsignFieldView, EsignSignerView } from './esignDocuments';

/** 簽署前須同意的告知內容；送出簽名時帶回 version */
export interface EsignConsent {
  version: string;
  text: string;
  sha256: string;
}

/** GET esign/signing-tasks 的一筆資料：指派給目前員工、已發起的文件 */
export interface EsignSigningTask {
  signerPublicId: string;
  /** 建立人發起時是否開放拒絕簽署 */
  allowReject: boolean;
  document: EsignDocumentListItem;
  /** 本人的簽署紀錄 */
  signer: EsignSignerView;
  /** 文件共用欄位：每位簽署人都簽同一組位置 */
  fields: EsignFieldView[];
  consent: EsignConsent;
  pendingCount: number;
  signedCount: number;
}

/** GET esign/signing-tasks 的查詢參數 */
export interface GetSigningTasksParams {
  status?: 'pending' | 'signed' | 'rejected';
}
