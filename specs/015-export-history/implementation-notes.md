# Spec 015 實作紀錄

> 交付邊界：只有 server、migration 與契約文件。client 沒有修改，歷史匯出文件頁（`/export-history`）仍是 mock，前端串接依 [contract「前端交接」](contracts/export-history-http-api.md#前端交接) 由前端工程師處理。

各票的變更、驗證與合併紀錄在 `.scratch/015-export-history/issues/01`～`05`；指令結果與驗收矩陣對照在 [quickstart「驗證紀錄」](quickstart.md#驗證紀錄)。

## 交付摘要

### Server

- 新增 `GET /api/esign/history/export`：依類型（`excel`／`pdf`／`zip`）以頁碼查詢所有人的匯出紀錄，回 `total` 與 `typeTotals`。API `type` 與 DB `export_type` 的對應只在 `EXPORT_TYPE_COLUMN`（`esign-export-job.entity.ts`）。
- 新增 `POST /api/esign/history/export`：前端回報 Excel 匯出，匯出人取自 session，回 201 與查詢相同的 item。
- 新增 `GET /api/esign/history/export/{id}/document`：Excel 重新下載用的窄文件資料，唯讀。
- 單人 PDF 下載改為四條 POST 子資源，在送出 PDF 的同一請求寫入 `pdf` 紀錄，寫入失敗回 500 且不送出檔案：
  - 建立人：`POST /api/esign/documents/{documentId}/signers/{signerPublicId}/completed-file/downloads`
  - 員工本人：`POST /api/esign/signing-tasks/{signerPublicId}/completed-file/downloads`
  - 外部簽署人本人：`POST /api/external-signing-task/completed-file/downloads`
  - 從紀錄重新下載：`POST /api/esign/history/export/{id}/downloads`
- 移除 `GET /api/esign/exports` 與三條 `GET …/completed-file`，一律回 404。
- ZIP 申請、重用、重試、下載與 worker 行為不變（Spec 009）；ZIP 下載不記錄。

### Migration／Config

- Migration `1792454406000-ExportHistory`：
  - `esign_export_jobs.created_by_user_id` 改為可 NULL。
  - 新增 `signer_id`（外鍵 RESTRICT）、`conditions_json`。
  - 新增三個以日期結尾的複合索引，以及類型 CHECK `chk_esign_export_jobs_record_type`。
  - 已有 `excel`／`pdf` 紀錄時 `down` 在任何 DDL 前拒絕回退。
- `schema.sql` 與 `doc/esign-db-schema.sql` 已同步。本票再從已套用 migration 的隔離測試庫匯出一次，與提交的檔案沒有差異。
- 沒有新增環境變數、dependency、排程或 DB table。
- `specs/003-core-esign-flow/contracts/openapi.yaml` 的兩條下載路徑改為 POST 子資源（`api-coverage` 依此驗證 session gate）。

### Client

沒有修改。

### 驗證（2026-10-29，ticket 05）

- 隔離環境：`DB_MYSQL_DB=feastogether_intranet_test1505`、`REDIS_DB=15`。
- `lint:check`：0 errors／265 warnings，全部是既有警告。
- `build` 通過。
- `test`：106 suites／964 tests。
- `test:schema`：2 suites／12 tests。
- 全套 `test:e2e`：28 suites／314 tests。
- `test:e2e:security`：11 suites／60 tests。
- 驗收矩陣 #1–#23 都有自動化測試。#22、#23 由本票新增的案例補齊，以變異檢查確認案例有效。詳見 quickstart。

## Code review 修正（2026-10-29）

分支 `impl/015-review-fixes`，基準為整合分支 `feat/015-export-history`（d2abcea）。只改 server 與文件，client 沒有修改。

### 行為變更（契約已更新）

- `conditions.depts` 每個鍵 1–1,000 字（原 255），陣列仍最多 500 個。
- `scope` 接受 trim 後 1–2,000 字（原 255）；超過 255 字時依字元存成前 254 字加「…」，回應與查詢回傳儲存的值。PDF 簽署人標籤維持原本的截斷方式（不加「…」），兩者共用同一個依字元截斷的函式。
- `exportedBy` 依 data-model 以 `created_by_user_id` 是否為 NULL 判斷，不再看員工 join 有沒有資料。
- 歷史查詢關閉 TypeORM join 的自動軟刪除條件（`withDeleted()`），已軟刪除的匯出員工與簽署人照常顯示；已刪除的文件仍以明確條件排除。原本匯出員工被軟刪除時，`excel`／`zip` 整頁回 500、`pdf` 把簽署人顯示成匯出人，現已修正（e2e 以 excel 與 pdf 驗證）。

### 重構（行為不變）

- 三條本人／建立人副本下載的「檢查副本 → 寫紀錄 → 回傳檔案」移到 `EsignExportHistoryService`（`downloadCreatorCopy`、`downloadOwnCopy`、`downloadExternalCopy`，與 `redownloadPdf` 同形），controller 只呼叫一個方法並送出回應。紀錄仍在送出前寫入；寫入失敗回 500 不送 PDF；副本未產生或權限不符沿用原錯誤且不記錄（建立人 `ESIGN_COMPLETED_DOCUMENT_NOT_READY`，其餘 `ESIGN_PERSONAL_COPY_NOT_READY`，e2e 補上訊息比對）。
- 四條 PDF 下載路由的 `OriginGuard`、`ApiProduces`、binary 回應、`HttpCode(200)` 與兩個標頭收斂為 `CompletedPdfDownload()`（`helpers/completed-pdf-reply.ts`）。
- excel／pdf 紀錄共用 `insertRecord`（UUID、`completed`、`completedAt`）；移除 `recordPdf`→`insertPdf` 中間層；`ExportJobRepository.historyRecord` 改為依類型查詢，取代 service 內重複的類型判斷。
- `export_type` 改用 `EsignExportType` 型別；`EXPORT_TYPE_COLUMN` 移到 entity，repository 的 ZIP 快照條件改用它，不再寫死 `'signed_copies_zip'`。Spec 009 既有的 ZIP 查詢沒有改。
- 匯出條件常數加上 `as const` 並移到 entity，`ExportConditionsDto` 實作 entity 的 `ExportConditions`。
- 數字 ID 的 regex 共用 `NUMERIC_ID_PATTERN`（`export.dto.ts`，含 `cursor`）。
- `signerResult()` 回傳核心的 `EsignSignerResult`；`ExcelExportSignerDto` 由核心的 `ESIGN_SIGNER_RESULT_FIELDS` 挑選，核心 mapper 不再引用 Excel 的簽署人型別。
- 重新命名：`historyItems` → `historyRecordsQuery`、`historyQuery` → `visibleHistoryQuery`、`item` → `toHistoryItem`；`common` 改由 `typeSpecificFields` 補上各類型欄位。
- 記錄 Excel 直接存 `body.conditions`（全域 ValidationPipe 已移除未知欄位）。
- `core-esign-flow` e2e 抽出 `downloadCopy` 共用副本下載請求。

沒有略過的項目。曾嘗試讓 `personalCopy` 帶入錯誤定義參數、在未產生時直接拋錯，但違反「`new AppException` 只引用 `AppErrors.NAME`」的既有檢查（`app-errors.spec.ts`），改為由 history service 檢查。

### 刻意保留的副作用

`GET /api/esign/exportable-documents?documentId=…` 回 400（未知參數，全域 `forbidNonWhitelisted`）。已寫進 spec Assumptions／Out of Scope，並在 `esign-export` e2e 固定。

### 驗證

隔離環境：`DB_MYSQL_DB=feastogether_intranet_test15r`、`REDIS_DB=9`。結果見 [quickstart「Code review 修正」](quickstart.md#code-review-修正2026-10-29)。

## 與契約的差異／未明定行為

ticket 05 只記錄並回報，沒有修改契約語意；契約「前端交接」只修正與程式不符的描述（見本節最後）。下列三項已由使用者在 2026-10-29 決定，並在 code review 修正時改了契約（見 spec Clarifications 與下方「Code review 修正」）。

### 已由使用者決定（2026-10-29）

1. **部門鍵長度上限與前端部門鍵格式衝突**：
   - 原本：`conditions.depts` 每個鍵 1–255 字。前端部門鍵是 `d:` 加 `encodeURIComponent(部門名稱)`（`client/src/features/esign-documents/exportQuery.ts`），每個中文字編碼後是 9 個字元，部門名稱超過 28 個中文字就回 400。
   - 決定：每個鍵放寬為 1–1,000 字，陣列仍最多 500 個。
   - 剩餘限制：部門名稱超過 110 個中文字時仍會超過（`esign_signers.department_snapshot` 最長 150 字）。請求 body 仍受 Fastify 預設 1 MiB 上限限制；500 個 1,000 字的 ASCII 部門鍵約 0.5 MB，可以通過。
2. **`scope` 上限與前端範圍說明可能衝突**：
   - 原本：`scope` trim 後 1–255 字；`describeScope` 列出所有選取的部門名稱時會超過而回 400。
   - 決定：接受 trim 後 1–2,000 字；超過 255 字時依字元（code point）存成前 254 字加「…」，共 255 字。回應與查詢都回傳儲存的值。前端只有在說明超過 2,000 字時才需要縮短。
3. **契約範例值與實際不同**：ZIP item 範例的 `scope` 已改為 Spec 009 實際寫入的「此次簽署的所有已簽副本」。

### 契約沒寫、依既有行為決定的細節

全部路由：
- 成功的 JSON 回應包在全域 envelope 的 `data`。PDF 下載直接回傳檔案。
- 未知的 query 參數與 body 欄位回 400 `INVALID_REQUEST`（全域 `forbidNonWhitelisted`）。
- 寫入路由（Excel 記錄與四條 PDF 下載）缺 `Origin` 或不在允許清單時回 403 `CSRF_ORIGIN_REJECTED`。
- 未登入或只有外部存取 cookie 呼叫員工路由時回 401 `UNAUTHORIZED`。

查詢 `GET /api/esign/history/export`：
- `page` 上限是 `Number.MAX_SAFE_INTEGER`，避免 OFFSET 溢位成 500。`pageSize=0` 回 400。`documentId` 須符合 `^[1-9][0-9]{0,14}$`，`0` 或非數字回 400。
- `documentId` 指向不存在、已刪除或草稿的文件時回 200，`items` 為空、`typeTotals` 全為 0，不回 404。
- `typeTotals` 一律有三個鍵，沒有紀錄的類型為 0。
- 已軟刪除文件的紀錄不列出也不計數。目前只有草稿能刪除；草稿不會有 `excel`／`pdf` 紀錄，ZIP 也需要已簽副本，實務上沒有影響。
- `exportedBy`：
  - 依 `created_by_user_id` 是否為 NULL 判斷：NULL 才是外部簽署人本人下載。
  - 員工取自員工資料**目前**的姓名與員工編號，不是匯出當下的快照；員工已軟刪除也照常顯示。
  - 外部簽署人取簽署人快照。
  - 內部本人下載的 `scope` 標籤用簽署人快照（`name_snapshot（empid_snapshot）`），因此可能與 `exportedBy.name` 不同。
- ZIP item：
  - 只列有快照的匯出工作，`id` 是工作 UUID。
  - `exportedAt` 是申請（工作建立）時間，不是完成時間。
  - 過期時 `status` 回 `expired`；`files` 只在 `completed` 且未過期時有值。
  - `count` 與 `expectedCount` 相同。
  - 重用既有工作的申請不新增紀錄，`exportedBy` 只顯示最初的申請人。
- `excel`／`pdf` item 沒有 `status` 欄位，這兩類紀錄寫入後不再更新。

記錄 Excel `POST /api/esign/history/export`：
- 接受任何非草稿狀態的文件，包含 `expired`、`finalizing`、`completed`、`stopped`。
- `documentId` 格式錯誤回 400，不是 404。
- `conditions` 缺少或不是物件回 400。三個陣列不得有重複值，契約寫的「子集」解讀為不重複。
- `count` 上限是 `Number.MAX_SAFE_INTEGER`。
- `scope` 以 trim 後的值儲存；超過 255 字時存成前 254 字加「…」，回傳儲存的值。
- 不檢查 `depts` 是否為該文件的部門，也不檢查 `count` 是否與實際筆數相符。
- 沒有冪等鍵：重送或連點會新增多筆紀錄。

Excel 重新下載資料 `GET /api/esign/history/export/{id}/document`：
- `id` 不是 UUID 時回 404，不另做 400。
- 紀錄的文件已刪除時回 404。
- 建立人帳號不存在時 `createdBy` 為 null。
- `signers` 的排序與排除已移除簽署人的規則，都與文件詳情相同。

從紀錄重新下載 `POST /api/esign/history/export/{id}/downloads`：
- `id` 不是 UUID 時回 404。
- 簽署人或文件不存在（含已刪除）時回 404。
- 副本尚未產生時回 409，錯誤碼 `ESIGN_STATE_CONFLICT`（`AppErrors.ESIGN_PERSONAL_COPY_NOT_READY`）。完整性驗證失敗回 409 `ESIGN_INTEGRITY_FAILED`。
- 新紀錄的範圍逐字沿用原紀錄的 `scope_description`，不重新計算。

單人 PDF 下載：
- 簽署人標籤依字元（code point）截斷到 255 字。
- 紀錄寫入失敗回 500 `INTERNAL_ERROR` JSON，沒有 `Content-Disposition`。

其他：
- `GET /api/esign/exportable-documents?documentId=…` 由「忽略」改為 400。`documentId` 原本只供已移除的 `/exports` 使用，client 沒有帶這個參數。這是刻意保留的副作用：已寫進 spec Assumptions／Out of Scope，並由 `esign-export` e2e 固定。

### 「前端交接」的修正（T030）

與程式不符的描述已改正，語意不變：
- 原本寫三個下載函式「只需要把 method 改成 POST」，其實路徑也加了 `/downloads`。
- `downloadSignerCompletedFile` 用的是只會發 GET 的 `getBlob`，也要改。
- ZIP 面板的新查詢必須帶 `type=zip`，舊型別的 `cursor`／`limit`／`nextCursor`／`requesterName` 要換掉。
- 補上 `features/forms` 原型也引用 mock store，以及 `buildExportXlsx` 的參數型別需要放寬。
- 補上 `scope`／部門鍵長度的注意事項（code review 修正後改為新的上限，見上方「已由使用者決定」）。

## 已知限制與風險

- **前後端必須一起部署**：舊 GET 下載與 `/exports` 已移除。前端改完前，以下四處在後端合併後都無法使用：
  - ZIP 面板
  - 檢視頁的簽署人副本下載
  - 「我的電子簽」的本人副本下載
  - 外部簽署完成頁下載
- **歷史頁尚未串接**：`/export-history` 仍是 mock，並有 `isAdmin()` 限制，不得描述為已完成。
- **Excel 紀錄由前端回報**：無法證明使用者真的下載了檔案，也無法驗證筆數，而且沒有冪等。
- **資料開放範圍**：任何有效員工都能：
  - 看全部紀錄；
  - 從 Excel 紀錄取得該文件的簽署人清單，含 Email 與拒絕原因；
  - 從 PDF 紀錄重新下載任一份副本。

  電子簽加上 role／permission 後再限制。
- **ZIP 只記錄申請**：重用與下載都不記錄，無法追蹤誰下載了 ZIP（research R9）。
- **Migration 回退**：一旦有 `excel`／`pdf` 紀錄，`down` 會拒絕，需要人工處理資料後才能回退。
- **既有測試偶發失敗**：第一次全套 e2e 時，`core-esign-flow`「10 人共用 3 欄位各產一份 PDF，先簽先下載、跨人拒絕、全 ready 才結案」失敗一次。錯誤是兩個 finalization 並行時，`EsignVerificationService.saveSnapshot` 回報完整性錯誤。單獨重跑與第二次全套都通過。Spec 015 沒有修改 finalization 與 verification，研判是既有的並行時序問題，沒有在本票處理。
- **既有測試與執行時段有關**：Spec 016 `internal-group-reminders` 有 2 個案例把假時鐘設為當天 15:59:50 UTC，session 卻以真實時間核發（有效 8 小時），在 UTC 00:00–08:00 執行時會因 session 過期回 401。code review 修正時在基準 d2abcea 上也重現，與 Spec 015 無關。
