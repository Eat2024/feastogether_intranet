# 01: 保留行為的正式發起核心重構

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 確認本機人員來源前置，讓同一正式發起核心可由 HTTP 或未來 worker 傳入交易與發起者，現有使用者行為保持一致。這是先做的必要重構。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — FR-007、008、014、015；後續 US1–US3 共用。

**Tasks:** [T001–T003](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [ ] 確認 Spec 023 本機主檔、Email 與批次能力已在基準分支；記錄 commit 與隔離驗證前提，不即時呼叫 HR 或新建帳號。
- [ ] 正式核心由呼叫端傳同一交易與 actor；保留使用者升冪後鎖文件、欄位寫入、完整快照／audit 的原子性。
- [ ] 既有 HTTP 發起與正式證據不變；通知僅在 commit 後派送，任一必要寫入失敗整份回滾。
- [ ] 原核心單元與相關 e2e 通過，記錄 server lint、build 與受影響測試；尚不改成背景產品流程。

## 實作與驗證紀錄

尚未開始。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
