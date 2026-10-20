// 後端 API 路徑（相對於 baseURL /api）；新增 API 時在此登記，避免字串散落各處。
// 與後端 server/src/config/config.path.ts 及各 controller 的路徑對應。
// 登入與 session 由外部流程建立（以 HttpOnly cookie 帶入），這裡不處理登入 API。
export const endpoints = {
  // 電子簽文件（server/src/features/esign/controllers/documents.controller.ts）
  ESIGN_DOCUMENTS: 'esign/documents',
  ESIGN_DOCUMENT: (id: string) => `esign/documents/${encodeURIComponent(id)}`,
  ESIGN_DOCUMENT_DRAFT_SAVE: (id: string) => `esign/documents/${encodeURIComponent(id)}/draftSave`,
  ESIGN_DOCUMENT_INITIATIONS: (id: string) => `esign/documents/${encodeURIComponent(id)}/initiations`,
  ESIGN_DOCUMENT_HISTORY: (id: string) => `esign/documents/${encodeURIComponent(id)}/history`,
  ESIGN_SIGNER_COMPLETED_FILE: (id: string, signerPublicId: string) =>
    `esign/documents/${encodeURIComponent(id)}/signers/${encodeURIComponent(signerPublicId)}/completed-file`,
  ESIGN_DOCUMENT_STOPPAGES: (id: string) => `esign/documents/${encodeURIComponent(id)}/stoppages`,
  ESIGN_DOCUMENT_SOURCE_FILE: (id: string) => `esign/documents/${encodeURIComponent(id)}/source-file`,
  // 內部簽署人候選（server/src/features/esign/controllers/signer-candidates.controller.ts）
  ESIGN_SIGNER_CANDIDATES: 'esign/signer-candidates',

  // Health
  HEALTH: 'health',
};
