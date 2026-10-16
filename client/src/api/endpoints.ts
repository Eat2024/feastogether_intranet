// 後端 API 路徑（相對於 baseURL /api）；新增 API 時在此登記，避免字串散落各處。
// 與後端 server/src/config/config.path.ts 及各 controller 的路徑對應。
// 登入與 session 由外部流程建立（以 HttpOnly cookie 帶入），這裡不處理登入 API。
export const endpoints = {
  // 電子簽文件（server/src/features/esign/controllers/documents.controller.ts）
  ESIGN_DOCUMENTS: 'esign/documents',

  // Health
  HEALTH: 'health',
};
