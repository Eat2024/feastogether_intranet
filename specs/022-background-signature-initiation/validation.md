# 022 本機整合驗收

驗收工作樹 `impl/022-08`，整合分支 `impl/022-integration`。本輪只改後端；不部署、不寄真信、不操作 UAT。所有資料為合成員工／文件，寄信由既有 fake mail fixture 隔離。

## 環境與重現

- MySQL `127.0.0.1:13322`，8.4.11；Redis `127.0.0.1:16322`，7.4.11；不是 UAT 8.4.7。
- 主 suite：`feastogether_intranet_test028`、Redis DB8、私有檔案 `/tmp/esign-test022-t08`。原 `test022_t08` 基底加 schema fixture UUID 超出 MySQL 64 字元限制，改短的隔離資料庫，未改正式設定。
- matrix／mixed：`feastogether_intranet_test022_t08bench`、Redis DB11、`/tmp/esign-test022-t08bench`。
- 長測：`feastogether_intranet_test022_long`、Redis DB10、`/tmp/esign-test022-long`；與一般 suite 的 DB、queue、私有檔案分離。
- 既有 `.env.test.example` 複製為未追蹤 `.env.test`，只改本機連線及隔離名稱；無新增 dependency、正式環境變數或排程。
- `pnpm install --frozen-lockfile` 成功。

```bash
DB_MYSQL_DB=feastogether_intranet_test028 pnpm -C server test:e2e
DB_MYSQL_DB=feastogether_intranet_test028s pnpm -C server test:schema
DB_MYSQL_DB=feastogether_intranet_test022_t08bench REDIS_DB=11 ESIGN_STORAGE_ROOT=/tmp/esign-test022-t08bench pnpm -C server test:e2e --testRegex 'esign-initiation-benchmark.e2e-spec.ts$' --testNamePattern 'SC-001|SC-008'
DB_MYSQL_DB=feastogether_intranet_test022_long REDIS_DB=10 ESIGN_STORAGE_ROOT=/tmp/esign-test022-long pnpm -C server test:e2e --testRegex 'esign-initiation-benchmark.e2e-spec.ts$' --testNamePattern 'SC-006'
```

## 受理效能與排隊

最新矩陣基準 `6f2861ee`（共享鎖／快速busy／短交易READ COMMITTED補修整合），08 merge為`170e83c`。每組20次，P95取排序後第19次；只量 POST受理，不含上傳、既有前置員編解析或後續GET詳細資料。背景處理仍由真實 `EsignInitiationJobService.process` 使用真 MySQL/Redis 執行，逐次驗成功與完整簽署人數。資料與負載僅代表本機合成環境。

| 簽署人 | 樣本 | POST P50 ms | POST P95 ms | 背景處理最大 ms | 測試程序峰值 RSS bytes |
| --- | --- | --- | --- | --- | --- |
| 1 | 20 | 9.28 | 14.09 | 63.90 | 478347264 |
| 100 | 20 | 10.22 | 15.03 | 204.59 | 485195776 |
| 101 | 20 | 10.66 | 12.80 | 69.10 | 271417344 |
| 5001 | 20 | 92.83 | 98.19 | 1529.50 | 717602816 |

80次全通過 P95≤3000ms。背景處理數字包含完成後摘要／詳細資料HTTP驗證；RSS是Jest測試程序累積峰值，不是獨立正式worker記憶體基準。

SC-008 真 Bull Worker、queue global concurrency=1：先提交5001人，再提交5人；大型POST106.86ms、小型POST8.08ms。大型成功後9ms小型取得執行權，兩份皆 succeeded，符合60秒門檻。原始結果存本機 `/tmp/022-acceptance-benchmark.json`、`/tmp/022-mixed-benchmark.json`。

## Review 發現：同建立人跨文件受理仍可能等鎖

獨立DataSource先持有建立人users列5,000ms，模擬另一份文件worker正式交易；第二份草稿已先上傳，才開始計POST受理。實測5,030.89ms後回202，釋放後正常完成。正式pool維持2、鎖順序未改。重現為benchmark的`review 同建立人`案例，結果 `/tmp/022-creator-lock-benchmark.json`。

