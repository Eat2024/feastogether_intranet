# 05: 中斷後有限恢復且不重複發起

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 已受理工作在 Redis 入列失敗或 worker 重啟後可繼續；建立人看到重試或明確失敗，文件不會被部分或重複發起。

**Blocked by:** [03 完整大量與混合名單背景發起](03-complete-roster.md)

**Status:** claimed

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US3；FR-005、007、010–013、016、017；SC-004–006、008。

**Tasks:** [T021–T024](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [x] 最多 3 次 claim，30／120 秒退避；5 分鐘 lease、30 秒獨立續租，不依賴 500 人批次完成才 heartbeat，CAS 失租停止寫入。
- [x] 總 deadline 包含排隊與重試，為受理後 120 分鐘與簽署截止較早者；每批、正式交易及 commit 前檢查，無僅 Promise.race 回 timeout 卻持續提交。
- [x] 正式交易持 job 鎖時停獨立同列 heartbeat，maintenance 跳過鎖住的交易，不先將仍可提交工作標失敗。
- [x] DB 已受理而 Redis 失敗由既有 maintenance 補列；DB retry 不因 Redis 舊 failed/completed job ID 被永久去重，delivery attempts=1。
- [x] 各 crash 點及全面 DB 中斷恢復測試通過：成功重播不再發起、未提交全回滾、舊 lease 不覆蓋新結果；通知失敗不把成功工作改成 failed。
- **原 UI 驗收暫緩／後端部分仍適用：** log 僅必要 job/document/request、階段與分類；無完整名單、信箱、憑證或任意 SQL 錯誤內容，前端可區分重新查核與終態錯誤。

## 實作與驗證紀錄

尚未開始。

## 本輪後端補充驗收

- [x] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [x] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。

## 依賴修訂（後端範圍）

本票只需 03 的背景核心及分批查核，04 的查詢擴充不是恢復機制前置；可與 04 在獨立 worktree、隔離 Redis DB 平行實作。共用 service 的變更須在整合時解決衝突並重驗。

## 實作紀錄（2026-11-03）

- T021–T024 完成，狀態維持 claimed，等待整合後結案。
- 工作失敗以持有 token 的短 job 鎖收斂；暫時錯誤最多 3 claim，30／120 秒退避，期限先於重試。claim 重設本輪計數與舊錯誤。
- 獨立 timer 每 5 秒更新存活時間、每 30 秒續租 5 分鐘；停止後先排空在途 heartbeat，再開始正式交易，避免自己等待同列鎖。取得正式交易前再次續租，鎖內及最後保存後檢查 deadline。
- maintenance 沿既有 30 秒喚醒，以每批 100 列短交易及 SKIP LOCKED 回收過期 lease／期限、交易外補列。只帶 jobId；採既有新 delivery ID 與 terminal 移除，不被舊 delivery ID 阻擋。
- 穩定錯誤分類與最小結構化 log；DB 無法存失敗時不假造終態，成功後通知派送故障不再進失敗處理。
- 未修改 client、migration、env 範本或 scheduler；本機測試資源使用隔離 DB／Redis DB5。

### 驗證

- TDD：暫時 DB 失敗原本 failed（應 queued）→通過；maintenance 補列及回收兩例先紅後綠；跨批獨立續租先紅後綠。
- recovery：13／13；包含 30／120 秒及三次耗盡、期限分類、舊 lease、獨立續租、正式交易持鎖 skip、核心後故障回滾、commit 前逾時、DB 狀態存取失敗、通知已成功不回退、Redis retained delivery。
- 02／03／05 合併範圍回歸：3 suites／36 tests。
- 單元：113 suites／1,175 tests；build 通過；lint 0 errors／272 既有 warnings。
- 長時間 lease／期限使用受控時鐘加真實 DB 驗證；沒有宣稱已跑 5,001 秒實時間 SC-006，正式效能矩陣仍由 08 執行。

04 整合後回歸：保留 latest／小投影與所有異動 guard，只有測試清單衝突並已取聯集；server build 通過，02／03／04／05 四套 45／45 通過。
