# Spec 030 實作驗證

## Ticket 01：按需更新（2026-11-06）

使用隔離 worktree `impl/030-01` 與合成帳號、簽署人、PDF；未連線 UAT，未提交環境 secret。US1 可示範，US2／US3 與整體發布尚未完成。

### TDD 與實際結果

- Public service 測試先看到新增第 2 人仍回傳舊 completed 工作（預期新 pending），及缺少 `documentState` 的失敗；實作後 9 個情境通過。涵蓋同數異 ID、改名不重包、讀取不寫入、current/work 分離、進行中／failed 共用、缺檔及無簽署。
- 全 server unit：119 suites、1198 tests 通過。
- `esign-export.e2e-spec.ts`：7 tests 通過。真實 MySQL／Redis／worker／local storage，驗證 1→2 份、讀取新增 100 筆不建工作、最新下載 10 次工作數不變、最新缺檔不回退、同部門及移部門權限，以及既有 worker 復原／Range 保護。
- ZIP 解開後確認兩個 entry：`副本__合成簽署人_<publicId>.pdf`、`副本_後來簽署_<publicId>.pdf`，分別逐 byte 比對不同的有效 PDF 來源。
- Chromium 真實 Next/API/worker 整合：1 人完成 → 加第 2 人 → 過時提示 → 點更新 → 2 份結果與下載；未 mock network。1 test 通過，畫面顯示 2/2 簽署、2 份 ZIP、「下載本次成果」。
- server lint：0 errors／291 warnings（包含既有 warnings）；client lint、server build、client webpack build 通過。
- 使用者確認沒有 ZIP expired 資料後，移除本票 ZIP service／repository 工作狀態相容分支與對應斷言，以及無 caller 的 archiveFile。依後續澄清，保留共用 EsignExportStatus／ExportHistoryView 的 expired（不推斷 Excel／PDF 資料），保留 expiresAt 欄位／index／API，不做 migration。文件期限及來源檔案 archive 狀態不受影響。

### 執行命令

以下在隔離 worktree 執行；pnpm 設定僅避免依賴 symlink 觸發重裝，不略過任何測試或 hook。

```bash
pnpm --config.verify-deps-before-run=false -C server test --runInBand
pnpm --config.verify-deps-before-run=false -C server test:e2e --runTestsByPath test/esign-export.e2e-spec.ts
pnpm --config.verify-deps-before-run=false -C server lint:check
pnpm --config.verify-deps-before-run=false -C server build
pnpm --config.verify-deps-before-run=false -C client lint
pnpm --config.verify-deps-before-run=false -C client build --webpack
pnpm --config.verify-deps-before-run=false -C client exec tsc --noEmit
```

瀏覽器 harness 保存在本機 `/tmp/spec030-browser/ticket01-browser.e2e-spec.ts`（合成 fixture；session cookie 僅在記憶體），截圖為 `/tmp/spec030-browser/ticket01-updated.png`。使用既有環境加外部 Playwright，不變更 repository dependencies。重跑時先複製 harness 至 `server/test/spec030-browser.e2e-spec.ts`，完成後移除臨時測試：

```bash
API_PROXY_TARGET=http://127.0.0.1:3031 pnpm --config.verify-deps-before-run=false -C client dev --webpack --port 3030
# 另一個 terminal；harness 啟動合成 API 在 3031
AUTH_TRUSTED_ORIGINS=http://localhost:3030 CORS_ORIGIN=http://localhost:3030 pnpm --config.verify-deps-before-run=false -C server test:e2e --testRegex spec030-browser.e2e-spec.ts --runTestsByPath test/spec030-browser.e2e-spec.ts
```

