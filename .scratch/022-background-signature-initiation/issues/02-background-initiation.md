# 02: 單人背景發起完整流程

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人確認一位簽署人後，立即取得可追蹤工作並看到處理狀態；關頁仍由 worker 完成正式發起，重送不雙發。

**Blocked by:** [01 保留行為的正式發起核心重構](01-transaction-core.md)

**Status:** resolved

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US1；FR-001–008、015；SC-001、003–005、007。

**Tasks:** [T004–T011](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [x] 建立計畫中的唯一工作表，完整落實資料模型的欄位、唯一索引、FK、JSON 最小讀取；migration 非空 down 拒絕，無第二張表／新 env／排程。
- [x] 受理先持久保存完整確認輸入與版本再回 202＋Location；相同 key 同內容重播 200 原摘要，異內容或另一進行中請求 409。已過截止仍可授權後重播舊 key。
- [x] 建立人與現行資格在受理及正式交易均驗證；0 人／非法輸入拒絕，其他使用者不能看工作。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端不先解析整份名單，固定 key 提交、顯示排隊並以摘要追蹤；只有 succeeded 顯示已發起，不以 HTTP 202 判成功。
- [x] queue 僅 job ID、全域並行 1、claim 不跨正式交易持 job 鎖；正式文件與 succeeded 同次 commit，成功重送不再生成指派或通知。
- [x] 全部草稿寫入入口在同一文件鎖下拒絕 busy；新 PDF 被拒後清理新檔，不能只禁用按鈕。
- **原 UI 驗收暫緩／後端部分仍適用：** 通過單人端到端、schema、越權、同／不同 key 競態、全部寫入保護與前端操作驗收。恢復／保留等尚未完成的能力明列，不部署此中間版本。

## 實作與驗證紀錄

已完成實作與整合，詳細證據見下方紀錄。

## 本輪後端補充驗收

- [x] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [x] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。

## Ticket 02 實作紀錄（2026-11-03）

狀態保持 claimed，等待整合分支 merge 後結案。T004–T011 已完成，client 無修改。

- 新增單一工作表、完整約束／索引、JSON 最小讀取、非空 down 拒絕；schema metadata 與 migration drift 為空。
- 舊 userId/email 無 key 請求可受理；選填 UUID key 支援同 hash 重播，即使截止已過也先查回原工作。HTTP 202 只代表受理，無同步 fallback。
- worker 使用獨立 module 與全域並行 1；正式資料與 job succeeded 同交易。公開 `EsignInitiationJobService.process(jobId)` 是實際 queue 的同一入口，供後續測試遷移使用。
- 文件鎖後的 active job 查詢使用 current locking read；queued／processing 保護草稿更新、刪除、完整設定、fields、簽署人名單與 note。worker 僅具體 job＋lease 可通行，會再驗原檔與微秒版本。
- claim 寫入後明確重讀 select:false 的輸入；實際測試發現 TypeORM save 回傳 entity 不保留該欄位，不能依賴 save 回傳值當執行輸入。

### 驗證

- TDD：首個 HTTP 受理測試原先因 201 而非 202 失敗；實作後通過。新 schema 起始 3 項因表不存在失敗，完成後通過。
- 新 HTTP／真 queue e2e 10／10：受理、重播、授權、所有異動入口、RR 舊快照、並行去重、processing 保護、截止後重播、employeeNo、正式核心後拋錯回滾與真 worker。
- 新 schema 4 項＋既有 migration 11 項，共 15／15，包含 drift 空陣列與非空 down 拒絕；mysql.options 單元 7／7。
- 全部單元 113 suites／1,175 tests；server build 通過；lint 0 errors／272 既有 warnings，新檔無新增 warning。
- 專用 MySQL 13322、Redis 16322，資料庫 feastogether_intranet_test022_t02，schema 隨機資料庫由既有守門管理；只用合成資料與 fake mail。

### 後續票界線

03 補完整容量與分批進度；04 補 latest／查詢驗收；05 補獨立 heartbeat、有限重試與 maintenance 補列，現階段僅持久保存失敗派送；06／07 補重試、input/issues 與保留清理。舊 HTTP 201 e2e 於 08 遷移，本票不宣稱全套 e2e 已綠燈。前端既有 resolutions 與 published 提示限制依最新範圍保留。未部署、未寄真信、未建 PR。

## 整合驗收紀錄

- 實作 commit `af8b6210c6a5bc129860d29517752c374d852b70` 已由 `impl/022-02` 無衝突合併至 `impl/022-integration`，merge commit `17afd13e9b13cd78a091ad81d4b482c95f84fc76`。
- 合併 hook：server/client lint 通過（0 errors、272 既有 warnings），單元 113 suites／1,175 tests 通過。實作證據為 HTTP／真 queue acceptance 10／10、schema／migration 15／15、build 通過。
- T004–T011 驗收及整合完成，狀態改 resolved；client 無修改。03–08 後續界線仍保留，不宣稱整份規格或舊 201 e2e 已完成。

## 共享資格鎖補修整合紀錄

- 指定補修 commit `2655231bfaca4cee88992600991971268a9fddc2` 已合併至 `impl/022-integration`，merge commit `f12b9f4fee6439eb578f8521c5c9bebd3ec3eeaf`；僅06票追加紀錄衝突，已保留兩邊證據，程式無衝突。
- 正式 worker 與受理／retry 建立人資格採共享鎖，保留 users → document → job 與資格原子性；其他停用／Email／員編寫入仍採排他鎖並等正式提交。
- 真 worker 持鎖 5 秒期間，另一文件受理由約 5,027ms 降至約 8–12ms；實作回歸 8 suites／79 e2e、build/lint 通過，merge hook 115 suites／1,180 tests、lint 0 errors／272 既有 warnings 通過。
- 本次只整合此共享鎖 commit，不含後續同文件快速 busy 補修；08 整體驗收仍未完成，未修改 client。

### 2026-11-04 跨文件並行受理 gap deadlock 補修

- 08 回歸發現同建立人不同文件 Promise.all 受理 `[202,503]`；SHOW ENGINE 顯示 request unique index gap X／insert intention 互等。專用 HTTP/DB INSERT barrier 重現 raw `ER_LOCK_DEADLOCK`。
- 僅 accept/retry 短交易指定 RC，保留 document 鎖、key/active unique、current read 及所有正式 worker 交易。MysqlService 可選 isolation 參數不改既有 callback/default。
- initial/retry 各兩文件並行都 `[202,202]`；真連線 commit 後 SESSION/GLOBAL 隔離維持不變，後續預設交易不發指定隔離 SQL。詳細原因與官方來源見 research R15。
- 驗證：8 suites / 82 e2e、115 suites / 1180 unit、build 通過；新增專用鎖測試 lint 無警告。未修改 08 測試檔或其長測 DB。

## 跨文件受理 gap lock 補修整合紀錄

- 指定 commit `a2ae05095e0bcd287b3ed4be29e563eea9cf9271` 無衝突合併至 `impl/022-integration`，merge commit `edcfbe4b70367e7fab50445f60d333fb84369798`。只將 accept／retry 短交易設為 READ COMMITTED，正式 worker 交易及 session／global 隔離設定不變。
- 實作 82 e2e、build/lint 通過；整合 hook lint 0 errors／272 既有 warnings、115 suites／1,180 tests 通過。跨文件不存在 key／active 查詢造成的 gap lock deadlock 已修正，仍需 08 擴大回歸驗收。
- 僅操作獨立 integration worktree，沒有切換／修改使用者原 checkout 或部署；client 無變更，08 保持 claimed。
