# 04: 重整與重新登入後追蹤工作

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人從列表及文件頁找回同一工作的排隊、查核、正式發起與結果；關頁或短暫失聯不會遺失工作或再建工作。

**Blocked by:** [03 完整大量與混合名單背景發起](03-complete-roster.md)

**Status:** resolved

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US2；FR-008–010、016；SC-003、007。

**Tasks:** [T016–T020](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [x] latest 無工作回 null；job 與 latest 是只讀摘要，未登入 401，非建立人與不存在統一 404，回應 no-store。
- **原列表摘要驗收被後端範圍取代（保留原文）：** 列表只對建立人提供摘要，其他部門讀者為 null；批次查詢小欄位，無 JSON filesort／N+1。
- [x] 原列表欄位保持不變，不新增 initiationSummary；22 份大型 job input、256KiB sort buffer 下查詢成功，查詢數恆定且不讀工作 JSON。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端 3 秒輪詢，終態與 401／403／404 停止，網路或 503 顯示暫不可更新；attempt 重新查核不累加或偽造百分比。
- **原 UI 驗收暫緩／後端部分仍適用：** 排隊、處理、成功與失敗 fixture 下重整／重登入都回到同工作，正常連線已更新進度 10 秒內可見。
- **原 UI 驗收暫緩／後端部分仍適用：** 22 份大 input／256KiB 排序緩衝驗證成功，輪詢回應大小不隨名單線性成長；busy UI 與服務端限制一致。

## 實作與驗證紀錄

2026-11-03，分支 `impl/022-04`，基準 `1b1211b5`；待 merger 整合，狀態保持 claimed。

- 完成 latest（無工作 null、以 ID 取最新）與 get 共用目前有效建立人授權、no-store、小摘要；部門讀者可讀原文件但不能讀工作。
- 授權與受理／成功重播採小欄位文件投影，不載入正式 signing payload；正式發起核心仍使用完整模型。
- 停簽、補簽及通知批次原先雖因 draft 拒絕，訊息不是 worker 忙碌；已於授權後、業務檢核前補共用 busy guard。queued／processing 全入口矩陣涵蓋 PDF／標題／期間／選項／替換名單／note／欄位／草稿儲存／刪除；非建立人仍 404。
- 前端、schema、環境變數及排程皆未修改。

### 驗證

- 紅→綠：latest 原本被 UUID route 解析而 400；新增固定路由後 200/null。
- 紅→綠：停簽原回 ESIGN_STATE_CONFLICT；補 guard 後 queued／processing 皆固定 ESIGN_INITIATION_IN_PROGRESS。
- 紅→綠：GET 摘要與成功後重播原本讀 signing_payload_json；小投影後 SQL 不再包含大型文件／工作 JSON。
- 查詢 8 例＋受理 11 例＋容量 13 例：32／32 通過，包含 22 份各 5,001 人大型輸入、256KiB sort buffer、固定 SQL 數、重登入查回、只讀與授權、failed 解鎖及 succeeded 舊規則。
- server unit：113 suites／1,175 tests；build 通過；lint 0 errors／272 既有 warnings，新檔案無 warnings。
- 隔離 MySQL `feastogether_intranet_test022_t04`、Redis 16322/DB4、獨立私有檔案目錄；只用合成資料、fake mail。
- 不宣稱已實作／驗收前端輪詢、10 秒畫面可見或前端輸入還原；它們已由最新 backend-only scope 暫緩。

## 本輪後端補充驗收

- [x] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [x] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。

- 補充查詢斷線案例：DB connection 邊界注入失敗，API 沿用 503；恢復後原工作仍 queued、attempt=0、errorCode=null，不把讀取失敗變成背景失敗。

## 整合驗收紀錄

- 實作 commit `0fdf05089e9c716aa6ff7bf6dedef51fdbc5c51b` 已由 `impl/022-04` 無衝突合併至 `impl/022-integration`，merge commit `5560f028c1ac4c74350e8a7b321883c7ffb15df8`。
- 合併 hook：lint 0 errors／272 既有 warnings，單元 113 suites／1,175 tests 通過。實作驗證 query 8＋acceptance 11＋capacity 13，共 32／32；server build 通過。
- T016–T020 後端範圍驗收完成並整合，狀態改 resolved；無 client 變更。05 仍在實作，06 必須等待 05 resolved。

### 2026-11-04 committing 忙碌訊息補修

- 文件／欄位／簽署名單／PDF／刪除／註記／停止／補簽／催簽，先小欄位建立人授權及 active EXISTS，再取得寫入鎖；正式 lease 保留原鎖內檢查。名單 users X、PDF prepare 前亦先拒絕。
- 真 worker 交易持鎖 5 秒，修改原本等約 5 秒才回 STATE_CONFLICT，修正後 1–3ms 固定 worker 409；各入口越權 404，無 job 資訊。新增受理／重試的 key 重播優先與快速拒絕另以後續小 commit 處理。
- 8 suites / 79 e2e、115 suites / 1180 unit、build 通過；既有 unit fixture 配合新增預檢更新，無前端／schema／env 變更。

### 2026-11-04 重複發起／重試預檢補齊

- 新 key／無 key 的重複發起，以及新 key retry，committing 時立即固定 worker 409。先驗有效建立人／文件，retry 再驗 parent 存在及關聯，避免 busy 洩漏或蓋過 404。
- document+key EXISTS 命中時保留原鎖內重播：測試 active 同 key 等 commit 回原 succeeded；歷史 initial/retry key 即使已有新 active 工作仍回原 failed 摘要；錯 hash/parent 仍 REQUEST_CONFLICT，錯 parent 404。
- 最終專用鎖測試增為 8 項；不增加 JSON 讀取、表、環境變數或前端修改。

## 正式交易期間快速 busy 補修整合紀錄

- 僅指定 commit `3f3f7f913c71a35358a3c256d89fed6558034141` 無衝突合併至 `impl/022-integration`，merge commit `34d3077974efd51e0791707c5652f16a57318033`；未取用 locks worktree 後續未提交變更，票 04 保持 resolved。
- 有權人的 fields／draftSave／settings／title／PDF／delete／note／stop／reopen／reminder 在正式 committing 文件鎖期間先取得固定 409 worker 執行中訊息，越權仍 404；原鎖內 busy guard 保留作競態防線。
- 實作 79 e2e、build/lint 通過；整合 hook lint 0 errors／272 既有 warnings、115 suites／1,180 tests 通過。
- 無 client 修改；accept／retry 重複發起 fast busy 與歷史 key 重播優先仍待下一補修，08 整體驗收未完成。

## 受理／retry 快速 busy 補修整合紀錄

- 僅指定 commit `b95c1cd392d508a8282cd693dd39994c7e5354a8` 無衝突合併至 `impl/022-integration`，merge commit `2a6421e23b1034fd681a848d406fdda51e391f9f`。新 key 重複發起／retry 快速拒絕與歷史 key 重播優先已整合。
- 實作 80 e2e、build/lint 通過；整合 hook lint 0 errors／272 既有 warnings、115 suites／1,180 tests 通過，client 無修改。
- 08 擴大回歸另發現共享資格鎖下，跨文件並行 accept 的不存在 key／active gap lock 與 INSERT request 唯一索引發生 deadlock；修正仍在下一補修進行中，本次不宣稱並行受理全部問題已解。08 維持 claimed。

### 2026-11-04 預審 P3 契約補修

- 有權建立人的忙碌 409 補 `details.existingJobId`，使用 active 工作 publicId；固定 code/message 不變。預檢與文件鎖內競態拒絕一致，越權 404 不含 details。
- 非 worker 的預檢／鎖內查詢僅投影公開識別碼，鎖內仍 current read；worker lease 維持完整版本核驗。HTTP 測試先以缺 details 紅燈、再以競態 fallback 的 JSON 讀取紅燈，修正後皆通過。
- initial/retry 新工作初始化在同 service 的 `newJobState` 收斂 publicId、狀態、計數與期限；授權／輸入來源／parent／hash 邏輯各自保留，以既有公開 API 回歸驗證，未新增鏡像單測或通用框架。
- 獨立預審補修基準驗證：8 suites / 83 e2e、115 suites / 1180 unit、build 通過，lint 0 errors／272 既有 warnings；待另行整合最新 dev/024 後重驗，不將本紀錄視為最終驗收。
