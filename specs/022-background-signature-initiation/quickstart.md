# 022 實作後驗證指南

> **最新範圍優先**：本輪只改後端 worker 與文件／簽署人異動保護；前端工作暫緩。原本必填 Idempotency-Key 改選填以相容既有 client。具體覆寫與已知限制見 [後端範圍決策](backend-only-scope.md)。

本文件描述未來實作完成後的驗收；目前只有設計，不能把下列情境標為已通過。使用合成資料與 fake mail，不在 UAT／正式資料庫跑 e2e，不寄真實郵件。

## 前置與指令

- 安裝依賴：`pnpm install`。
- 準備獨立 MySQL／Redis；server `.env.test` 的 DB 名必須以 `feastogether_intranet_test` 開頭，使用現有測試守門。不列印或提交帳密／名冊。
- 在測試 DB 套用既有與新工作表 migration；migration 必須先於啟動新 HTTP／worker。確認 queue 只有測試 worker 消費。
- 實作時把新的背景受理／恢復／容量測試加入 `server/test/jest-e2e.json`。測試建立員工、PDF、名單與郵件替身並自行清理，不使用真實員編。

實作完成後執行既有指令：

```bash
pnpm -C server lint:check
pnpm -C server test --runInBand
pnpm -C server test:e2e
pnpm build
pnpm lint
```

前端沒有 test script；操作驗收使用既有開發環境 `pnpm dev`（包含 HTTP、worker、client）與瀏覽器 Network。若隔離測試環境不能跑完整 suite，記錄明確子集、未執行案例與原因，不能宣稱整套通過。

## A. 所有人數受理與完整性

| 情境 | 預期 |
| --- | --- |
| 0 人 | 400，無工作／指派／通知 |
| 1、100、101、5,001 人 | 全部 POST 202；不依人數進同步分支 |
| 6,001 人 | 不被舊 helper 的 6,000 總數守門拒絕；分批查核與寫入、完整人數 |
| 混合內外部／全外部 | 同樣背景；外部原規則保留 |
| 選人樹重複展開 | 正確去重；非法重複輸入明確拒絕，不少發部分人 |

Network 確認按發起後沒有先打整份 resolutions，不呼叫 detail 等待才能顯示受理。每組 1／100／101／5,001 至少 20 次，記錄 accepted latency P50/P95、背景解析／交易／排隊耗時及記憶體。P95≤3秒是目標，不以本機單次數字代替 UAT 驗收。

正式成功後比較完整指派數、正式快照順序、唯一 document.initiated、初邀批次與通知紀錄。進度 completed 不代表全數郵件送達。

## B. 進度、關頁與輸入恢復

1. 暫停測試消費者，提交有效名單，應顯示 queued，仍可刷新／重登入查 latest，不產生第二個工作。
2. 恢復 worker，查核階段 processedCount≤totalCount；每次重新 attempt 明確顯示重新查核，數字不跨 attempt 累加。
3. 關閉發起頁，worker 仍完成；重新登入查到同工作結果。
4. 正式交易階段顯示「正在發起」，不可在未提交時顯示成功。
5. 失敗後重整，按需 GET input 還原全部名單與欄位；上游組織樹移除某員工仍保留可修正項目。
6. 進度輪詢僅摘要，回應大小／查詢數不隨 5,001 人線性成長；issues 按 100 筆分頁，沒有跨使用者資料。
7. 3 秒 polling，終態停止；斷網只顯示暫時無法更新，401／403／404 停止。已更新狀態在正常連線下10秒內可見。

## C. 冪等、並行與草稿保護

- 相同 key 同輸入重播：200 reused=true；queued／failed／succeeded 都回同工作，不新增指派或重送初邀。
- 原請求成功後、簽署期限過後及終態明細清理後，原 key 同內容仍回原摘要；人工 retry 重送也找到同一子工作，不被 parent 已非 latest 擋住。
- 相同 key 改內容：409；不同 key 同文件並發：只接受一個，另一個 409。
- 人工 retry 使用新 key／新 job；舊 failed key 重播不啟動新嘗試；舊 job 被新提交取代後不可復活。
- queued／processing 期間依序嘗試改標題／PDF／欄位／draft-settings／draftSave／signer note／刪除，所有適用寫入皆 409。直接呼叫 API 也不得繞過。
- 競態測試編輯與受理同時取得文件鎖，結果只能是編輯先完成後受理新版本，或受理先完成後拒絕編輯。

