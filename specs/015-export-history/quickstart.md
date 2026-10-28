# Quickstart：歷史匯出紀錄驗收

## 自動化

```bash
pnpm -C server lint:check
pnpm -C server build
pnpm -C server test
pnpm -C server test:schema
pnpm -C server test:e2e
```

`test:schema` 與 `test:e2e` 需要隔離的 MySQL／Redis；測試 DB 名稱必須以 `feastogether_intranet_test` 開頭。

本 spec 只做後端，不執行 client 驗證。

## 驗收矩陣

| # | 情境 | 預期 |
|---|---|---|
| 1 | migration up 後執行 `schema:dump` | `schema.sql` 與 entity 一致；舊 ZIP 資料通過 CHECK |
| 2 | 已有 `excel`／`pdf` 紀錄時執行 migration down | 拋錯拒絕回退，資料不變 |
| 3 | 沒有新類型紀錄時執行 migration down | 欄位、索引、CHECK 移除，`created_by_user_id` 回到 NOT NULL |
| 4 | 寫入違反 CHECK 的資料（`excel` 沒有條件、`pdf` 沒有簽署人、ZIP 沒有匯出人） | DB 拒絕 |
| 5 | `GET /api/esign/history/export` 不帶 `type`、`type=sheet`、`pageSize=101`、`page=0` | 400 `INVALID_REQUEST` |
| 6 | 23 筆 `excel` 紀錄，`pageSize=10` 翻三頁 | 10／10／3 筆，不漏不重，`total=23` |
| 7 | 三類型各有資料，帶與不帶 `documentId` | `typeTotals` 與各類型逐頁合計相同 |
| 8 | 非建立人、非匯出人的員工查詢 | 看得到全部紀錄 |
| 9 | 未登入或只有外部存取 cookie | 查詢、記錄、重新下載都被拒，且不留紀錄 |
| 10 | 非建立人 `POST` Excel 紀錄到已發起文件 | 201，匯出人為目前使用者 |
| 11 | `POST` Excel 紀錄到草稿、已刪除或不存在的文件 | 404，不新增紀錄 |
| 12 | Excel body 帶未知欄位、未知狀態／欄位、`fields` 為空、`scope` 為 256 字、`count=-1`、`type=pdf` | 400，不新增紀錄 |
| 13 | 建立人 `POST …/completed-file/downloads` | 回 PDF；新增 `pdf` 紀錄，匯出人為建立人，範圍為該簽署人 |
| 14 | 外部簽署人 `POST /api/external-signing-task/completed-file/downloads` | 回 PDF；新增 `pdf` 紀錄，匯出人為「姓名＋Email」 |
| 15 | 內部員工以員工 session `POST /api/esign/signing-tasks/{id}/completed-file/downloads` | 回 PDF；新增 `pdf` 紀錄，匯出人為該員工（姓名＋員工編號） |
| 16 | 副本尚未產製完成或權限不符時下載 | 沿用原本錯誤，不新增紀錄 |
| 17 | 模擬紀錄寫入失敗 | 500，不回傳 PDF |
| 18 | 舊的三條 GET 下載與 `GET /api/esign/exports` | 404 |
| 19 | 任一員工對 `pdf` 紀錄 `POST …/{id}/downloads` | 回 PDF；新增一筆 `pdf` 紀錄，匯出人為目前使用者 |
| 20 | 對 `excel` 或 `zip` 紀錄 `POST …/{id}/downloads`；對 `pdf` 或 `zip` 紀錄 `GET …/{id}/document` | 404 |
| 21 | 任一員工對 `excel` 紀錄 `GET …/{id}/document` | 只回 contract 列出的欄位，不新增紀錄 |
| 22 | 申請、重用、重試與下載 ZIP | 行為與 Spec 009 相同；下載不新增紀錄；`zip` 只依匯出工作計數 |
| 23 | 存在 `excel`／`pdf` 紀錄時執行 ZIP worker 與維護掃描 | 新類型不被選中或更新 |

## 前端串接後（由前端工程師驗收）

