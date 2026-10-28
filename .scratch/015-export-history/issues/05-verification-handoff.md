# 05: 回歸驗證與前端交接

**What to build:** 完整回歸、核對 ZIP 不受影響、對照契約，並把後端成果交給前端工程師。

**Blocked by:** 03、04

**Status:** claimed

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
