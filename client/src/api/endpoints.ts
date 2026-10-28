// 後端 API 路徑（相對於 baseURL /api）；新增 API 時在此登記，避免字串散落各處。
// 與後端 server/src/config/config.path.ts 及各 controller 的路徑對應。
// 登入與 session 由外部流程建立（以 HttpOnly cookie 帶入），這裡不處理登入 API。
export const endpoints = {
  // 電子簽文件（server/src/features/esign/controllers/documents.controller.ts）
  ESIGN_DOCUMENTS: 'esign/documents',
  ESIGN_DOCUMENT: (id: string) => `esign/documents/${encodeURIComponent(id)}`,
  ESIGN_DOCUMENT_DRAFT_SETTINGS: (id: string) => `esign/documents/${encodeURIComponent(id)}/draft-settings`,
  ESIGN_DOCUMENT_INITIATIONS: (id: string) => `esign/documents/${encodeURIComponent(id)}/initiations`,
  ESIGN_DOCUMENT_EMPLOYEE_EMAIL_CHECKS: (id: string) =>
    `esign/documents/${encodeURIComponent(id)}/employee-email-checks`,
  ESIGN_DOCUMENT_HISTORY: (id: string) => `esign/documents/${encodeURIComponent(id)}/history`,
  ESIGN_SIGNER_COMPLETED_FILE: (id: string, signerPublicId: string) =>
    `esign/documents/${encodeURIComponent(id)}/signers/${encodeURIComponent(signerPublicId)}/completed-file`,
  ESIGN_DOCUMENT_STOPPAGES: (id: string) => `esign/documents/${encodeURIComponent(id)}/stoppages`,
  ESIGN_DOCUMENT_REOPENINGS: (id: string) => `esign/documents/${encodeURIComponent(id)}/reopenings`,
  ESIGN_REOPENING_INVITATIONS: (id: string) => `esign/documents/${encodeURIComponent(id)}/reopening-invitations`,
  // 已簽署副本 ZIP 匯出（server/src/features/esign/controllers/exports.controller.ts）
  ESIGN_EXPORTS: 'esign/exports',
  ESIGN_DOCUMENT_EXPORTS: (id: string) => `esign/documents/${encodeURIComponent(id)}/exports`,
  ESIGN_DOCUMENT_EXPORT: (id: string, exportId: string) =>
    `esign/documents/${encodeURIComponent(id)}/exports/${encodeURIComponent(exportId)}`,
  ESIGN_DOCUMENT_EXPORT_RETRIES: (id: string, exportId: string) =>
    `esign/documents/${encodeURIComponent(id)}/exports/${encodeURIComponent(exportId)}/retries`,
  ESIGN_DOCUMENT_EXPORT_FILE: (id: string, exportId: string, fileId: string) =>
    `esign/documents/${encodeURIComponent(id)}/exports/${encodeURIComponent(exportId)}/files/${encodeURIComponent(fileId)}`,
  // 外部催簽批次（server/src/features/esign/controllers/notification-batches.controller.ts）
  ESIGN_NOTIFICATION_BATCHES: (id: string) => `esign/documents/${encodeURIComponent(id)}/notification-batches`,
  ESIGN_NOTIFICATION_BATCH: (id: string, batchId: string) =>
    `esign/documents/${encodeURIComponent(id)}/notification-batches/${encodeURIComponent(batchId)}`,
  ESIGN_SIGNER_NOTE: (id: string, signerPublicId: string) =>
    `esign/documents/${encodeURIComponent(id)}/signers/${encodeURIComponent(signerPublicId)}/note`,
  ESIGN_DOCUMENT_SOURCE_FILE: (id: string) => `esign/documents/${encodeURIComponent(id)}/source-file`,
  // 本人的簽署任務列表（server/src/features/esign/controllers/signing-tasks.controller.ts）；
  // 個人簽署／拒簽／下載等舊入口已改為須從 Email 邀請操作（Spec 010），前端不再呼叫
  ESIGN_SIGNING_TASKS: 'esign/signing-tasks',
  ESIGN_SIGNING_TASK: (id: string) => `esign/signing-tasks/${encodeURIComponent(id)}`,
  ESIGN_SIGNING_TASK_SIGNATURES: (id: string) => `esign/signing-tasks/${encodeURIComponent(id)}/signatures`,
  ESIGN_SIGNING_TASK_SOURCE_FILE: (id: string) => `esign/signing-tasks/${encodeURIComponent(id)}/source-file`,
  // 內部簽署人候選（server/src/features/esign/controllers/signer-candidates.controller.ts）
  ESIGN_SIGNER_CANDIDATES: 'esign/signer-candidates',
  ESIGN_SIGNER_ORG_CHART: 'esign/signer-candidates/org-chart',
  ESIGN_SIGNER_RESOLUTIONS: 'esign/signer-candidates/resolutions',
  // 外部簽署人（server/src/features/esign/controllers/external-signature.controller.ts）：以外部存取 cookie 驗證，
  // cookie 的 path 為 /api/external-signing-task，只有這組路徑會帶上
  EXTERNAL_SIGNING_TASK: 'external-signing-task',
  EXTERNAL_SIGNING_TASK_SOURCE_FILE: 'external-signing-task/source-file',
  EXTERNAL_SIGNING_TASK_SIGNATURES: 'external-signing-task/signatures',
  EXTERNAL_SIGNING_TASK_REJECTION: 'external-signing-task/rejection',
  EXTERNAL_SIGNING_TASK_COMPLETED_FILE: 'external-signing-task/completed-file',

  // 公開簽章驗證（server/src/features/esign/controllers/signature-verification.controller.ts）：不需登入
  SIGNATURE_VERIFICATION: (code: string) => `signature-verifications/${encodeURIComponent(code)}`,

  // Health
  HEALTH: 'health',
};