## D. 故障注入與原子性

| 注入位置 | 預期 |
| --- | --- |
| MySQL 受理 commit 前 | 無部分受理，client 保留輸入 |
| commit 成功但 HTTP 回覆遺失 | 同 key 或 latest 找回，不能雙發 |
| DB 已存但 Redis 入列失敗 | 工作仍受理；Redis恢復後既有maintenance補列 |
| 解析中 worker 終止 | lease到期後重試；重新核對資格與attempt進度 |
| 正式交易中終止 | 全部業務寫入回滾，租約恢復後重試 |
| commit 成功、queue acknowledge 前終止 | job已succeeded，重送直接結束，不第二次發起 |
| 舊worker租約失效後恢復 | CAS失敗，不能覆蓋新worker狀態 |
| 暫時DB故障持續 | 最多3次claim，30／120秒backoff，終態失敗 |
| 已超120分鐘或簽署截止 | 不再發起；有明確timeout／deadline分類 |
| 全面DB中斷 | 不假造即時終態；恢復後核對commit與期限 |

長時間正式交易時不能用獨立 heartbeat 等待自己持有的 job 鎖；測試 maintenance 不把仍可提交的工作先標失敗。故障恢復不能靠刪除工作、員工或指派後重跑。

## E. 身分、期限與資料

- 建立人／員工在受理後被停用、刪除、員編改動：正式提交重新查核，整份不成立。
- 本機無員工：failed＋可定位issues，不即時向Portal補建，不靜默略過。
- 沒有Email：仍可指派；初邀通知標既有RECIPIENT_UNAVAILABLE。
- 白名單阻擋／SMTP錯誤：job仍succeeded，通知顯示各自結果。
- 受理後原檔metadata／bytes不符、共用欄位非法、截止時間已過：整份失敗且保留原草稿，無部分通知。
- 非建立人（含同部門人）查latest／job／input／issues／retry皆拒絕；list不洩漏工作內容。
- 檢查application／access／queue logs：無完整名單、email、cookie、token、PDF；保留job/document/request correlation、stage及分類錯誤。

## F. 混合負載與期限

在空的隔離 queue 先送5,001人工作，再送5人工作；兩者受理仍符合目標，小工作顯示queued。大型成功或有限失敗後，小工作60秒內取得執行權，記錄總等待；不承諾插隊或立即完成。

另執行SC-006受控延遲（空佇列且 signEndAt 設於受理後超過 120 分鐘）：5,001人各首次查核延遲1秒，背景受理不等待，120分鐘內完成。heartbeat獨立於每500人一批的完成，避免單批延遲超過5分鐘就失租約。測試不把延遲加入正式程式；耗時驗收需獨立排程執行並保留彙總結果。

## G. 保留、列表與既有測試遷移

- 終態30天後清理input／issues／version JSON，input與issues回410、summary與原key重播仍可讀；非終態不可清掉。
- 以22份含大型job input的文件及256KiB排序緩衝測列表，確認摘要查詢不帶JSON、沒有N+1，也不重現PR #47的filesort錯誤。
- 更新既有core-esign-flow、internal-email／portal／group、reminder、rejection、draft-settings、delivery-security及benchmark中的發起假設：先assert202，驅動測試worker／等待終態，再進行後續簽署。受理前錯誤仍4xx，背景資格錯誤改驗job failed。
- 可以建立測試專用「受理並等待工作」helper；不能在production加入同步fallback。

## H. 發布演練

在受控環境先 migration，再於發起入口維護窗口協調 worker／server／client 更新；舊頁缺key顯示重新整理提示。清點queued／processing與工作成功後的通知狀態。