1. 建立人在文件檢視頁下載某位簽署人的副本：成功下載，`GET /api/esign/history/export?type=pdf` 多一筆。
2. 外部簽署人在簽署完成頁按「下載已簽署文件」：成功下載，歷史多一筆，匯出人為外部簽署人。
3. 員工在「我的電子簽」下載本人副本：成功下載，歷史多一筆，匯出人為該員工。
4. 建立人匯出頁的 ZIP 面板：重新整理後帶回最近一次匯出，可產生、輪詢與下載。
5. 匯出頁下載 Excel：先回報紀錄再下載，歷史多一筆 `excel`。

## 驗證紀錄

### 01 schema（T001–T006，2026-10-28）

環境：Node v26.4.0、pnpm 11.9.0、MySQL／mysqldump 8.4.11（Homebrew）。基準為整合分支 `feat/015-export-history`（f974afe）。

測試隔離：
- e2e 使用 `DB_MYSQL_DB=feastogether_intranet_test_015_01`、`REDIS_DB=11`。
- `test:schema` 會在 DB 名稱後加 `_` 與 32 字元亂數；上述名稱加上後超過 MySQL 64 字元上限，因此改以環境變數 `DB_MYSQL_DB=feastogether_intranet_test1501` 執行，每個案例仍各自建立並刪除隨機測試庫。
- `pnpm -C server schema:dump` 讀 `.env`（開發庫），本次不碰開發庫：改用同一支腳本讀 `.env.test`，從已套用新 migration 的隔離庫匯出（`node --env-file=.env.test --conditions=development -r ts-node/register src/infrastructure/database/dump-schema.ts`）。

核對：root／server `AGENTS.md`、constitution（目前為 **2.0.0**，T001 寫的 1.5.0 已被 016 修訂；本票沒有牴觸）、migration 次序（新增於 `1792454405000-InternalEmailInvitations` 之後）。

| 指令 | 基準（變更前） | 變更後 |
|---|---|---|
| `pnpm -C server lint:check` | — | 0 errors（265 個既有 warnings，本次變更檔案 0 個） |
| `pnpm -C server build` | — | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／8 tests 通過 | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e test/esign-export.e2e-spec.ts`（ZIP） | 1 suite／4 tests 通過 | 1 suite／4 tests 通過 |
| `pnpm -C server test:e2e`（全套，額外回歸） | — | 27 suites／240 tests 通過 |

`test:schema` 新增案例：
- `schema-constraints`：`chk_esign_export_jobs_record_type` 的 8 個拒絕與 4 個接受案例；`fk_esign_export_jobs_signer` 拒絕不存在的簽署人與刪除被引用的簽署人，`DELETE_RULE=RESTRICT`；CHECK 清單加入新名稱。
- `schema-migration`：先停在 `InternalEmailInvitations` 寫入既有形狀的 ZIP 工作，up 後欄位、三個複合索引、外鍵與 CHECK 正確，既有單欄日期索引保留，ZIP 列仍可更新；down 還原到 up 前的結構（`created_by_user_id` 回到 NOT NULL）；再 up 結構相同。已有 `excel` 或 `pdf` 紀錄時 down 拋出「無法回滾」，資料與結構都不變。
- 「最新 migration 無 drift」案例同時驗證 entity 與 DB 一致。

`schema.sql` 由隔離庫重新匯出後，可載入空的測試庫（13 張表）。

### 02 查詢（T007–T013，2026-10-28）

環境：Node v26.4.0、pnpm 11.9.0。基準為整合分支 `feat/015-export-history`（e7ed918），實作分支 `impl/015-02`。

測試隔離：worktree 的 `server/.env.test` 改為 `DB_MYSQL_DB=feastogether_intranet_test1502`、`REDIS_DB=12`；`test:schema` 加上 33 字元亂數後仍在 MySQL 64 字元上限內。

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors（265 個既有 warnings，本次變更檔案 0 個） |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e --testRegex '(esign-export-history\|esign-export\|esign-document-delivery-security\|api-coverage)\.e2e-spec\.ts$'` | 4 suites／55 tests 通過：`esign-export-history` 14、`esign-export`（ZIP，不變）4、`esign-document-delivery-security` 3、`api-coverage` 34 |
| `pnpm -C server test:e2e`（全套，額外回歸） | 28 suites／255 tests 通過（01 合併後為 27／240；新增本檔 14 個與 api-coverage 1 個） |