這證實原accept會等同建立人users行鎖；上述80次無競爭P95通過不代表此情境滿足3秒。5001秒預查本身不持此鎖，但最後正式交易可能延長另一份文件受理。後續補修 `2655231` 將正式資格與受理鎖改為共享鎖，保留 users→document→job 及與停用／Email寫入的排他隔離；真worker持鎖5秒的另文件受理降至約8–12ms，證據見共享鎖補修票及quickstart。獨立排他寫入仍會阻擋FK引用，不能把原測試的排他鎖改稱為新版worker鎖。

08在最終補修整合後重新量測真worker持鎖5,000.88ms：另一份POST受理18.91ms；同文件PUT fields在6.20ms回409 `ESIGN_INITIATION_IN_PROGRESS`與固定worker執行中訊息。結果 `/tmp/022-worker-shared-lock-benchmark.json`。中間版本同文件修改等待文件鎖佔用pool2，連帶讓另一文件受理等待5秒；快速busy預檢修正後不再佔住連線等待正式交易，原鎖內二次查核仍保留。

共享鎖另外暴露跨文件並行受理deadlock：原internal-email雙POST案例在worker尚未執行時收到202／503。MySQL最新deadlock顯示兩個INSERT互等`uq_esign_initiation_jobs_request` insert-intention，底層`ER_LOCK_DEADLOCK`，API映射`ESIGN_INITIATION_TRANSIENT_FAILURE`。補修僅讓accept／retry短交易使用READ COMMITTED，保留document鎖、current reads與unique約束，正式worker仍用原隔離層級。沒有吞503或放寬測試；原雙POST案例及barrier重現已在最終回歸通過。

## SC-006 實時間長測（完成，保留主機睡眠造成的 queue 異常）

UTC 2026-11-03T15:14:35.183Z 開始；期限120分鐘，簽署截止設為24小時後。測試在每批首次 `UserRepository.findByIds` 查核注入 `batch人數 × 1000ms` 真實 timer，每位選中者只加一次，正式鎖內信箱重核不再加第二輪延遲。真Bull Worker進入正式service，heartbeat獨立續租；沒有使用 fake clock。

進度 `/tmp/022-long-benchmark-progress.json` 每30秒記錄 UTC/實際elapsed/processed/total/lastHeartbeat/status/stage/attempt，不含名單；結束另寫 `/tmp/022-long-benchmark-result.json`。啟動時正式程式基準為 `fadfc3f8`；後續Redis重連補修不在此已載入程序內，不把此長測宣稱為重連測試。初始錯誤 seam（鎖內重核延遲）已停止並捨棄，不計成功結果。正確這輪包含約30秒的初始排隊等待，總實際時間不扣除此等待。

過程異常保留：唯讀電源紀錄確認本機2026-11-03 23:44:05 Sleep、23:44:07 Wake後再Sleep、23:49:56 Wake（UTC15:44–15:49）。Redis未在該時段重啟。Bull工作2於UTC15:50:55.819Z發生stalled、回waiting，stalledCounter=1、queue lock消失；原process仍執行，DB lease持續續租且attempt=1，2,500筆預查時正式signers仍0。原始console的`could not renew lock`不隱藏，不只以Jest綠燈判定結果。

UTC16:01:03起使用`caffeinate -i -w 12482`僅綁長測process防止後續idle sleep；沒有改app/worker config或deadline。另以唯讀observer記錄DB狀態／lease／正式指派數與Bull狀態及原process存活，最終結果需對照 `/tmp/022-long-observer.jsonl`、`/tmp/022-long-terminal-observation.json`、`/tmp/022-long-observer-final.json`，不扣除睡眠造成的等待。

最終於 UTC 2026-11-03T16:39:59.178Z 完成，實測 5,123.645 秒（85.39 分鐘），5,001 位各首次延遲 1 秒，POST 114.93ms。DB succeeded／completed、processed=total=5,001、attempt=1、lease=null；獨立 observer 及 GET detail 皆驗正式 signers=5,001。Jest 1 passed、exit0；這輪驗收滿足120分鐘門檻，僅對啟動時 `fadfc3f8` 的功能路徑提供證據，不代表新版 Portal／重連補修也在同一長測被驗證。

