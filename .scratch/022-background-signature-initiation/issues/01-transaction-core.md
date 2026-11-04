# 01: 保留行為的正式發起核心重構

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 確認本機人員來源前置，讓同一正式發起核心可由 HTTP 或未來 worker 傳入交易與發起者，現有使用者行為保持一致。這是先做的必要重構。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — FR-007、008、014、015；後續 US1–US3 共用。

**Tasks:** [T001–T003](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [x] 確認 Spec 023 本機主檔、Email 與批次能力已在基準分支；記錄 commit 與隔離驗證前提，不即時呼叫 HR 或新建帳號。
- [x] 正式核心由呼叫端傳同一交易與 actor；保留使用者升冪後鎖文件、欄位寫入、完整快照／audit 的原子性。
- [x] 既有 HTTP 發起與正式證據不變；通知僅在 commit 後派送，任一必要寫入失敗整份回滾。
- [x] 原核心單元與相關 e2e 通過，記錄 server lint、build 與受影響測試；尚不改成背景產品流程。

## 實作與驗證紀錄

已完成 T001–T003，等待整合，狀態保持 claimed。

- 公開核心 seam：`initiateInTransaction(input, manager)` 回傳 `{ document, notificationJobs }`；同一 manager 完成正式資料，呼叫端管理 commit 及通知入列。
- Actor 顯式由 creatorUserId 傳入 signer、通知建立人與 audit；document 本來沒有 updatedByUserId 欄位，不新增欄位或依賴 CLS 模擬 session。
- TDD：新增核心測試先因方法不存在紅燈；實作後單元 5／5。隔離 DB 的完整 core e2e 25／25，再驗原子性案例 1／1；build 通過，lint 0 errors／272 既有 warnings。
- 驗證與環境詳見規格 quickstart「Ticket 01 實作驗證」。本票不含後續 202 或 busy guard，以下共通補充條件由後續票完成，不虛標完成。
- Commit：本節隨核心實作 commit 一同提交；整合者追加確切 SHA 與合併結果。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。

## 整合驗收紀錄

- 已將 `impl/022-01` 實作 commit `ea034502a25d36b1a8c6f1a55529901f88413abf` 合併至 `impl/022-integration`，merge commit `107656323974d713ff7f794421e77cf60ee654c0`，無衝突。
- 合併 hook：server/client lint 通過（server 0 errors、272 既有 warnings）；單元 113 suites／1,175 tests 通過。實作票的隔離 core e2e 25／25 與 build 已通過。
- T001–T003 完成並已整合，狀態改 resolved。上方共通 202／busy guard 補充條件屬後續票範圍，未虛標完成；client 無變更。
