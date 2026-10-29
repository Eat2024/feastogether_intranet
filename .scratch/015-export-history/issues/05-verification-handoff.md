# 05: 回歸驗證與前端交接

**What to build:** 完整回歸、核對 ZIP 不受影響、對照契約，並把後端成果交給前端工程師。

**Blocked by:** 03、04

**Status:** resolved

**Spec:** 015 — SC-001～004、quickstart 驗收矩陣；對應 T028–T030。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [x] `pnpm -C server lint:check`、`build`、`test`、`test:schema`、`test:e2e` 通過，結果記入 quickstart「驗證紀錄」。
- [x] quickstart #22、#23：ZIP 申請、重用、重試、下載與 worker／維護掃描不受 `excel`／`pdf` 紀錄影響。
- [x] 實作與 `contracts/export-history-http-api.md` 一致；有差異時先回報使用者再更新。
- [x] `docs/agents/電子簽串接待辦清單.md` 的「匯出紀錄」改為後端已完成、待前端串接；新增 `specs/015-export-history/implementation-notes.md`。
- [x] 交接內容明列：必須跟後端一起部署的四處（ZIP 面板、檢視頁下載、「我的電子簽」本人副本下載、外部簽署完成頁下載）、歷史頁、Excel 回報與重新下載流程。不得描述歷史頁或前端已完成。

## 實作紀錄（2026-10-29，分支 `impl/015-05`，基準 `feat/015-export-history` cce0dc9）

狀態維持 `claimed`；合併至整合分支後改 `resolved`。

### 變更（只有 server 測試與文件，沒有 migration、client、正式程式碼）
- `server/test/esign-export-history.e2e-spec.ts`：
  - 新增 describe「ZIP 不受 excel／pdf 紀錄影響」（1 案），涵蓋 quickstart #22、#23，並以真實 ZIP 工作補強 #20。
  - 把 `signedCopy` 與可簽署文件的建立提到最外層，與「單人 PDF 下載紀錄」共用。`signedCopy` 改為接收文件，並回傳來源檔的 `objectKey`。
- `specs/015-export-history/implementation-notes.md`（新增）：
  - 交付摘要：Server、Migration／Config、Client、驗證。
  - 「與契約的差異／未明定行為」。
  - 已知限制與風險。
- `specs/015-export-history/contracts/export-history-http-api.md`：只改「前端交接」，改正與程式不符的描述並補上注意事項，沒有改 API 語意：
  - 下載路徑多了 `/downloads`；
  - `getBlob` 只會發 GET；
  - ZIP 查詢必須帶 `type=zip`，並換掉舊型別；
  - mock store 的其他引用；
  - `buildExportXlsx` 的型別；
  - `scope`／部門鍵長度。
- `docs/agents/電子簽串接待辦清單.md`：「匯出紀錄（歷史匯出文件頁）」改為後端已完成、待前端串接，並註明必須一起部署。
- `specs/015-export-history/quickstart.md`：「驗證紀錄 › 05」，含矩陣 #1–#23 與測試的對照。
- `specs/015-export-history/tasks.md`：勾選 T028–T030，`Status` 改為 30／30。

### 驗證
詳見 quickstart「驗證紀錄 › 05」。隔離環境為 `feastogether_intranet_test1505`、`REDIS_DB=15`。
- `lint:check`：0 errors（265 個既有 warnings，本次變更檔案 0 個）。
- `build`：通過。
- `test`：106 suites／964 tests。
- `test:schema`：2 suites／12 tests。
- 全套 `test:e2e`：28 suites／314 tests。
  - 第一次全套（變更前）`core-esign-flow` 有 1 案偶發失敗：finalization 並行時的完整性錯誤，與 015 無關。單獨重跑與第二次全套都通過。
- `test:e2e:security`：11 suites／60 tests。
- `schema.sql`：從隔離庫重新 dump，沒有差異。
- 變異檢查：以下三種改動各自讓新案例轉紅，還原後全綠。
  - 拿掉 `maintenance()` 的快照條件；
  - 拿掉 `reusable()` 的類型與快照條件；
  - 拿掉 `find()` 的快照檢查。

### 待使用者決定（已回報，未改契約）
- `conditions.depts` 每個鍵 255 字的上限，與前端部門鍵格式（`d:`＋`encodeURIComponent`，部門快照最長 150 字）衝突。
- 前端 `describeScope` 可能超過 `scope` 的 255 字上限：契約本身明確，前端需要縮短說明。
- 契約 ZIP 範例的 `scope` 值與實際不同。
- 匯出員工帳號被軟刪除時，查詢會 500 或顯示錯誤的匯出人：潛在問題，目前沒有程式路徑會觸發。

## 整合驗收紀錄（2026-10-29，`feat/015-export-history`）