本機輸出保存在 `/tmp/spec030-01-{unit-all,e2e,browser,server-lint,client-lint,server-build,client-build}.log`；移除 expired 分支後 e2e 一度因既有 read-ahead 計數包含目的端啟動前的完整性讀取而失敗（102／171；原門檻 64）。將計數限定為目的端已啟動但尚未消費期間後，保持原門檻再跑 7/7 通過，輸出 `/tmp/spec030-01-e2e-recheck.log`。針對性初次輸出是 `/tmp/spec030-01-e2e-final.log` 與 `/tmp/spec030-01-client-typecheck.log`。這些暫存證據不是正式持久化 CI artifact。

### 驗收覆蓋及限制

| 成功條件 | 本票證據／後續 |
| --- | --- |
| SC-001 | 已驗證 1→2 份及真實 ZIP 內容 |
| SC-002 | 已驗證新增 100 筆、反覆預覽不建工作 |
| SC-003 | 已驗證最新重複下載 10 次；10 session 並發待 ticket02 |
| SC-004 | 固定 13→14 範圍與離頁恢復待 ticket02 |
| SC-005 | 原子取代與舊版停用待 ticket03 |
| SC-006 | 真實刪檔與恢復待 ticket03 |
| SC-007 | 已取代歷史、舊連結待 ticket03／整合 |
| SC-008 | 6,000 份容量驗證待整合票 |

未驗證 S3、舊版清理、完整並發／重試、雙 session 取代。Next 預設 Turbopack build 因隔離工作區的外部 node_modules symlink 失敗，webpack build 已通過；最終整合工作區仍須執行預設 root build/lint。沒有 client test script，瀏覽器證據不等同 client 單元測試。T005 的新增 exportState 僅屬 export preview，沿用既有 document summary 型別，無須修改 esignDocuments.ts。

### Ticket 01 整合驗證

- Merger 核對 6d93e69 相對 25a3fef 的差異與上述實際測試證據，fast-forward 整合成功。
- 在整合 worktree 執行預設 `pnpm build`（未傳 webpack）成功，包含 Nest build 與 Next Turbopack build；日誌 `/tmp/spec030-merge01-build.log`。隔離 worktree 的 symlink 限制不影響整合 build。
- 額外核對文件期限型別及推導未變、共用匯出 expired 保留、expires_at/index/API 沒有 schema 變更，無關使用者檔案保持未追蹤且未修改。

## Ticket 02：固定範圍與並發（2026-11-06）

使用 `impl/030-02`、隔離測試 DB、10 個合成員工 session 與有效 PDF，沒有連線 UAT。T014–T019 完成；取代／清理與容量驗證仍由後續票負責。

### TDD 與行為證據

- Public service RED：舊 failed 在有較新 failed 時仍被復活（預期拒絕，實際 pending）；改為文件鎖內以 current/work 判定最新可重試工作後 GREEN。15 個 service 情境通過，包括舊 completed 不截走新 failed、其他進行中工作共用、superseded／完整性錯誤拒絕與同 ID／同快照重試。
- 真實 API／MySQL／Redis／worker／storage：10 個不同員工 session 同時申請得到同一工作 ID、13 份快照，工作數為 1。故意令 queue.add 失敗，再由 maintain 恢復；第 13 份 PDF 尚未 ready 時工作 waiting，不產生缺件 ZIP。
- 等待期間新增第 14 人，再由 10 session 申請仍共用原 ID／13 份。PDF ready 後，HTTP 下載的真實 ZIP 恰好 13 個 entries，每份逐 byte 比對各自來源，沒有第 14 份。預覽缺 1 份；maintain 後工作數仍 1，沒有自動續包。
- 明確再次更新後建立 14 份工作，注入 storage 寫入失敗，再加入第 15 人。失敗期間舊 13 份 ZIP 仍可 HTTP 下載；retry 保留同 ID、14 份及 snapshot hash，完成後工作數為 2，沒有擴大為 15 份。
- 真 Chromium RED：第二個 session 在處理中返回頁面後，完成時缺少「下載本次成果」。將 requestedId 初始化為服務端 work.id，並以 document ID 作為 panel key 後 GREEN：兩個 session／重整皆追蹤同一 13 份工作；新增第 14 人僅呈現過時提示，完成可下載本次 13 份，工作數沒有自動增加。
- T016 沿用既有 processor 的固定 snapshot、等待及租約機制；新增端到端證據後不需修改 production worker。T017 沿用既有 query 的進行中輪詢／終態停止與完成、失敗時預覽／文件／歷史 invalidation。T018 沿用 ticket01 的兩個明確操作，補上重開追蹤後通過瀏覽器驗收。

