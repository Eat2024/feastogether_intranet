// 簽到表原型（mock store）的簽名識別碼：簽到時產生一組隨機識別碼，保存在 mock 資料中。
// 後端文件的簽章驗證代碼與 QR Code 由後端在簽署成功後產生（公開驗證頁 /verify/[code]），不使用這裡的識別碼。

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 產生新的簽名識別碼（UUID v4） */
export const newSignatureId = () => crypto.randomUUID();

export const isValidSignatureId = (id: string) => UUID_PATTERN.test(id);

