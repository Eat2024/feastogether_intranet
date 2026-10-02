// 簽名追蹤 QR code 的共用規則：每個簽名欄位在「確認簽名」時產生一組隨機識別碼，
// QR code 內容為追蹤網址 /verify/<識別碼>。識別碼不含個人資料，日後可用來查回該筆簽名的資訊。
// TODO: 追蹤頁 /verify/[id] 尚未實作（需先決定顯示內容與可查閱的權限）。

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 產生新的簽名識別碼（UUID v4） */
export const newSignatureId = () => crypto.randomUUID();

export const isValidSignatureId = (id: string) => UUID_PATTERN.test(id);

/** 簽名追蹤網址；origin 為系統網址（瀏覽器端可用 window.location.origin） */
export const signatureVerifyUrl = (id: string, origin: string) => new URL(`/verify/${id}`, origin).toString();