### 執行結果與重跑

- 全 server unit：119 suites／1204 tests 通過；service 檔案 15 tests。
- 完整 `esign-export.e2e-spec.ts`：8/8 通過；真實瀏覽器 harness：1/1 通過。
- server lint 0 errors／292 warnings；client lint、server build、client webpack build 通過。10 並發 supertest 觸發 Node MaxListeners 警告，未停用警告且所有並發斷言通過。
- 前票 read-ahead 修正只限定目的端啟動時段；整檔執行仍曾計到 66（門檻 <64）。storage spy 作用於兩個 worker 的所有工作，時間條件不能隔離本案例來源；追加以本案例 source object keys 限制計數，保留兩 worker、慢目的端、<64 門檻及原工作數斷言後 8/8 通過。此處修正測量範圍，未改串流實作或放寬門檻。

命令同 Ticket 01（server test、指定 e2e、兩端 lint/build）。本機日誌 `/tmp/spec030-02-{unit-red,unit-green,unit,unit-all,e2e-fixed,e2e-all,browser-red,browser-green,server-lint,client-lint,server-build,client-build}.log`。瀏覽器 harness 位於 `/tmp/spec030-browser/ticket02-browser.e2e-spec.ts`，截圖 `/tmp/spec030-browser/ticket02-fixed-13.png`；以 Ticket 01 的步驟複製為臨時測試並啟動 Next 3030/API 3031，即可重跑。harness 和日誌是本機暫存證據，未提交 secret 或外部 Playwright dependency。

SC-003 的 10 session 共用與 SC-004 的固定 13→14／離頁恢復已有證據。文件 expired、共用非 ZIP expired、expiresAt/index/API 均保持；沒有 migration/config/dependency 變更。尚未在本票驗證舊版原子停用／實體刪除、S3 或 6,000 份容量。

### Ticket 02 整合驗證

- Merger 核對 6cf5b47 相對 b7a1840 的 service／UI／測試差異，以及 e2e 8/8、Chromium 1/1 實際日誌，fast-forward 整合成功。
- read-ahead 測試 sourceKeys 在排工作前收集本案例兩組 64 個來源，spy 仍觀察真實 openReadStream；保留兩 worker、200ms 延遲、peak=1 與 peakReadAhead<64，未放寬門檻或改動 production streaming。
- 已驗證項目不重複廣跑；整合狀態 commit 仍完整執行既有 lint/unit hooks。


## Ticket 03：原子取代與舊 ZIP 補清理（2026-11-06）

在 `impl/030-03`、隔離測試 DB 及 local/Moto storage 執行；無 UAT／正式資料或部署。首個 API RED 確認原本發布新版後舊工作仍 completed、files 仍可下載（`/tmp/spec030-ticket03-red.log`）；短交易發布與交易外清理後 GREEN。

### 發布與恢復證據