驗收矩陣 #5–#8 與 #18 的 `GET /api/esign/exports` 已由 `esign-export-history`、`api-coverage` 自動化：
- 400 `INVALID_REQUEST`：缺 `type`、`type=sheet`、`page=0`、`pageSize=101`、`pageSize=0`、`documentId=abc`、`documentId=0`、未知參數。
- 23 筆 `excel`（每兩筆同一匯出時間，且越晚寫入的時間越早）以 `pageSize=10` 翻頁得 10／10／3／0，順序依匯出時間、流水號由新到舊，`total=23`。
- 帶 `documentId` 時 `typeTotals` 與逐頁合計相同；沒有紀錄的類型回 0；不帶 `documentId` 時與查詢前的基準相差本次寫入的筆數（測試庫不重建，以差值驗證）。
- 非建立人、非匯出人的員工看得到全部紀錄；未登入與外部存取 cookie（Redis 實際核發的憑證）回 401。
- `exportedBy`：員工取自員工資料（姓名、員工編號），本人下載的內部簽署人同樣取員工資料而非簽署人快照，外部簽署人本人下載為姓名＋Email。
- `zip` 只列有快照的匯出工作（沒有快照的舊 ZIP 列較新也不會出現），欄位與 ZIP 工作狀態相同，含 `files[].downloadPath`，不含 `requesterName`。
- Excel／PDF／ZIP 合成紀錄以 entity manager 直接寫入，`created_at` 以 SQL 固定；寫入 API 在 03、04 票單。

變異檢查：暫時拿掉 ZIP 快照條件、排序改為只依流水號、內部員工匯出人改取簽署人快照，新 e2e 有 5 個案例轉紅；還原後全綠。

Swagger：以 build 產物產生文件確認 `GET /api/esign/history/export` 的參數（`type` 必填 enum；`page`／`pageSize` 選填，預設 1／10，範圍 1–Number.MAX_SAFE_INTEGER／1–100；`documentId` pattern）、200／400／401 與回應 schema；`/api/esign/exports` 不在文件中。

### 03 Excel 紀錄（T014–T017、T026–T027，2026-10-28）

環境：Node v26.4.0、pnpm 11.9.0。基準為整合分支 `feat/015-export-history`（f08e454），實作分支 `impl/015-03`。