回退前停止新受理並處理非終態工作；不能直接部署沒有草稿busy guard的舊server。保留工作表；down遇非空表必須拒絕。所有結果以 [契約](contracts/background-initiation.md) 與 [資料模型](data-model.md) 為準。

## Ticket 01 實作驗證（2026-11-03）

- 基準：`eee0890`（程式基準 `4b79d08`，已合併 Spec 023 的 `1ab6b99`）。本機 UserRepository 每 500 筆查詢；發起信箱只讀本機主檔，signer／notification 既有 250 筆批次寫入，未改回 HR 查詢。
- Worktree／分支：`feastogether_intranet-022-01`／`impl/022-01`。使用本次專用 MySQL 13322、Redis 16322，DB `feastogether_intranet_test022_t01`、Redis DB 1；`.env.test` 未提交。合成資料與 fake mail，沒有使用 UAT。
- 已核准測試 seam：正式發起 service 的呼叫端交易／actor，以及 HTTP 與真實隔離 DB 的原子性。先新增 core seam 測試，因 `initiateInTransaction` 尚不存在失敗，再完成拆分；5 個單元案例通過。
- `initiateInTransaction(input, manager)` 只使用傳入 manager，回傳 document／notificationJobs，不自行 commit 或 enqueue。原 HTTP 包裝沿用既有結果，於交易提交後才 enqueue。
- `core-esign-flow.e2e-spec.ts` 完整 25／25 通過，新增「呼叫端於核心完成後拋錯」驗證：原草稿／欄位／名單恢復且沒有入列；移除不適用的 document updatedBy 斷言後，再跑該原子案例通過。
- `pnpm -C server build` 通過；`lint:check` 0 errors／272 既有 warnings。無 client、migration 或環境設定變更。
- Actor 邊界：文件 entity 只有 createdByUserId，沒有 updatedByUserId 欄位，故不新增 schema；核心的 signer 更新、notification notifiedByUserId 與 audit actorUserId 都明確來自 input.creatorUserId。後續 worker 必須傳入原建立人，不依賴 HTTP CLS。
- 這一票只完成核心重構，尚未啟用背景受理或 busy guard；後續票驗收不能由本節推定通過。

## Ticket 02 驗證紀錄

2026-11-03，隔離 worktree impl/022-02：後端受理／busy guard／真 queue e2e 10/10，新 schema＋既有 migration 15/15、drift=[]、mysql.options 7/7；server unit 113 suites/1175 tests、build、lint 0 errors 通過。未更動 client；尚未執行完整容量、復原、保留與全套 e2e，後續票完成後再驗收。詳見本機 ticket 02 的實作紀錄。

## Ticket 03 實作驗證（2026-11-03）

在 `impl/022-03`、基準 `bf36b658` 的隔離 `feastogether_intranet_test022_t03`／Redis DB3 執行：容量 13 項加受理 10 項共 23 項通過，涵蓋 6,001 人、混合／全外部、缺信箱與實際白名單跳過、正式交易前 committing、映射及原檔競態、停用建立人、跨批全回滾。RR 原檔快照加強案例另行通過。server build 通過，lint 0 errors／272 既有 warnings。

worker 以每批 500 人預查及 CAS 更新本 attempt 進度，鎖內再次驗證全部資格；既有 250 筆寫入仍全交易提交。沒有改 client，前置解析與成功文案仍保留既有行為；本輪以無 key 舊 body 的 API 相容性驗收。heartbeat／maintenance 恢復與正式效能矩陣留待後續票，未在此提前標記通過。

## Ticket 04 實作驗證（2026-11-03）