- 新版完成後，同交易寫入新 active/completed、舊 superseded/delete_pending；先 document 後 job 鎖，再檢查有效租約與目前合法工作。新 storage stat 失敗保留舊成果；真 MySQL 測試 trigger 在舊工作狀態更新時 SIGNAL，確認整筆交易回滾（新版 failed、沒有新成果列、舊版仍可 HTTP 下載）。測試 trigger 於 finally 移除，不屬於產品 schema/migration。
- 發布後注入刪除失敗，以及實體刪除完成後、狀態回寫前丟出錯誤；新版均保持 completed 且 HTTP 可下載，舊版立即拒絕下載，delete_pending 保留。未到 nextAttemptAt 不清理；60 秒後及重複 maintain 可恢復為 deleted。
- 活躍 staging reference 令刪除延後，釋放後才清除。實際 source document、個人 PDF、其他文件 ZIP 與最新 ZIP 保留；不建立新排程。
- 建立 51 個待清理工作，第一個持續故障：首輪僅處理 50 工作（49 刪除／1 延後）；同時間第二輪清除第 51 個，不被失敗首筆阻塞；60 秒後失敗項可恢復。待清理查詢只投影 ID，依 nextAttemptAt/id 排序，全清完不再選取。
- 舊版 detail/history 為 superseded/files=[]，保留原匯出人／時間／份數／名稱；prepare、直接 GET、Range 回 `ESIGN_EXPORT_SUPERSEDED` 409，不 redirect 新版。跨部門與錯文件先回 404，retry 舊版拒絕，不覆寫原歷史資料。
- 真 S3（Moto versioned bucket）：使用舊 ZIP 完整 objectVersion 刪除；注入刪後中斷後 HEAD 指定版本回 404。maintain 重入後 file=deleted，ListObjectVersions 不含舊版本且無 delete marker；同 key 的其他版本、個人 PDF、新版及新版 Range 下載均保留。

### 提交結果不明的恢復

唯讀 review 發現發布 COMMIT 成功、回覆卻中斷時，既有 catch 先刪 stored，可能刪掉已 active 的新版。以真 MySQL transaction 先提交、再於 DB 邊界丟錯重現 RED（新版 DB completed，但 stat ENOENT；`/tmp/spec030-ticket03-commit-red.log`）。改為先確認工作狀態，且只刪無 active/staging reference 的產物；參照查詢失敗時保留待 orphan sweep。GREEN 同時驗證正常查到 active 與參照查詢故障，新版仍可下載、不改 failed，舊版立即 409 且 maintain 接手實體清理；真正 rollback 測試仍保持舊版可下載。

### 自動驗證

- 最後一輪 `export-retention.e2e-spec.ts` + `esign-export.e2e-spec.ts` + `esign-export-history.e2e-spec.ts`：117/117 通過，含上述兩個提交結果不明案例（`/tmp/spec030-ticket03-all-e2e.log`）。
- `export-retention.e2e-spec.ts` + `esign-export-history.e2e-spec.ts`：107 tests 通過（`/tmp/spec030-ticket03-integration.log`）。
- 加強來源／他文件保護及精簡清理投影後，`export-retention.e2e-spec.ts` + `esign-export.e2e-spec.ts`：23 tests 通過（`/tmp/spec030-ticket03-final-e2e.log`）。既有並發案例仍會產生 Node MaxListeners 警告，未隱藏警告或改門檻。
- `PATH=/tmp/esign019-moto/bin:$PATH pnpm --config.verify-deps-before-run=false -C server test:s3:e2e --runTestsByPath test/s3-export.e2e-spec.ts`：5 tests 通過（`/tmp/spec030-ticket03-s3.log`）。
- 全 server unit：119 suites／1204 tests 通過（`/tmp/spec030-ticket03-unit.log`）；server build 通過。
- T022 的檔案狀態查詢集中於現有 ExportJobRepository，避免 file-object.repository 重複匯出業務邏輯；T025 的既有 history mapper 已對非 completed 回 files=[]，直接加入回歸證據即可。

保留文件期限 expired、共用 Excel/PDF expired，以及 expires_at/index/API；沒有 migration/config/dependency 變更。6,000 份容量驗證與最後部署交付文件仍屬整合票。測試 fault injection 僅施加於 storage／真 DB 邊界，產物讀取與實體刪除皆實際執行；本機日誌與瀏覽器截圖是暫存證據，非持久化 CI artifact。

