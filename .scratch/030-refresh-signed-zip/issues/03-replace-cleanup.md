# 03: 新版成功後取代與清除舊 ZIP

**What to build:** 新版確認可用後停用舊 ZIP 並清除實體檔，歷史保留且標示已取代；刪除失敗或中斷能補清理而不影響新版與個人 PDF。

**Blocked by:** 02：固定下載範圍與並行更新共用

**對應 Tasks:** T020–T028

**Status:** resolved

- [x] 新版成功前舊版可下；發布失敗不能先停用或刪除舊成果。
- [x] 成功切換後舊連結、準備下載及續傳請求拒絕舊版，不冒充提供新版。
- [x] 舊版歷史保留原匯出人、時間、份數與名稱，標示已取代且無下載／重試。
- [x] 清理只刪同文件被取代 ZIP，不刪其他文件、目前有效版、原始文件、簽署證據或個人 PDF。
- [x] 刪檔失敗維持待清理且新版可下載；切換後中斷、刪成功但回寫前中斷、重複清理均可恢復。
- [x] 補清理有界且失敗延後，避免失敗首批阻擋其他待清理工作；沿用維護流程，不新增排程。
- [x] local 與 S3 驗證實體檔／指定版本真正不存在；不可只靠 mock 或 delete marker 宣稱完成。
- [x] 非同部門、未登入、錯文件與錯檔案引用仍受保護，錯誤不洩漏其他文件資訊。

**交付界線:** 發布、停用下載與補清理是同一個可驗收切片，不能只交付刪檔或只交付畫面。

## 執行紀錄

- 2026-11-06：使用者指示依 implement-spec 開始開發，確認採此拆分與依賴。前置 resolved 後才可 claimed；通過驗收且整合後才可 resolved。


- 2026-11-06：在 impl/030-03（基準 d741b5f）開始，以已確認 public API／processor／storage seams 逐案例 red→green。

- 2026-11-06：T020–T028 完成，待整合；117 個 local/API/history e2e、5 個 S3 e2e、119 suites／1204 unit、真 Chromium 409／reconnect 情境通過。包含 COMMIT 已成功但回覆中斷、參照查詢故障的 red→green，不能誤刪已發布新版。完整證據見 specs/030-refresh-signed-zip/validation.md。

- 2026-11-06 merger：已將 impl/030-03 的 80d336f fast-forward 整合至 impl/030-integration。核對發布交易、清理與產製錯誤隔離、COMMIT 成功回覆丟失的 active/staging 參照保護、objectVersion、delete_pending 恢復、50 工作／60 秒重試，以及歷史 409／瀏覽器重新連線證據；117/117 local/API/history e2e、5/5 S3 e2e、兩組真 Chromium 情境通過。保留文件期限與共用狀態、expiresAt/index/API，無 schema 變更；容量與最終交付驗證留 ticket04。