測試隔離：worktree 的 `server/.env.test` 改為 `DB_MYSQL_DB=feastogether_intranet_test1503`、`REDIS_DB=13`。

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors（265 個既有 warnings，本次變更檔案 0 個） |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e --testRegex '(esign-export-history\|esign-export\|api-coverage)\.e2e-spec\.ts$'` | 3 suites／79 tests 通過：`esign-export-history` 41（02 的 14 個＋本票 27 個）、`esign-export`（ZIP，不變）4、`api-coverage` 34 |
| `pnpm -C server test:e2e`（全套，額外回歸；mapper 有共用重構） | 28 suites／282 tests 通過（02 合併後為 28／255，新增本票 27 個） |

驗收矩陣 #9–#12、#20（`GET …/{id}/document` 部分）、#21 已由 `esign-export-history` 的「Excel 紀錄」區塊自動化，使用本區塊自建的文件與簽署人：
- 非建立人 `POST /api/esign/history/export` 回 201，item 與查詢結果相同，匯出人為 session 員工。
- 草稿、已刪除（已發起但標記刪除）、不存在的文件回 404 `ESIGN_RESOURCE_NOT_FOUND`。
- 400 `INVALID_REQUEST`（19 案）：未知欄位（前端傳入匯出人）、`conditions` 內的未知欄位、缺 `conditions`、`conditions` 為陣列、未知狀態、未知欄位鍵、`fields` 為空、重複的欄位鍵、`depts` 501 個、部門鍵 256 字、部門鍵為空字串、`scope` trim 後為空、`scope` 256 字、`count` 為 -1／1.5／字串、`type` 為 `pdf`／`zip`、`documentId` 格式錯誤。
- 邊界值可記錄：`scope` 前後空白 trim 後 255 字、`count=0`、500 個 255 字部門鍵、全部狀態與欄位。
- 缺 Origin 回 403 `CSRF_ORIGIN_REJECTED`；未登入與外部存取 cookie 回 401。
- 以上每個失敗案例都比對 `esign_export_jobs` 總筆數，確認沒有新增紀錄。
- 其他員工 `GET /api/esign/history/export/{id}/document`：回文件目前資料，`toEqual` 精確比對只有 contract 列出的欄位（含重新開放的 `originalSignEndAt`／`isReopened`、建立人、依排序的簽署人；已移除的簽署人不列出），不含簽署人 `publicId`、管理備註、通知結果與驗證網址；不新增紀錄。
- `pdf`、`zip` 紀錄、不存在的 UUID、非 UUID、文件已刪除的 `excel` 紀錄回 404；未登入與外部存取 cookie 回 401。

紅燈：成功記錄與三個重新下載資料案例在路由實作前失敗（404）。404、400、Origin 案例在 POST 實作後才補，改以變異檢查確認會失敗：拿掉草稿檢查（1 案轉紅）、拿掉 `ArrayMaxSize`／`IsObject`／`ArrayUnique`／部門鍵長度與 `Min(0)`（7 案轉紅）、拿掉 `OriginGuard`（1 案轉紅）、拿掉重新下載的 `excel` 類型檢查（1 案轉紅）；還原後全綠。

Swagger：以 build 產物產生文件確認 `POST /api/esign/history/export`（201／400／401／403／404，body 為 `CreateExcelExportRecordDto`：`type` enum `excel`、`documentId` pattern、`scope` 1–255、`count` ≥ 0、`conditions` 的 enum、`uniqueItems`、`minItems`／`maxItems` 與部門鍵長度）與 `GET /api/esign/history/export/{id}/document`（200／401／404，回應 `ExcelExportDocumentDto`，簽署人 schema 只有 contract 列出的 10 個欄位）。

### 04 PDF 下載紀錄（T018–T025，2026-10-29）

環境：Node v26.4.0、pnpm 11.9.0。基準為整合分支 `feat/015-export-history`（f08e454），實作分支 `impl/015-04`。

測試隔離：worktree 的 `server/.env.test` 改為 `DB_MYSQL_DB=feastogether_intranet_test1504`、`REDIS_DB=14`。第一次跑 `core-esign-flow` 時 afterAll 因新紀錄的外鍵中斷、留下殘留資料，已刪除這個由本票建立的隔離庫，由 e2e global setup 重建後重跑。

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors（265 個既有 warnings，總數不變） |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e --testRegex '(core-esign-flow\|internal-email-copy\|internal-email-signing\|internal-portal-completion\|esign-rejection\|esign-document-delivery-security\|api-coverage\|esign-export-history\|esign-export)\.e2e-spec\.ts$'` | 9 suites／134 tests 通過（`esign-export-history` 44＝02 的 14＋本票 30；`api-coverage` 35） |
| `pnpm -C server test:e2e:security`（含 `security-core-esign-flow`） | 11 suites／60 tests 通過 |
| `pnpm -C server test:e2e`（全套，額外回歸） | 28 suites／286 tests 通過（02 合併後為 28／255，新增本票 31 個） |

