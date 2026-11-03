# 04: 重整與重新登入後追蹤工作

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人從列表及文件頁找回同一工作的排隊、查核、正式發起與結果；關頁或短暫失聯不會遺失工作或再建工作。

**Blocked by:** [03 完整大量與混合名單背景發起](03-complete-roster.md)

**Status:** ready-for-agent

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US2；FR-008–010、016；SC-003、007。

**Tasks:** [T016–T020](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [ ] latest 無工作回 null；job 與 latest 是只讀摘要，未登入 401，非建立人與不存在統一 404，回應 no-store。
- [ ] 列表只對建立人提供摘要，其他部門讀者為 null；批次查詢小欄位，無 JSON filesort／N+1。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端 3 秒輪詢，終態與 401／403／404 停止，網路或 503 顯示暫不可更新；attempt 重新查核不累加或偽造百分比。
- **原 UI 驗收暫緩／後端部分仍適用：** 排隊、處理、成功與失敗 fixture 下重整／重登入都回到同工作，正常連線已更新進度 10 秒內可見。
- **原 UI 驗收暫緩／後端部分仍適用：** 22 份大 input／256KiB 排序緩衝驗證成功，輪詢回應大小不隨名單線性成長；busy UI 與服務端限制一致。

## 實作與驗證紀錄

尚未開始。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