- `impl/022-04` 基於 `1b1211b5`；T016–T020 完成後端範圍。
- `pnpm -C server test:e2e --testPathPatterns='esign-initiation-(query|acceptance|capacity)'`：3 suites／32 tests 通過。
- `pnpm -C server test --runInBand`：113 suites／1,175 tests；`pnpm -C server build` 通過；`pnpm -C server lint:check`：0 errors／272 既有 warnings。
- 紅燈先證實 latest 路由、直接 creator 異動入口忙碌訊息、GET／重播大型 JSON 投影三項缺口，再實作轉綠。
- 真資料庫驗證 22 份大型工作輸入在 256KiB sort buffer 下列表成功、SQL 數不隨文件增加；列表 API 不增工作欄位。摘要不載入 input/issues/version 或文件 signing payload。
- queued／processing 的全異動入口及非建立人隔離通過；worker 成功前列表仍 draft，成功後 active，failed 才解除 busy。
- 使用專用測試資料庫、Redis DB4 及合成私有檔案；未修改 client，UI 輪詢與畫面進度驗收按 backend-only scope 暫緩。

- 補充查詢斷線案例：DB connection 邊界注入失敗，API 沿用 503；恢復後原工作仍 queued、attempt=0、errorCode=null，不把讀取失敗變成背景失敗。

## 05 有限恢復驗證紀錄（2026-11-03）

分支 `impl/022-05`，隔離 MySQL `feastogether_intranet_test022_t05`／Redis DB5，合成名單與 fake mail。recovery 13／13；02／03／05 回歸 36／36；unit 113 suites／1,175 tests；server build 通過，lint 0 errors／272 既有 warnings。

涵蓋退避／耗盡、過期租約與舊 token、可靠補列、正式交易持鎖略過、全部寫入後回滾、commit 前期限、DB 無法保存失敗狀態後恢復，以及成功後通知失敗不回退。單批跨 5 分鐘及 120 分鐘期限以受控時鐘搭配真 DB 驗證，不是 5,001 秒實時間效能結果。

實作在正式交易開始前停止並排空在途 heartbeat，再取得新鮮租約；因此不會持 job 鎖等待自己的 heartbeat。正式交易等待過久導致租約失效時仍由鎖內驗證拒絕，不讓舊持有者提交。

04 整合後回歸：保留 latest／小投影與所有異動 guard，只有測試清單衝突並已取聯集；server build 通過，02／03／04／05 四套 45／45 通過。

## Redis 空庫重連驗證（追加 05）

既有 worker 現在會在啟動與 Redis ready 後重建同一個 30 秒 maintenance scheduler、恢復 initiation global concurrency 1。設定失敗會以 1 秒起、上限 30 秒退避重試；期間新 delivery 不 claim DB，原 queued 工作由恢復後的 maintenance 補列。錯誤事件為 `esign.queue_restore_failed`，不含連線字串或工作輸入。

破壞性故障測試僅在以下專用資源啟用；一般測試 DB 會 skip 此 suite。請確保 Redis DB9 專供本測試，測試會清空 DB9 並斷開 DB9 連線，但不重啟 Redis 容器、不影響其他 DB：

```bash
NODE_ENV=test DB_MYSQL_HOST=127.0.0.1 DB_MYSQL_PORT=13322 DB_MYSQL_USER=root DB_MYSQL_PASS= DB_MYSQL_DB=feastogether_intranet_test022_reconnect REDIS_HOST=127.0.0.1 REDIS_PORT=16322 REDIS_PASSWORD= REDIS_DB=9 ESIGN_STORAGE_ROOT=/tmp/esign-test022-reconnect pnpm -C server test:e2e --testPathPatterns=esign-initiation-reconnect
```

真 MySQL／Redis、合成員工與 fake mail 驗證：啟動 gate、metadata 清空後兩個 worker 同程序恢復、恢復配置 pending 時 delivery 不 claim、maintenance 補列完成兩份 DB queued 工作；恢復後新工作最大同時處理數 1。02–05 加 reconnect 回歸 5 suites／46 tests；unit 115 suites／1,180 tests，build 通過，lint 0 errors／272 既有 warnings。

這個並行量結果針對配置恢復後的新工作。Redis 資料遺失前已在 DB 正式交易中的不同文件，不能靠消失的 active 記錄保證全域單工；每份文件仍以 DB lease/token 保證舊持有者不能重複提交。單純手動清 keys 而連線未斷不會產生 ready，屬此恢復機制範圍外。