驗收矩陣 #13–#19 與 #20（`POST …/{id}/downloads` 部分）已由 `esign-export-history` 的「單人 PDF 下載紀錄」區塊自動化，使用本區塊自建的文件：已簽且副本已產製的內部／外部簽署人（證據與檔案摘要一致，經真實的副本讀取與完整性驗證）、未簽的內部／外部簽署人，以及既有的 `pdf`／`excel`／`zip` 紀錄。
- 建立人、內部員工本人（員工 session）、外部簽署人本人（存取 cookie）各下載一次：回 200，`Content-Type: application/pdf`、`Content-Disposition: attachment; filename="completed.pdf"; filename*=UTF-8''…`（文件編號＿文件名稱＿簽署人姓名）、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`，內容與存入的副本 bytes 相同；歷史多一筆，匯出人分別為建立人、該員工（姓名＋員工編號）、外部簽署人（姓名＋Email，`employeeNo` 為 null，即 `created_by_user_id` 為 NULL），範圍為簽署人標籤。
- 簽署人標籤超過 255 字時截斷為 255 字。
- 任何員工（非建立人、非原匯出人）從 `pdf` 紀錄重新下載：回同一份 PDF，新紀錄的文件、簽署人與範圍沿用原紀錄（以自訂範圍說明驗證不是重新計算），匯出人為目前使用者。
- 不新增紀錄的錯誤（21 案）：非建立人 404、建立人下載未簽者 409、其他員工以本人路由 404、本人未簽 409、外部簽署人未簽 401、外部存取失效 401、未登入 401（建立人／本人／重新下載）、外部存取 cookie 呼叫本人路由與重新下載 401、沒有外部存取 cookie 401、四條路由缺 Origin 403、重新下載 `excel`／`zip`／不存在／非 UUID 的紀錄 404、副本未產生的 `pdf` 紀錄 409。
- 四條路由在紀錄寫入失敗時（spy 讓 `ExportJobRepository.save` 拋錯）回 500 JSON，沒有 `Content-Disposition`，也沒有新增紀錄。
- 舊的三條 GET 回 404，新 POST 未登入回 401（`api-coverage`；`specs/003-core-esign-flow/contracts/openapi.yaml` 的兩條下載改為 POST 子資源，api-coverage 依此驗證 session gate）。
- 既有 e2e 改用 POST（帶 Origin）：`core-esign-flow`、`internal-email-copy`、`internal-email-signing`、`internal-portal-completion`、`esign-rejection`、`esign-document-delivery-security`、`security-core-esign-flow`、`api-coverage`；`core-esign-flow` 的 afterAll 另外清除本 suite 文件的匯出紀錄（新紀錄以 RESTRICT 外鍵引用文件與簽署人）。

紅燈：建立人、本人、外部、重新下載四個成功案例在路由實作前都因 404 失敗。錯誤、截斷與寫入失敗案例在路由完成後才補，改以變異檢查確認會失敗：建立人路由改為先記錄再檢查副本（1 案轉紅）、拿掉標籤截斷（1 案轉紅）、重新下載改為重新計算範圍（1 案轉紅）；還原後全綠。拿掉重新下載的 `pdf` 類型條件不會轉紅：`excel`／`zip` 紀錄依 DB CHECK 沒有 `signer_id`，仍回 404，類型條件保留為明確檢查。

Swagger：以 build 產物產生文件確認四條 `POST …/downloads` 都是 200 `application/pdf`（binary），重新下載另列 401／403／404／409／500；三條舊 GET 不在文件中；外部下載說明已改為「以 POST 取得 blob 後下載」。

合併整合分支（含 03，c922db8）後重跑：`lint:check` 0 errors（265 warnings）、`build` 通過、`test` 106／964、`test:schema` 2／12、全套 `test:e2e` 28 suites／313 tests（`esign-export-history` 71＝02 的 14＋03 的 27＋04 的 30）、`test:e2e:security` 11／60，全部通過。重新下載改用 03 的 `ExportJobRepository.historyRecord`，移除重複的查詢方法。

### 05 回歸驗證與交接（T028–T030，2026-10-29）

環境：Node v26.4.0、pnpm 11.9.0。基準為整合分支 `feat/015-export-history`（cce0dc9），實作分支 `impl/015-05`。

測試隔離：worktree 的 `server/.env.test` 改為 `DB_MYSQL_DB=feastogether_intranet_test1505`、`REDIS_DB=15`。

第一次全套（變更前）：

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors（265 個既有 warnings） |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e` | 28 suites／313 tests，1 個失敗（見下方） |
| `pnpm -C server test:e2e:security` | 11 suites／60 tests 通過 |

失敗的是 `core-esign-flow`「10 人共用 3 欄位各產一份 PDF，先簽先下載、跨人拒絕、全 ready 才結案」：
- 錯誤：兩個 finalization 並行時，`EsignVerificationService.saveSnapshot` 回報 `ESIGN_INTEGRITY_FAILED`。
- 單獨重跑 `core-esign-flow`（含 `security-core-esign-flow`）2 suites／38 tests 通過，第二次全套也通過。
- Spec 015 沒有修改 finalization 與 verification，研判是既有的並行時序問題，未在本票處理。

