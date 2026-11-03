# 05: 中斷後有限恢復且不重複發起

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 已受理工作在 Redis 入列失敗或 worker 重啟後可繼續；建立人看到重試或明確失敗，文件不會被部分或重複發起。

**Blocked by:** [04 重整與重新登入後追蹤工作](04-progress-tracking.md)

**Status:** ready-for-agent

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US3；FR-005、007、010–013、016、017；SC-004–006、008。

**Tasks:** [T021–T024](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [ ] 最多 3 次 claim，30／120 秒退避；5 分鐘 lease、30 秒獨立續租，不依賴 500 人批次完成才 heartbeat，CAS 失租停止寫入。
- [ ] 總 deadline 包含排隊與重試，為受理後 120 分鐘與簽署截止較早者；每批、正式交易及 commit 前檢查，無僅 Promise.race 回 timeout 卻持續提交。
- [ ] 正式交易持 job 鎖時停獨立同列 heartbeat，maintenance 跳過鎖住的交易，不先將仍可提交工作標失敗。
- [ ] DB 已受理而 Redis 失敗由既有 maintenance 補列；DB retry 不因 Redis 舊 failed/completed job ID 被永久去重，delivery attempts=1。
- [ ] 各 crash 點及全面 DB 中斷恢復測試通過：成功重播不再發起、未提交全回滾、舊 lease 不覆蓋新結果；通知失敗不把成功工作改成 failed。
- **原 UI 驗收暫緩／後端部分仍適用：** log 僅必要 job/document/request、階段與分類；無完整名單、信箱、憑證或任意 SQL 錯誤內容，前端可區分重新查核與終態錯誤。

## 實作與驗證紀錄

尚未開始。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
