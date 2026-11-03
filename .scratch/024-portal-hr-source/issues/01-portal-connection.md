# 01: Portal 唯讀連線基礎

**What to build:** server 有一個共用的 Portal 唯讀連線：設定由 `PORTAL_MYSQL_*` 環境變數提供，第一次查詢時才連線，所以 Portal 故障不影響服務啟動。只執行合約列出的四個查詢；另有合成 Portal 測試資料庫，供後續 tickets 使用。

**Status:** ready-for-agent

**Blocked by:** 無（可以立即開始）

**Size:** M

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T001–T006；FR-001、FR-002、FR-003，以及 FR-012 的 `.env.example` 部分。精確檔案與測試入口見 tasks 對應的 ID。

## Acceptance Criteria

- [ ] `.env.example` 列出五個 `PORTAL_MYSQL_*` 與所需的最小 SELECT 權限，不含任何實際值。
- [ ] 送出的 SQL 與合約逐字相同；沒有寫入語句，也不讀密碼、身分證字號、生日欄位（單元測試鎖定）。
- [ ] 連線池最多 3 條連線，連線與查詢逾時各 10 秒；Portal 不回應時 15 秒內拒絕。
- [ ] 設定缺漏或 Portal 無法連線時，HTTP app 仍能啟動，查詢時才失敗，錯誤訊息不含設定值。
- [ ] 合成 Portal 測試資料庫只建在 `feastogether_intranet_test` 前綴下，測完自動刪除；4-byte 中文與前導零員編完整讀回，哨兵欄位的值不出現在任何查詢結果中。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。