### 舊畫面與歷史取代提示


- 真瀏覽器 seam：隔離 MySQL/Redis、synthetic employee session、真 API/worker/local storage、Next 3030 → API 3031；Chromium 153 / Playwright，未攔截或 mock 網路。
- Red：第一個 session 產生 1 份，第二個 session 更新 2 份後，舊畫面準備下載真實回 409，但 UI 未刷新；等待新版下載按鈕逾時。證據 `/tmp/spec030-ticket03-ui-red.log`。
- Green（panel）：收到 `ESIGN_EXPORT_SUPERSEDED` 後停用舊操作並刷新 preview/document/history，實際下載為 2 個 PDF。接續歷史舊畫面 409 未刷新形成第二個 red，證據 `/tmp/spec030-ticket03-ui-history-red.log`。
- Green（history）：歷史同樣重新查詢；舊列顯示「已被新版取代」，無下載／重試按鈕、不再標「處理中」。新版可下載，工作總數保持 2，沒有錯誤後自動打包。
- 執行：`AUTH_TRUSTED_ORIGINS=http://localhost:3030 CORS_ORIGIN=http://localhost:3030 pnpm --config.verify-deps-before-run=false -C server test:e2e --testRegex spec030-browser.e2e-spec.ts --runTestsByPath test/spec030-browser.e2e-spec.ts`，1/1 passed（11.647 秒）。Harness `/tmp/spec030-browser/ticket03-browser.e2e-spec.ts` 暫放 server/test 執行後已移除；可複製回重跑。
- 最終回歸 log `/tmp/spec030-ticket03-ui-regression.log`；截圖 `/tmp/spec030-browser/ticket03-refreshed.png`、`/tmp/spec030-browser/ticket03-history.png`。
- `pnpm --config.verify-deps-before-run=false -C client lint` 通過；前端 build 與整合驗證由 ticket 主流程統一執行。


### Ticket 03：直接讀到 superseded 的重新連線分支

- 已固定 pending 工作後讓第一個真瀏覽器 context 離線；第二個 session 完成原 1 份 ZIP 並明確更新至 2 份，第一個 context 重新連線後 GET 原工作為 superseded。未模擬 API response。
- Red：缺少「查看最新成果」入口，舊 requestedId 持續停留已取代畫面；`/tmp/spec030-ticket03-reconnect-red.log`。
- Green：專用提示提供「查看最新成果」，只清 requestedId／刷新摘要，沒有申請或重試 mutation；實際取得新 ZIP 的 2 個 PDF，工作總數保持 2。`/tmp/spec030-ticket03-reconnect-green.log`，1/1 passed（24.352 秒）；harness `/tmp/spec030-browser/ticket03-reconnect.e2e-spec.ts`，截圖 `/tmp/spec030-browser/ticket03-reconnected.png`。
- 共用刷新 handler 後再驗證先前 409 流程：開發環境一次出現整頁重新載入而未保留舊畫面，該輪逾時，未列成功。凍結 UI 後重跑，`/tmp/spec030-ticket03-ui-regression.log` 1/1 passed（11.808 秒），兩次真正 409、最新下載 2 個 PDF、歷史無舊下載且總工作仍 2。
- 最新 client lint 通過。Next 已停止，產生的 AGENTS block 已還原，暫時 server test harness 已移除；未新增 client 測試框架。

### Ticket 03 最後檢查

- root `pnpm lint` 通過（server 0 errors／310 warnings，包含測試中的 bind／既有 any 警告；client lint 通過），日誌 `/tmp/spec030-ticket03-final-lint.log`。
- Nest build、Next webpack build 通過（`/tmp/spec030-ticket03-final-build.log`、`/tmp/spec030-ticket03-client-build.log`）。工作區依賴仍為外部 symlink，預設 Turbopack root build 留待整合工作區執行；沒有提交 symlink、Next 生成 AGENTS 區塊或 browser 暫存 harness。

