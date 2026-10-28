# Spec 015 實作紀錄

> 交付邊界：只有 server、migration 與契約文件。client 沒有修改，歷史匯出文件頁（`/export-history`）仍是 mock，前端串接依 [contract「前端交接」](contracts/export-history-http-api.md#前端交接) 由前端工程師處理。

各票的變更、驗證與合併紀錄在 `.scratch/015-export-history/issues/01`～`05`；指令結果與驗收矩陣對照在 [quickstart「驗證紀錄」](quickstart.md#驗證紀錄)。

## 交付摘要

### Server

- 新增 `GET /api/esign/history/export`：依類型（`excel`／`pdf`／`zip`）以頁碼查詢所有人的匯出紀錄，回 `total` 與 `typeTotals`。API `type` 與 DB `export_type` 的對應只在 `EsignExportHistoryService`。
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

## 與契約的差異／未明定行為

以下依 ticket 05 的規定只記錄並回報，沒有修改契約語意。契約「前端交接」只修正與程式不符的描述（見本節最後）。

### 與契約或現有前端不一致，需要使用者決定

1. **部門鍵長度上限與前端部門鍵格式衝突**：
   - 契約：`conditions.depts` 每個鍵 1–255 字。
   - 前端：部門鍵是 `d:` 加 `encodeURIComponent(部門名稱)`（`client/src/features/esign-documents/exportQuery.ts`），每個中文字編碼後是 9 個字元。`esign_signers.department_snapshot` 最長 150 字。
   - 影響：部門名稱超過 28 個中文字時，部門鍵超過 255 字，`POST /api/esign/history/export` 回 400。依契約「記錄成功才下載」，Excel 會下載不了。
   - 選項：放寬上限、改用較短的部門鍵，或由前端改用其他鍵。
2. **`scope` 上限與前端範圍說明可能衝突**：
   - 契約：`scope` trim 後 1–255 字，規則本身明確。
   - 前端：`describeScope` 會列出所有選取的部門名稱，部門選得多時會超過 255 字而回 400。
   - 前端需要縮短說明，例如「部門：A、B 等 12 個」。已寫進「前端交接」。
3. **契約範例值與實際不同**：ZIP item 範例的 `scope` 寫「全部已簽署副本」，實際是 Spec 009 寫入的「此次簽署的所有已簽副本」。只影響範例，沒有改契約。

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
  - 員工取自員工資料**目前**的姓名與員工編號，不是匯出當下的快照。
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
- `scope` 以 trim 後的值儲存並回傳。
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
- `GET /api/esign/exportable-documents?documentId=…` 由「忽略」改為 400。`documentId` 原本只供已移除的 `/exports` 使用，client 沒有帶這個參數。

### 「前端交接」的修正（T030）

與程式不符的描述已改正，語意不變：
- 原本寫三個下載函式「只需要把 method 改成 POST」，其實路徑也加了 `/downloads`。
- `downloadSignerCompletedFile` 用的是只會發 GET 的 `getBlob`，也要改。
- ZIP 面板的新查詢必須帶 `type=zip`，舊型別的 `cursor`／`limit`／`nextCursor`／`requesterName` 要換掉。
- 補上 `features/forms` 原型也引用 mock store，以及 `buildExportXlsx` 的參數型別需要放寬。
- 補上 `scope`／部門鍵長度的注意事項。

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
- **匯出員工帳號被軟刪除時**：查詢的 join 會排除已軟刪除的員工，`exportedBy` 會改走外部簽署人分支。結果是：
  - `excel`／`zip` 紀錄因為沒有簽署人，整頁回 500；
  - `pdf` 紀錄會把簽署人顯示成匯出人。

  目前程式沒有軟刪除員工的路徑，只有手動改 DB 才會發生；本票沒有修正，留待使用者決定。
- **Migration 回退**：一旦有 `excel`／`pdf` 紀錄，`down` 會拒絕，需要人工處理資料後才能回退。
- **既有測試偶發失敗**：第一次全套 e2e 時，`core-esign-flow`「10 人共用 3 欄位各產一份 PDF，先簽先下載、跨人拒絕、全 ready 才結案」失敗一次。錯誤是兩個 finalization 並行時，`EsignVerificationService.saveSnapshot` 回報完整性錯誤。單獨重跑與第二次全套都通過。Spec 015 沒有修改 finalization 與 verification，研判是既有的並行時序問題，沒有在本票處理。
