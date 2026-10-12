# Contracts

Spec 001 不新增、啟用或變更任何對外電子簽 API，因此不建立 OpenAPI contract。

- 現有 SSO／session 程式只作保留與去除 RBAC 依賴，正式入口仍不啟用。
- 內網 WebView token exchange、外部 Email 簽署人邀請／驗證、文件、簽署、通知、匯出及公開驗證端點均由後續 spec 定義。
- 未來外部 Email 簽署端點必須使用綁定 `signer_id`／`document_id` 的獨立外部 session 與專用 guard；不得建立假 User，也不得以裸 `@Public()` 或 Email 字串直接授權簽署。
- 本規格的可驗收契約是 [data-model.md](../data-model.md) 的 schema／repository boundary，以及 [quickstart.md](../quickstart.md) 的 migration 驗證。