### Ticket 03 整合驗證

- Merger 核對 80d336f 相對 d741b5f 的發布、補清理、錯誤契約與 UI 差異，並比對 local 117/117、S3 5/5、409 舊頁及 reconnect 各 1/1 的實際日誌，fast-forward 整合成功。
- 原子發布失敗保留舊版；COMMIT 回覆不明不誤刪 active 新版；完整物件版本刪除、50 工作有界掃描／60 秒延後與參照保護均有針對性故障案例。清理不進入產製 failed catch。
- 未重複執行共享資料庫測試；整合狀態 commit 完整執行既有 lint/unit hooks。預設 root build 與 6,000 份容量依 ticket04 執行。

## Ticket 04：大量更新與整合交付（2026-11-06）

使用 `impl/030-04`，起點 f9f3312；隔離 MySQL／Redis／local storage，未連線 UAT 或操作正式資料。部署文件補入 client/API/worker 同版、停止新申請並排空舊 worker、修正版回復；目前部署腳本會自動回退 image，不會辨識 ZIP 新狀態，因此首次切換須受控操作，不能宣稱腳本已自動提供此保護。無 migration、環境變數或 dependency 變更。

### 大型快照 RED → GREEN

- 完整容量首兩輪 a/b 在 6,000 份 processing 期間新增簽署後重複 POST 回 500。縮小至真 DB `work()` 查詢（約 0.4 秒）確認 `ER_OUT_OF_SORTMEMORY`；CASE 排序即使只選摘要，仍使 MySQL filesort 搬動含數 MB JSON 的列。只換 ORDER BY id/LIMIT 在 failed 分支仍失敗。
- 新增公開 API 回歸：6,000 metadata 的較舊 processing 與較新 failed 並存，重複申請仍選 processing；全 failed 後選最新 failed，工作數保持 2。先 RED（500），改成聚合候選 ID 再依主鍵讀摘要後 GREEN；current 同樣採 MAX(id)，保留文件鎖及同交易。
- c 輪 1→6,000 已通過完整驗證，但延伸 6,000→6,001 在發布時 failed。最小查詢確認 `supersedeOlder` 全 entity ORDER BY 同樣耗盡 sort buffer；新增真 processor／DB 的大型歷史 metadata 發布與清理回歸先 RED 後 GREEN。候選只選 ID、應用程式固定數字順序，再逐筆鎖讀／確認 completed；沒有增加 DB sort buffer 或重試掩蓋錯誤。
- maintain 只投影候選 ID，接續原逐筆鎖讀；pendingCleanup 既有 ID 投影及 50 工作上限保留。故障測試只放大歷史 metadata，不能當成實際 6,000 PDF 容量證據；容量另以下述 d 輪完整重跑。
- 最終既有多版測試增加 maintain 前後所有歷史工作欄位相同、兩版實體檔案仍存在且 active；最新缺檔／缺 completedAt 仍不退回舊產物。未做 expired 相容或批次回填。

本機 RED／GREEN：`/tmp/spec030-ticket04-sort-{red,green}.log`、`/tmp/spec030-ticket04-publish-{red,green}.log`；容量失敗輪 `/tmp/spec030-capacity-run-{a,b,c}.log` 保留，未列為成功。

### SC-008 完整容量結果

d 輪使用新的 `feastogether_intranet_test_capacity_030d`／`/tmp/esign009-capacity-030d`。Apple M5 Pro／24 GiB／Node 26.4，開始前可用空間 626 GiB。真 Fastify HTTP/session、MySQL migration、Redis BullMQ、獨立 WorkerModule 與 local storage；不使用 Moto 大檔或記憶體 sink。