Queue 的最終真相：原 process 完成DB提交後，因睡眠期間遺失 Bull lock，`moveToFinished` 記錄 `Missing lock for job 2`；同一 job 於16:39:58.804從waiting再active，16:39:58.809發出completed。DB completedAt為16:39:58.783；再次領取遇DB終態後no-op，未增加DB attempt或重複指派，隨removeOnComplete移除queue metadata。終態取樣16:39:59.294時process仍alive／DB成功／signers5,001／Bull absent，16:39:59.711 process已退出且測試自身fixture清理完。Redis事件沒有fixture removed事件，不能把absent誤稱尚未完成或宣稱原delivery正常完成。事件證據 `/tmp/022-long-queue-events.json`，完整console `/tmp/022-long-benchmark.log` 保留；沒有隱藏異常或重跑83分鐘來取代這次結果。

## 回歸與測試遷移

先確認舊 internal-email-signing 三項因201期待失敗，再改為明確202、同HTTP app真worker service、GET job摘要、GET文件詳細資料。保留既有repository/service spies與交易故障注入；背景資格錯誤檢查 failed／errorCode，不偽造同步422。來源暫時故障持續注入三次，測試只將nextAttemptAt移至已到期以略過30/120秒退避，真claim次數及交易不變；這不是實時間退避驗收。

- fixture清理只刪自身document jobs，ID倒序先子後父，保留FK。已由helper處理的等待dispatch依自身job ID移除；不清其他測試資料。
- PDF worker fixture同時pause新initiation queue，避免另一app instances搶工作而繞過既有spies。
- retry資格競態原52秒失敗：外部鎖持有者佔app pool2之一，worker交易佔另一條，HTTP輪詢等不到連線。改測試外部持鎖者使用獨立DataSource，正式pool維持2，原鎖內資格與HTTP取樣斷言保留，8/8於1.7秒通過。未改正式pool規格。
- schema約束清單增加8個新工作表CHECK；仍比對完整精確清單。
- Swagger原新端點只描述裸DTO；先新增失敗斷言，再補純metadata Response DTO，所有成功回應含 `{success,data,timestamp}`，latest 的 data 可為null。api-coverage41/41通過，Controller執行回傳不變。
- `pnpm -C server test --runInBand`：整合Redis重連補修後115 suites／1180 tests通過（commit hook實跑）。
- `pnpm -C server lint:check`：0 errors／272既有warnings；root `pnpm lint`與`pnpm build`通過。最終完整性補修整合後將再驗必要範圍。
- `test:schema`：5 suites／30 tests通過，包含新工作表約束、非空down拒絕／空表down-up及drift。
- `test:e2e:security`：14 suites／84 tests通過。
- 完整e2e第三輪（integrity整合基準a24d409，merge f7eefd0）：47 suites／483 tests通過，reconnect專用環境跳過1項。前輪唯一pool自我餓死案例已修，這輪完整通過。後續鎖競態補修的受影響範圍回歸另列於下。
- 最終補修基準6f2861ee（08 merge 170e83c）：受影響16 suites／204 tests全通過，包含受理／查詢／資格／恢復／retry／保留／版本／共享鎖及並行gap、原core簽署三套、internal-email兩套、草稿／簽署人異動與API coverage。root build再次通過；merge hook unit115 suites／1180 tests、root lint通過。
- Redis重新連線suite只在專用DB9執行，一般DB8按既有保護跳過；本票沒有重新操作DB9。
- benchmark/helper與既有export benchmark以TypeScript semantic program檢查通過；Spec009整套大型ZIP容量腳本未重跑，本輪只遷移其HTTP發起fixture。

## 未改 client 的相容性與限制

靜態呼叫證據：`client/src/features/esign-documents/DocumentSignersEditor.tsx` await `initiateDocument` 後未讀回傳詳細資料，仍導向 `/forms?flash=published&count=...`。舊API wrapper仍宣告詳細資料型別，但實際回202工作摘要；本輪按授權不改前端。無key舊body由後端相容受理，工作中列表維持draft，成功後active，異動回409 worker執行中訊息。

本輪沒有瀏覽器互動驗收，也未新增列表進度、輪詢、失敗還原畫面。既有前置解析耗時、型別宣告與published成功文案限制仍存在，不宣稱此後端修改解決全部前端等待。

