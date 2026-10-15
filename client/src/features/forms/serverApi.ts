// 電子簽文件後端 API（僅供 Next.js server 端：page 與 Server Action）。
// 瀏覽器直接呼叫的上傳 API 見 api.ts。
import { esignRequest } from '@/lib/api/esign';
import { toTaipeiDateTime } from '@/lib/dates';
import { formStatus, placeholderSigners, signingDates } from './apiMapping';
import { emailSignerId } from '@/lib/email';
import type { HistoryItem } from './detail/SigningHistory';
import type { EFormDoc } from './types';

export type SignerCandidate = {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  title: string | null;
};

export type DocumentSigner = {
  publicId: string;
  type: 'user' | 'email';
  name: string;
  employeeNo: string | null;
  email: string | null;
  /** 加入時的部門快照 */
  department: string | null;
  status: 'pending' | 'signed';
  signedAt: string | null;
};

export type DocumentField = {
  id: string;
  /** 草稿欄位尚未指派簽署人時為 null */
  signerPublicId: string | null;
  type: 'signature' | 'date';
  page: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  sortOrder: number;
};

export type DocumentDetail = {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'finalizing' | 'completed' | 'stopped';
  /** 簽署期間（UTC）；草稿為 null。截止時間點本身不含在期間內 */
  signStartAt: string | null;
  signEndAt: string | null;
  /** 建立人帳號不存在時為 null */
  createdBy: { name: string; employeeNo: string } | null;
  /** 原始 PDF（伺服器讀出的頁數） */
  sourceFile?: { fileName: string; pageCount: number };
  signers: DocumentSigner[];
  /** 依頁碼、排序排列 */
  fields: DocumentField[];
};

export type DocumentListItem = {
  id: string;
  title: string;
  status: DocumentDetail['status'];
  /** 簽署期間（UTC）；草稿為 null。截止時間點本身不含在期間內 */
  signStartAt: string | null;
  signEndAt: string | null;
  signedCount: number;
  pendingCount: number;
  /** 建立人帳號不存在時為 null */
  createdBy: { name: string; employeeNo: string } | null;
};

export type SignerInput =
  | { type: 'user'; userId: string }
  | { type: 'email'; name: string; email: string };

type FieldPosition = Omit<DocumentField, 'id' | 'signerPublicId'>;

const documentPath = (id: string) => `/esign/documents/${encodeURIComponent(id)}`;

/**
 * 後端草稿轉成設定簽署畫面（SignersEditor）使用的資料形狀。
 * 組織架構同仁的 id 為員工編號；以 Email 加入者沿用 emailSignerId()。
 */
export function toSignersEditorForm(document: DocumentDetail): EFormDoc {
  return {
    id: document.id,
    name: document.title,
    // 後端的文件編號為 UUID，不顯示
    docNumber: null,
    docType: 'upload',
    status: 'draft',
    startAt: null,
    endAt: null,
    signers: document.signers.map((s) =>
      s.type === 'email' && s.email
        ? { id: emailSignerId(s.email), name: s.name, employeeNo: '', email: s.email, status: 'pending' as const }
        : { id: s.employeeNo ?? s.publicId, name: s.name, employeeNo: s.employeeNo ?? '', status: 'pending' as const },
    ),
    createdBy: { name: '', employeeNo: '' },
  };
}

/** 本人建立的文件，依最後更新時間由新到舊 */
export function listCreatedDocuments() {
  return esignRequest<DocumentListItem[]>('/esign/documents?role=created');
}

/**
 * 後端列表項目轉成電子簽列表（FormsTable）使用的資料形狀；列表只需要簽署人數。
 */
export function toListForm(item: DocumentListItem): EFormDoc {
  return {
    id: item.id,
    name: item.title,
    // 後端的文件編號為 UUID，不顯示
    docNumber: null,
    docType: 'upload',
    status: formStatus(item.status),
    ...signingDates(item.signStartAt, item.signEndAt),
    signers: placeholderSigners(item.signedCount, item.pendingCount),
    createdBy: item.createdBy ?? { name: '', employeeNo: '' },
  };
}

