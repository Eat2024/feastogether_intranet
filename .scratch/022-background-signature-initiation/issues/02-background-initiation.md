# 02: 單人背景發起完整流程

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人確認一位簽署人後，立即取得可追蹤工作並看到處理狀態；關頁仍由 worker 完成正式發起，重送不雙發。

**Blocked by:** [01 保留行為的正式發起核心重構](01-transaction-core.md)

**Status:** ready-for-agent

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US1；FR-001–008、015；SC-001、003–005、007。

**Tasks:** [T004–T011](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [ ] 建立計畫中的唯一工作表，完整落實資料模型的欄位、唯一索引、FK、JSON 最小讀取；migration 非空 down 拒絕，無第二張表／新 env／排程。
- [ ] 受理先持久保存完整確認輸入與版本再回 202＋Location；相同 key 同內容重播 200 原摘要，異內容或另一進行中請求 409。已過截止仍可授權後重播舊 key。
- [ ] 建立人與現行資格在受理及正式交易均驗證；0 人／非法輸入拒絕，其他使用者不能看工作。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端不先解析整份名單，固定 key 提交、顯示排隊並以摘要追蹤；只有 succeeded 顯示已發起，不以 HTTP 202 判成功。
- [ ] queue 僅 job ID、全域並行 1、claim 不跨正式交易持 job 鎖；正式文件與 succeeded 同次 commit，成功重送不再生成指派或通知。
- [ ] 全部草稿寫入入口在同一文件鎖下拒絕 busy；新 PDF 被拒後清理新檔，不能只禁用按鈕。
- **原 UI 驗收暫緩／後端部分仍適用：** 通過單人端到端、schema、越權、同／不同 key 競態、全部寫入保護與前端操作驗收。恢復／保留等尚未完成的能力明列，不部署此中間版本。

## 實作與驗證紀錄

尚未開始。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