新增 #22、#23 案例後重跑全套：

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors（265 個既有 warnings，本次變更檔案 0 個） |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e` | 28 suites／314 tests 通過（`esign-export-history` 72＝02 的 14＋03 的 27＋04 的 30＋本票 1） |
| `pnpm -C server test:e2e:security` | 11 suites／60 tests 通過 |

`schema.sql` 核對（#1）：以同一支 dump 腳本讀 `.env.test`，從已由 e2e global setup 套用全部 migration 的隔離庫匯出。結果與提交的 `schema.sql` 無差異，`doc/esign-db-schema.sql` 與它相同。

#### 驗收矩陣對照

`esign-export-history` 指 `server/test/esign-export-history.e2e-spec.ts`。

| # | 自動化測試 |
|---|---|
| 1 | `schema-migration`「匯出紀錄 migration 保留既有 ZIP 工作，可 up → down → up」（既有 ZIP 列 up 後通過 CHECK）、「最新 migration 可 apply → 無 drift → 單獨 revert → reapply」（entity 與 DB 一致）；`schema-metadata.spec.ts`；`schema.sql` 由本票以 dump 核對（見上） |
| 2 | `schema-migration`「已有 excel／pdf 紀錄時，匯出紀錄 migration 在任何 DDL 前拒絕回滾」 |
| 3 | `schema-migration`「匯出紀錄 migration 保留既有 ZIP 工作，可 up → down → up」 |
| 4 | `schema-constraints`「匯出紀錄依類型限制匯出人、簽署人與條件，簽署人外鍵為 RESTRICT」 |
| 5 | `esign-export-history`「查詢紀錄 › … 回 400 INVALID_REQUEST」（8 案） |
| 6 | `esign-export-history`「查詢紀錄 › 依匯出時間、流水號由新到舊以頁碼翻頁，不漏不重」 |
| 7 | `esign-export-history`「查詢紀錄 › typeTotals 帶與不帶 documentId 都正確，並與逐頁合計一致」 |
| 8 | `esign-export-history`「查詢紀錄 › 非建立人、非匯出人也看得到 excel 紀錄與匯出條件」，查詢案例都以非建立人、非匯出人的員工查詢 |
| 9 | `esign-export-history` 四處：「查詢紀錄 › 未登入與外部存取 cookie 回 401」、「Excel 紀錄 › 未登入與外部存取 cookie 回 401，不新增紀錄」、「單人 PDF 下載紀錄 › 未登入重新下載／外部存取 cookie 重新下載」、「Excel 重新下載資料 › 未登入與外部存取 cookie 回 401」；`api-coverage`「匯出歷程改由 history/export 提供，舊路由不再提供存取」 |
| 10 | `esign-export-history`「Excel 紀錄 › 非建立人可記錄，匯出人取自 session，回 201 與查詢相同的 item」 |
| 11 | `esign-export-history`「Excel 紀錄 › 文件為草稿、已刪除或不存在時回 404，不新增紀錄」 |
| 12 | `esign-export-history`「Excel 紀錄 › … 回 400 INVALID_REQUEST，不新增紀錄」（19 案）與「邊界值可記錄」 |
| 13 | `esign-export-history`「單人 PDF 下載紀錄 › 建立人下載簽署人副本…」、「簽署人標籤超過 255 字時截斷」 |
| 14 | `esign-export-history`「單人 PDF 下載紀錄 › 外部簽署人以 Email OTP 存取下載本人副本：匯出人為姓名＋Email」 |
| 15 | `esign-export-history`「單人 PDF 下載紀錄 › 內部員工以員工 session 下載本人副本：匯出人與範圍都是該員工」 |
| 16 | `esign-export-history`「單人 PDF 下載紀錄 › …：回 … ，不新增紀錄」（21 案） |
| 17 | `esign-export-history`「單人 PDF 下載紀錄 › …：紀錄寫入失敗回 500，不送出 PDF」（4 條路由） |
| 18 | `api-coverage`「匯出歷程改由 history/export 提供，舊路由不再提供存取」（`/exports` 與三條舊 GET 都回 404） |
| 19 | `esign-export-history`「單人 PDF 下載紀錄 › 任何員工都能從 pdf 紀錄重新下載…」 |
| 20 | `esign-export-history` 三處：「單人 PDF 下載紀錄 › 重新下載 excel／zip 紀錄」、「Excel 重新下載資料 › pdf／zip 紀錄、不存在的紀錄與文件已刪除時回 404」，以及本票新增案例（以真實 ZIP 工作呼叫 `POST …/{id}/downloads` 與 `GET …/{id}/document`） |
| 21 | `esign-export-history`「Excel 重新下載資料 › 任何員工可取得文件目前資料，只含產生 Excel 需要的欄位，不新增紀錄」 |
| 22 | `esign-export`（Spec 009 的 4 案，不變）；`esign-export-history`「查詢紀錄 › zip 只列有快照的匯出工作…」；本票新增「ZIP 不受 excel／pdf 紀錄影響 › …」 |
| 23 | 本票新增「ZIP 不受 excel／pdf 紀錄影響 › …」 |

全部 23 列都有自動化測試。另外，SC-001 由 #10、#13–#15、#19（每次各多一筆）與 #22（重用、下載不新增）涵蓋；SC-003 由 #6、#7 涵蓋；SC-004 由 #9 涵蓋；SC-002 的前端部分待前端串接。

#### #22、#23 新增案例

`esign-export-history` 新增 describe「ZIP 不受 excel／pdf 紀錄影響」。為了讓兩個 describe 共用，把 `signedCopy` 與可簽署文件的建立提到最外層。

案例在同一份文件上放四筆新類型紀錄：
- 經 API 寫入的 `excel` 紀錄（`POST /api/esign/history/export`）。
- 經 API 寫入的 `pdf` 紀錄（建立人下載）。
- 兩筆「看起來像待處理 ZIP 工作」的紀錄：`excel` 為 `pending`，`pdf` 為 `processing` 且租約已過期，但都沒有快照。這兩筆在案例結束時刪除。

接著驗證：
- 申請 ZIP 回 202 並建立新工作，`expectedCount` 只計已簽副本，不會重用新類型的列。
- 來源副本暫時移除時，worker 讓工作失敗（`ESIGN_EXPORT_UNAVAILABLE`）。
- ZIP 的明細與重試路由對 `excel`／`pdf` 紀錄回 404。
- 還原來源後重試回 202，worker 完成工作。
- 下載 ZIP 回 200，`typeTotals` 維持 `{ excel: 2, pdf: 2, zip: 1 }`，下載不新增紀錄。
- 再次申請回 200，重用同一個工作。
- 歷史的重新下載與 Excel 資料路由對 ZIP 工作回 404。
- 執行 `DocumentExportProcessor.maintain()` 後，四筆新類型紀錄整列與 ZIP 流程前完全相同，`typeTotals` 不變。

變異檢查：以下三種改動都讓案例轉紅，還原後全綠。
- 拿掉 `ExportJobRepository.maintenance()` 的快照條件：租約過期的 `pdf` 列被改為 `pending`。
- 拿掉 `reusable()` 的類型與快照條件：申請重用了 `excel` 列。
- 拿掉 `EsignExportService.find()` 的快照檢查：明細路由對 `excel` 列回 200。

#### 契約對照與交接（T029、T030）

- 路由、狀態碼、body 規則與回應形狀都與 contract 一致。
- 契約範例值的差異、前端部門鍵／`scope` 長度的衝突，以及契約未明定的行為，都整理在 [implementation-notes.md](implementation-notes.md)「與契約的差異／未明定行為」，等待使用者決定，沒有修改契約語意。
- contract「前端交接」改正與程式不符的描述，並補上 ZIP 面板型別、mock store 的其他引用、`buildExportXlsx` 型別與長度上限的注意事項：
  - 下載路徑多了 `/downloads`；
  - `getBlob` 只會發 GET；
  - ZIP 查詢必須帶 `type=zip`。
- `docs/agents/電子簽串接待辦清單.md` 的「匯出紀錄」改為後端已完成、待前端串接。
