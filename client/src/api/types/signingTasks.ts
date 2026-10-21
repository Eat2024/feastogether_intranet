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
  document: EsignDocumentListItem;
  /** 本人的簽署紀錄（後端目前沒有拒絕簽署，status 只有 pending、signed） */
  signer: EsignSignerView;
  /** 文件共用欄位：每位簽署人都簽同一組位置 */
  fields: EsignFieldView[];
  consent: EsignConsent;
  pendingCount: number;
  signedCount: number;
}

/** GET esign/signing-tasks 的查詢參數 */
export interface GetSigningTasksParams {
  status?: 'pending' | 'signed';
}

/** POST esign/signing-tasks/:signerPublicId/signatures */
export interface SubmitSignaturesBody {
  /** UUID v4；同一次送出重試時沿用，後端依此判斷重複送出 */
  requestId: string;
  consentVersion: string;
  accepted: true;
  /** 本人各簽名欄位的手寫簽名；日期欄位由後端填入 */
  signatures: { fieldId: string; pngDataUrl: string }[];
}

/** 送出簽名的結果 */
export interface EsignSignatureResult {
  signerPublicId: string;
  signedAt: string;
  documentStatus: Exclude<EsignDocumentListItem['status'], 'draft'>;
  completion: EsignSignerView['completion'];
  verificationUrl: string | null;
}