1. 真正先完成 1 份舊 ZIP，再加入至 6,000 份。查預覽缺 5,999，工作仍只有 1，沒有自動打包。
2. 明確申請更新固定 6,000，觀察到 processing 後加入第 6,001；再次 POST 仍為同 ID、6,000 份。完成後 work=null、缺 1、工作數 2，沒有自動續包。
3. 6,000 份來源 **6,244,040,250 bytes**，STORE ZIP **6,245,350,572 bytes**。Python 獨立逐筆驗檔名集合、重複名稱、bytes、CRC、完整 SHA-256 及 ZIP64，全部吻合，耗時 **2.729 秒**。
4. 真 HTTP 下載超過 8 MiB 後中斷，以 Range/If-Range 續傳並驗全檔 SHA/bytes。匿名下載 401，舊成果 Range 409。舊工作 superseded、舊檔 deleted 且實體不存在；6,001 個個人 PDF 保留。沒有手刪產品 ZIP。
5. 再明確更新到 6,001，產物 **6,245,368,097 bytes**，全部 6,001 entries CRC/SHA 與 ZIP64 通過（2.599 秒）；前一份 6.245 GB ZIP 由正式流程刪除，最新缺 0，最終工作數 3。這一步驗證大型舊快照的取代／清理，不只是小舊版。

| 6,000 份更新量測 | 本次值 |
| --- | ---: |
| POST 受理 latency | 346.09 ms |
| 受理至 observed completed | 12.714 s |
| observed processing 至 completed | 12.143 s |
| 獨立 worker peak RSS | 421.27 MiB |
| API＋fixture/orchestrator peak RSS | 421.67 MiB |

RSS 每 250 ms 取樣，只取 processing 至 completed 區間，包含 ts-node 成本，不等於 production compiled runtime sizing。24 種有效合成 PDF（文字向量、JPEG、PNG、混合，頁數與尺寸不同）各平衡重複 250 次、hardlink、熱 filesystem cache；不是 6,000 種獨特內容或 production 人資分布，也不是部署 S3 吞吐/SLO 保證。沒有宣稱簽署服務在此負載的 p95；新增簽署紀錄用隔離 fixture 寫入，簽署端驗權由既有 e2e 覆蓋。

持久證據：[結果](capacity-evidence/result.json)、[6,000 完整性](capacity-evidence/verify.json)、[6,001 完整性](capacity-evidence/verify-next.json)、[採樣](capacity-evidence/resources.json)、[來源 manifest](capacity-evidence/corpus-manifest.json)、[版本與 hash](capacity-evidence/provenance.json)。原始兩份 expected 名單、最終產物及日誌在 `/tmp/spec030-capacity-result-d`、`/tmp/spec030-capacity-run-d.log`。重跑入口是 `server/test/performance/esign-zip-refresh-benchmark.ts`，步驟見容量 README；不以舊 Spec009 首次匯出 benchmark 代替。

### 最終跨故事瀏覽器與邊界

- Chromium 153／真 Next 3030 → API 3031、合成員工 session、MySQL/Redis/worker/local storage，沒有攔截或 mock API 回應。新增整合場景：第二 session 更新時注入 worker storage 寫入故障；顯示失敗且仍能下載原 1 份 ZIP。再加入第 3 人，解除 storage 故障並重試，保留原工作 ID／snapshot hash／2 份範圍，下載實際只有 2 個 PDF，提示缺 1。
- 兩個 session 分別填「第一人下載」「第二人更新」，下載實際檔名各自正確，不新增工作。舊 panel 與 history 準備下載皆真正收到 409，重新取得最新資料；舊列顯示已取代且沒有下載／重試，總工作仍 2。
- 最終 1/1 passed（14.4 秒），`/tmp/spec030-ticket04-browser-final.log`；harness `/tmp/spec030-browser/ticket04-browser.e2e-spec.ts`，截圖 `ticket04-refreshed.png`／`ticket04-history.png`。前一輪 Next dev 自動重載未保留舊頁而逾時，下一輪時計凍結後未恢復導致刷新逾時，兩輪不列通過；最後僅關閉 HMR WebSocket、暫停舊頁時計以保留舊狀態，在真 409 後恢復，後端／另一 session 持續真實執行。
- 最新／過時／處理中／離頁返回及直接讀到 superseded 的 reconnect 沿用 Ticket 01–03 已通過的 browser 證據；本輪補跨故事失敗與名稱獨立，不重複無變更場景。
- 相關 e2e 覆蓋未登入、跨部門、錯文件／工作／檔案關聯、刪除文件、只投影數量不回傳快照或 objectKey；6,000 容量另外實際驗匿名 401 與舊 Range 409。文件 expired、共用非 ZIP expired、expiresAt/index/API 均保留。

