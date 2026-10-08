// 文件資料的讀寫層（僅供伺服器端使用）。
// 尚未串接 API：資料放在伺服器記憶體，以 MOCK_FORMS 為初始值，重新啟動伺服器即重置。
// 串接 API 時只需替換本檔的函式實作，呼叫端不必改。
import { MOCK_FORMS } from './mock';
import type { EFormDoc } from './types';

// 掛在 globalThis：dev 模式熱更新重新載入模組時資料不會被重置
const g = globalThis as typeof globalThis & { __eformStore?: EFormDoc[] };
const forms: EFormDoc[] = (g.__eformStore ??= structuredClone(MOCK_FORMS));

export function getForms(): EFormDoc[] {
  return forms;
}

export function getForm(id: string): EFormDoc | undefined {
  return forms.find((f) => f.id === id);
}

export function insertForm(form: EFormDoc) {
  forms.unshift(form);
}

export function updateForm(id: string, patch: Partial<EFormDoc>) {
  const form = getForm(id);
  if (form) Object.assign(form, patch);
}

/** 今天日期，格式 YYYY/MM/DD */
export function todayStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

/** 下一個文件編號：ES-年份-四碼流水號 */
export function nextDocNumber() {
  const year = new Date().getFullYear();
  const prefix = `ES-${year}-`;
  const seqs = forms
    .map((f) => f.docNumber)
    .filter((n): n is string => !!n && n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)));
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/**
 * 傳給畫面（client 元件）前移除其他人的手寫簽名與同意紀錄，避免簽名圖檔外流；
 * viewerId 為目前使用者時保留本人的資料，未提供則全部移除。
 */
export function toClientForm(form: EFormDoc, viewerId?: string): EFormDoc {
  return {
    ...form,
    signers: form.signers.map((s) =>
      s.id === viewerId ? s : { ...s, signatures: undefined, consent: undefined },
    ),
  };
}

/** 簽署人視角：只保留本人的簽署紀錄，不傳出其他簽署人的姓名與狀態（整體進度請用 getProgress） */
export function toSignerView(form: EFormDoc, viewerId: string): EFormDoc {
  return {
    ...form,
    // 備註是管理端的內部紀錄，不讓簽署人本人看到
    signers: form.signers.filter((s) => s.id === viewerId).map((s) => ({ ...s, note: undefined })),
    // 補簽只提供期間，原因與設定人屬內部資訊
    resigns: form.resigns?.map(({ startAt, endAt, createdAt }) => ({ startAt, endAt, createdAt })),
  };
}