- 審查 `impl/015-05`（9399bf3，基準為整合分支 cce0dc9）：
  - 只改 server 測試與文件，沒有 `server/src`、client 或 migration 變更。
  - 新案例「ZIP 不受 excel／pdf 紀錄影響」在同一文件放兩筆經 API 寫入的 `excel`／`pdf` 紀錄，加兩筆沒有快照、狀態像待處理 ZIP 工作的列（結束時刪除）；涵蓋 ZIP 申請、失敗後重試、下載、重用、明細與重試路由對新類型回 404、歷史路由對 ZIP 工作回 404，以及 `maintain()` 後新類型列整列不變。worker 以 `NestFactory.createApplicationContext(WorkerModule)` 啟動並在 `finally` 關閉，與既有 e2e 寫法相同。
  - `signedCopy` 與 `createSignableDocument` 提到最外層，只多了文件參數與回傳 `objectKey`，「單人 PDF 下載紀錄」的行為不變。
  - contract 只改「前端交接」一節（檔案最後一節，前面各節沒有變動），內容與 client 現況相符：`getBlob` 只發 GET、三個 `*_COMPLETED_FILE` endpoint、`features/forms/actions.ts` 與 `/forms/[id]/export/file` 引用 mock store、`(main)/layout.tsx` 與 SideNav 的 `adminOnly`、`pageSize` 1–100 預設 10。沒有描述歷史頁或前端已完成。
  - 待辦清單、implementation-notes、quickstart 驗收矩陣與 tasks（30／30）都符合本票驗收條件。
- 合併：`git merge --no-ff impl/015-05`，merge commit `8473fd25309041080c04d75ae549b951b467178b`，無衝突。
- 在合併後的工作樹以環境變數 `DB_MYSQL_DB=feastogether_intranet_test15m`、`REDIS_DB=10` 隔離執行：

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors；265 warnings，總數與 04 合併後相同 |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e`（全套） | 28 suites／314 tests 通過（`core-esign-flow` 偶發失敗本次未出現） |
| `pnpm -C server test:e2e:security` | 11 suites／60 tests 通過 |

狀態改為 `resolved`。

## Code review 修正整合紀錄（2026-10-29，`feat/015-export-history`）

- 審查 `impl/015-review-fixes`（75f10e9，基準為整合分支 d2abcea）：
  - 下載流程移入 `EsignExportHistoryService`：`downloadCreatorCopy`／`downloadOwnCopy`／`downloadExternalCopy`／`redownloadPdf` 都經 `recordPdf`，先寫紀錄再回傳檔案；寫入失敗拋錯，controller 不送出檔案（500）。權限與未產生的錯誤沿用原定義且不記錄：建立人路由仍回「完成文件尚未產生」，本人、外部與重新下載回「個人副本尚未產生」，e2e 已補訊息比對。
  - 四條 `POST …/downloads` 改用 `CompletedPdfDownload()`：`OriginGuard`、200、`application/pdf` binary、`Cache-Control: private, no-store`、`nosniff`，與原本逐一宣告的設定相同。
  - `exportedBy` 改依 `created_by_user_id` 是否為 NULL 判斷；查詢加 `withDeleted()`，已刪除文件仍由 join 條件 `document.deletedAt IS NULL` 排除。單筆查詢 `historyRecord` 加上類型條件，取代 service 的類型比對。
  - `conditions.depts` 每個鍵 1–1,000 字（最多 500 個）；`scope` trim 後 1–2,000 字，超過 255 字依字元存成前 254 字加「…」。`conditions_json` 為 JSON 欄位，`scope_description` 長度不變，沒有 migration。
  - contract 只改上述兩個上限、回應 `scope` 為儲存值、ZIP 範例 `scope` 文字與前端交接的長度說明；spec 與 data-model 記錄同樣的使用者決定。沒有 client 或 migration 變更。
  - 備註（未處理）：Fastify 預設 body 上限 1 MB。500 個 1,000 字的部門鍵若全是中文，body 會超過上限回 413；前端部門鍵是 `encodeURIComponent` 的 ASCII，500 個 1,000 字約 0.5 MB，不受影響。
- 合併：`git merge --no-ff impl/015-review-fixes`，merge commit `f5e40fc4ff3b679bd2070666b2c4f42053f48e1d`，無衝突（合併後樹與 75f10e9 相同）。
- 在合併後的工作樹以環境變數 `DB_MYSQL_DB=feastogether_intranet_test15m`、`REDIS_DB=10` 隔離執行（UTC 00:50 前後）：

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors；265 warnings，總數不變 |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e`（全套） | 28 suites／318 tests，316 通過、2 失敗（Spec 016 `internal-group-reminders`，見下方） |
| `pnpm -C server test:e2e:security` | 11 suites／60 tests 通過 |

- 2 個失敗是「同日受理阻擋重複催簽，台北跨日後可再群寄…」與「跨午夜重試只寄本批暫時拒收地址…」，建立文件時回 401（假時鐘超過真實 session 期限，UTC 00:00–08:00 執行時發生）。在 d2abcea 的暫時 worktree 單獨執行該 suite，同樣是這 2 個失敗（8 tests，6 通過）。與 Spec 015 無關。
- 已知的 `core-esign-flow` 並行 flake 本次沒有出現。

狀態維持 `resolved`。