### 最終命令與狀態

- `pnpm --config.verify-deps-before-run=false -C server test --runInBand`：119 suites／1204 tests 通過，`/tmp/spec030-ticket04-unit-final.log`。
- `pnpm --config.verify-deps-before-run=false -C server test:e2e --runTestsByPath test/esign-export.e2e-spec.ts test/esign-export-history.e2e-spec.ts test/export-retention.e2e-spec.ts`：3 suites／119 tests 通過，`/tmp/spec030-ticket04-e2e-final.log`。包含新增的兩項大型快照回歸、歷史無批次改寫，以及原提交結果不明、原子發布回滾與清理恢復案例。
- 全套第一輪新增的大歷史 metadata 留在共用測試 DB，使舊 normalize-export-retention 工具全表排序的 8 項測試失敗；新增 fixture finally 還原自己的 metadata／刪除純快照案例資料後全過。未修改舊 expired 工具、測試門檻或 DB sort buffer。該舊工具不屬於 030 部署步驟，本次沒有執行資料遷移。
- root `pnpm lint`：server 0 errors／310 warnings、client lint 通過，`/tmp/spec030-ticket04-root-lint-final.log`。並發 e2e 仍有既有 MaxListeners 警告，未隱藏警告或調門檻。
- Nest build 與 Next webpack build 通過，`/tmp/spec030-ticket04-server-build.log`、`/tmp/spec030-ticket04-client-build.log`。worktree 使用外部 node_modules symlink；預設 root `pnpm build` 由 merger 在整合工作區執行，T032 在該檢查前維持未完成，不把 webpack 結果冒稱 Turbopack 通過。
- 真瀏覽器、worker 已停止，暫存 server browser test 與 Next 自動 AGENTS 區塊已移除；不提交環境檔、symlink、Playwright dependency 或合成 PDF/ZIP 大檔。
- `PATH=/tmp/esign019-moto/bin:$PATH pnpm --config.verify-deps-before-run=false -C server test:s3`：9/9 通過（`/tmp/spec030-ticket04-storage.log`）。同前綴 `test:s3:e2e --runTestsByPath test/s3-export.e2e-spec.ts`：5/5 通過（`/tmp/spec030-ticket04-s3-e2e.log`），含指定 objectVersion 刪除與中斷恢復；Moto 只跑小量協定驗證，未拿來做 >4 GiB 容量。

### Ticket 04 整合驗證

- Merger 核對 4c415c85 相對 f9f3312 的差異與回歸／容量證據；provenance 的四份 source SHA-256 逐檔符合候選，兩份本機 expected 名單 hash 亦吻合。fast-forward 整合成功。
- 在真整合工作區執行原預設 `pnpm build`，Nest 與 Next Turbopack 均成功（未傳 webpack）；日誌 `/tmp/spec030-merge04-build.log`。AGENTS.md 無生成變更，原有未追蹤文件未修改。
- T032 完成，T001–T032 全部已驗收；四張 tickets 均已整合 resolved。整體 code-review 仍由主代理獨立執行，不將此合併核對冒稱最終雙軸 review。
- 狀態紀錄 commit 仍完整執行既有 lint/unit hooks，不重複已通過且沒有變更的共享資料庫測試。