## 發布與回退

只在隔離本機演練 migration；未部署 UAT。新表migration必須先於新版worker/server，然後協調切換兩個entrypoint；本輪client不部署。回退前先停止新受理並結清所有queued/processing，保留工作表與終態摘要，不能把尚有非終態工作的server直接換回舊同步版本。

`esign-initiation-schema.e2e-spec.ts` 真MySQL驗非空工作表down拒絕且資料保留，測試自身合成列清空後down/up可重建；這只是空表DDL回退演練，不是建議刪除正式工作紀錄。非空表正常回退保留schema，既有簽署證據不可刪除。

## 最新 dev 整合基準（2026-11-04）

- 原 review baseline：`4b79d08dc8ea931afd73bb868089c9b16c13bede`；最新固定 dev baseline：`ef0fdca6da66afe8495b589390ddaf647c9dcdbf`（含 Spec024 Portal 來源）。後續正式 review 應比較新 baseline 與 022 整合分支，避免將已上線的 024 列為本功能差異。
- 在獨立 022 worktree 合併 dev；e2e testRegex 取兩邊仍存在 suite 的聯集，保留 Portal 與背景發起測試。production server build 通過。
- Fixture 遷移 `e98172e`：022 acceptance／recovery／reconnect 使用 `createSyntheticPortal` 與真實 PortalDirectory／EligibleStaffService 登入；其餘既有業務測試保留原 EligibleStaffService stub，直接安排自身合成本機 users.email。清除全部 11 個檔案的舊 helper 引用並刪除 helper；未復活 HR 網路路徑或正式 fallback。
- 合併 reviewfix 後基準 `8a92bc5`：正常 hook unit119 suites／1213 tests、root lint0errors／272warnings；root build、security14 suites／84 tests、新 Portal fixture 的專用 Redis DB9 reconnect 1／1 通過。schema5 suites／30 tests亦通過；該基準後續完整 e2e 與補修結果列於下。
- 新完整回歸發現 reminder 兩個並發案例（email／user）皆回 `[202,202]`，違反只接受一批的 `[202,409]` 斷言。獨立重現一致，未放寬測試。原因定位為 document 鎖前 busy 預檢在 REPEATABLE READ 交易內建立 snapshot，後續催簽 history 查詢看不到前交易提交；補修與全 mutation 盤點由 reviewfix 分支進行。
- 08 長測仍在舊 worktree／DB10，不變動；原 checkout 由使用者操作，本次沒有切換或修改。新 base 的完整回歸結果見末節；正式 review 由整合者收尾。

## 最新 dev 合併後補充驗收

`8a92bc5` 上 Redis13 專屬重跑80次矩陣全過（前一Redis11與另一代理短暫共用的輪次即使綠燈亦捨棄）。1／100／101／5,001 的 POST P95 分別12.40／12.58／18.15／99.45ms，背景最大92.76／107.61／121.47／1,414.57ms；5001人測試程序峰值RSS893,403,136bytes。混排大型85.96ms、小型7.38ms受理，大型成功後18ms小型開始。仍是本機合成users、無SMTP寄送，正常無鎖競爭負載，不替代正式環境量測。

第一次最新base全e2e：47 suites通過、3失敗、1專用reconnect跳過；524 tests通過、6失敗、1跳過。保留失敗原因及修復，不將舊結果冒稱新版全綠：

- 催簽三項並發失敗是前述RR snapshot，正式修正將busy預檢移出交易，鎖內current-read查核保留。
- 兩項午夜fixture把Date固定今日UTC15:59:50，真DB時鐘過了該時間30分鐘後，新的背景deadline會正確判逾時。改取下一個未來午夜邊界，保留跨日及群寄斷言；兩項2/2通過。這是假時鐘的既有催簽日界線驗證，與SC-006真實時間長測分開。
- 直接 `Promise.all(service.process)` 的跨文件案例刻意繞過正式queue global concurrency=1；真MySQL顯示兩個 `esign_document_fields` INSERT互等 `idx_esign_document_fields_doc_page_sort_id` supremum gap，rollback一筆。該job正確queued／`ESIGN_INITIATION_TRANSIENT_FAILURE`／attempt1／nextAttemptAt，另一筆成功。只在此案例明確驗暫時錯誤與排程後，提前測試自身job的nextAttemptAt、有限最多3次真process，再斷言兩份succeeded及指派完整；未改production隔離、未讓共用helper偷偷重試。單例修後1/1通過；這是直接service並發恢復驗證，不宣稱正式queue同時執行兩份。

