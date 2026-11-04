# 04: 大名單效能與完整交付驗收

**What to build:** 確認 5213 人使用情境快速返回列表、背景安全完成，並備妥可部署與可回滾的完整驗收證據。

**Blocked by:** [01：受理後立即顯示確認日期與預計人數](01-accepted-list-summary.md)、[02：重新進入與原有讀者取得一致摘要](02-summary-access-consistency.md)、[03：背景終態與快取競態正確切換](03-terminal-state-consistency.md)

**對應 Tasks:** T015–T018

**Status:** resolved

- [x] 5213 人大型輸入與 256 KiB sort buffer 回歸通過；不排序完整 JSON、無 N+1。
- [x] 讀取快照不阻塞 worker；成功無重複、失敗無部分正式名單。
- [x] 1／100／5213 人各 20 次：前置解析完成後至列表摘要可見 P95 <=3 秒；另報點擊起整體等待。
- [x] 受影響單元、整合、異動保護與前後端 build、lint 通過，所有未完成檢查明列。
- [x] 合約、部署順序、無 migration 回滾與資料最小化經核對並留下證據。

## 執行紀錄

- 使用者已確認此拆分與依賴；尚未開始實作。前置 tickets 均 resolved 後才可 claimed；驗收通過且整合後才可 resolved。

- 已完成 T015–T018；證據見 Spec 025 validation-04.md。60次瀏覽器提交至列表可見矩陣與61份獨立worker成功，另外完成5213人失敗無部分指派。待 merger 核對並整合後 resolved。

- 已以 fast-forward 將實作 commit `b6a93ce19b52d4b8dbe9d45244fe15c1b8c3920a` 整合至 `impl/025-integration`。merger 已核對 validation-04.md：歷史大型 JSON 案例完整重跑、受影響 e2e 57 tests 無 skip、60 次瀏覽器矩陣、61 份獨立 worker 成功、5213 人失敗無部分指派及真實白名單略過回歸。119 suites／1218 unit、build／lint 通過；本機效能不宣稱為 UAT 或完整內部員編解析耗時。最終雙軸 review 由整合流程執行。
