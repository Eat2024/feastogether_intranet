# PR #10 與 dev 整合驗證（2026-10-18）

## 衝突原因與處理

PR #11 已將 QR 簽章驗證基礎與共用欄位／個人副本流程合入 dev；本分支仍包含相同 QR 功能的不同 commit，以及舊 document lease、合併 PDF、receipt 與 esign-errors helper，產生 38 個衝突檔案。

- 以 dev 的共用欄位、個人 PDF、signer completion lease、manifest v2、AppErrors 與 producer 連線策略為準。
- 保留本分支的框架錯誤安全回應、外部邀請 HTML 錯誤頁與測試。錯誤文案集中於 AppErrors，不恢復 esign-errors helper。
- 保留 dev 的驗證 wildcard route，讓格式錯誤（包含額外路徑片段）仍回相同驗證 404 與安全標頭；對外契約仍為 `/api/signature-verifications/{code}`。
- Spec 04 契約與資料模型同步為個人完成檔摘要及 manifest v2，移除 ExternalCompletionExtension；舊執行任務保留並標示歷史版本，不當作目前實作要求。
- 相對 dev 無 client 或 migration 變更；前端獨立交付。未操作正式資料庫，未合併 PR。

## 本次執行結果

| 檢查 | 結果 |
| --- | --- |
| server unit | 88 suites／664 tests 通過 |
| core、queue、API coverage e2e | 3 suites／40 tests 通過 |
| security e2e | 6 suites／25 tests 通過 |
| schema／migration | 2 suites／3 tests 通過 |
| server lint:check | 0 errors／157 既有 warnings |
| server build | 通過 |
| git diff --check | 通過 |

本次未重跑 6,000 份 PDF 的規模測試；個人產製實作沿用 dev，既有量測見 Spec 03 validation.md。實際列印、正式 Portal／寄信／儲存整合仍待各環境驗收。