最終補修整合 `2f0657d` 的第一次完整回歸受到主機再次睡眠干擾：電源紀錄顯示本機2026-11-04 00:40:19 Idle Sleep，之後反覆Maintenance Sleep／DarkWake；suite記錄2015.86秒（不等於全部牆鐘期間），5 suites／8 tests失敗，內容為超時、worker未到終態與Portal15秒回應量測變41.421秒。前述RR／午夜／並行service六個原失敗已通過，但不能因此稱該輪全綠，也不把每個新失敗未經重驗直接歸因睡眠。保留 `/tmp/022-final-full-e2e.log`，以 `caffeinate -i pnpm -C server test:e2e` 僅綁後續測試子程序生命週期重跑，不改系統永久設定、不重跑SC-006。

## 最終交付驗證（2026-11-04）

程式基準 `2f0657d`，包含最新 dev `ef0fdca`／Portal fixture／reviewfix／busy預檢snapshot補修；後續僅驗收文件狀態變更。

- 完整 e2e 防睡眠重跑：50 suites／531 tests通過、reconnect專用1 suite／1 test依環境保護跳過；219.023秒、exit0。前一睡眠輪8項失敗皆恢復綠燈，沒有放寬timeout或業務斷言。
- reconnect已於相同新Portal fixture在專用DB9獨立1／1通過；合計51套聯集皆有執行證據。
- merge hook：server lint:check／root lint通過（0 errors／272既有warnings），unit119 suites／1213 tests通過；root build通過。
- 新base schema5 suites／30 tests、security14 suites／84 tests通過，均使用隔離本機測試資料庫；之後source補修只移動busy預檢位置，完整e2e再次覆蓋授權與409行為。
- 6001人完整性案例已包含於完整e2e：全部指派／payload順序／6001筆稽核／初邀log／唯一batch，重複process不增加attempt、不雙發。
- 長測phase觀測：初次queue等待約30秒；首次active15:15:05.361至committing16:39:57.708約5092.35秒（包含受控查核延遲與主機睡眠），committing至DB成功16:39:58.783約1.075秒。這是stage邊界的觀測時間，非純SQL CPU時間；正常矩陣另列合計背景處理與測試程序RSS。
- 重跑初期host／MySQL UTC／Redis TIME差約3ms，沒有把driver本機時區解析造成的Date顯示差誤當容器時鐘偏移。`caffeinate`隨測試子程序結束，沒有永久電源設定。

```bash
DB_MYSQL_DB=feastogether_intranet_test029 caffeinate -i pnpm -C server test:e2e
DB_MYSQL_DB=feastogether_intranet_test022_reconnect REDIS_DB=9 ESIGN_STORAGE_ROOT=/tmp/esign-test022-reconnect pnpm -C server test:e2e --testPathPatterns esign-initiation-reconnect
DB_MYSQL_DB=feastogether_intranet_test029s pnpm -C server test:schema
DB_MYSQL_DB=feastogether_intranet_test029q REDIS_DB=13 ESIGN_STORAGE_ROOT=/tmp/esign-test022-security pnpm -C server test:e2e:security
# security結束後才將同一專用Redis13交給矩陣；不得並行共用。
DB_MYSQL_DB=feastogether_intranet_test022_t08bench REDIS_DB=13 ESIGN_STORAGE_ROOT=/tmp/esign-test022-t08bench pnpm -C server test:e2e --testRegex 'esign-initiation-benchmark.e2e-spec.ts$' --testNamePattern 'SC-001|SC-008'
pnpm build
```

T031–T034的後端實作與隔離驗收已完成，票08維持claimed，待合併至整合分支及正式code review後由整合者結案。client／瀏覽器互動／UAT部署／真實寄信及新版基準重跑85分鐘仍未執行，不把舊基準長測或API smoke冒稱涵蓋這些項目。