/**
 * 後端文件詳情轉成文件簽署狀態頁使用的資料形狀。
 * Spec 03 沒有拒絕簽署，可選功能（浮水印、拒絕簽署）固定關閉。
 */
export function toDetailForm(document: DocumentDetail): EFormDoc {
  return {
    id: document.id,
    name: document.title,
    // 後端的文件編號為 UUID，不顯示
    docNumber: null,
    docType: 'upload',
    status: formStatus(document.status),
    ...signingDates(document.signStartAt, document.signEndAt),
    signers: document.signers.map((s) => ({
      id: s.publicId,
      name: s.name,
      employeeNo: s.employeeNo ?? '',
      email: s.email ?? undefined,
      status: s.status,
      signedAt: s.signedAt ? toTaipeiDateTime(new Date(s.signedAt)) : undefined,
      unit: s.department ?? undefined,
    })),
    createdBy: document.createdBy ?? { name: '', employeeNo: '' },
    options: { watermark: false, allowReject: false },
  };
}

/**
 * 後端草稿轉成編輯頁（UploadEditor）使用的資料形狀。
 * 原始 PDF 由 /files/forms/[id] 轉向後端讀取；欄位 id 沿用後端的欄位 id。
 */
export function toEditForm(document: DocumentDetail): EFormDoc {
  return {
    ...toDetailForm(document),
    upload: {
      fileName: document.sourceFile?.fileName ?? '',
      fileId: document.sourceFile ? document.id : undefined,
      pages: document.sourceFile?.pageCount ?? 0,
      mode: 'inline',
      fields: document.fields.map((f) => ({
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
}

/** 建立人檢視的簽署歷程與停止原因 */
export function getDocumentHistory(id: string) {
  return esignRequest<HistoryItem[]>(`${documentPath(id)}/history`);
}

/** 刪除草稿（只限草稿；已發起的文件後端會拒絕） */
export function deleteDraftDocument(id: string) {
  return esignRequest<undefined>(documentPath(id), { method: 'DELETE' });
}

/** 建立人停止簽署；回傳停止後的文件詳情 */
export function stopDocument(id: string, reason: string) {
  return esignRequest<DocumentDetail>(`${documentPath(id)}/stoppages`, {
    method: 'POST',
    json: { reason },
  });
}

export function getDocument(id: string) {
  return esignRequest<DocumentDetail>(documentPath(id));
}

/** 依工號或姓名搜尋可指定的內部簽署人（最多 50 筆） */
export function listSignerCandidates(query?: string) {
  const q = query?.trim();
  return esignRequest<SignerCandidate[]>(
    `/esign/signer-candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`,
  );
}

/** 取代草稿簽署人；回傳順序與傳入順序相同。既有欄位會被解除指派 */
export function replaceSigners(id: string, signers: SignerInput[]) {
  return esignRequest<DocumentSigner[]>(`${documentPath(id)}/draftSave`, {
    method: 'PUT',
    json: { signers },
  });
}

/** 整批取代草稿欄位；signerPublicId 為 null 表示暫不指派 */
export function replaceFields(
  id: string,
  fields: (FieldPosition & { signerPublicId: string | null })[],
) {
  return esignRequest<DocumentField[]>(`${documentPath(id)}/fields`, {
    method: 'PUT',
    json: { fields },
  });
}

/** 同一交易儲存簽署人、欄位與簽署期間並發起；signerIndex 對應 signers 的順序 */
export function initiateDocument(
  id: string,
  body: {
    signers: SignerInput[];
    fields: (FieldPosition & { signerIndex: number })[];
    signStartAt: string;
    signEndAt: string;
    watermark: boolean;
    allowReject: boolean;
  },
) {
  return esignRequest<DocumentDetail>(`${documentPath(id)}/initiations`, {
    method: 'POST',
    json: body,
  });
}
