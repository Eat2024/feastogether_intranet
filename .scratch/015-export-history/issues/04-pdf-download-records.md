# 04: 單人 PDF 下載紀錄與重新下載

**What to build:** 建立人下載、內部員工本人下載（員工 session，016 之後）、外部簽署人本人下載（Email OTP）與從紀錄重新下載，都改為 POST 子資源並在回傳 PDF 的同一請求寫入 `pdf` 紀錄；移除三條舊的 GET 下載。

**Blocked by:** 02

**Status:** resolved

**Spec:** 015 — US3、US4（PDF）、FR-004、FR-008、FR-014；research R5、R6；對應 T018–T025。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [x] 先寫會失敗的 HTTP 案例：三條 POST 的成功、錯誤、Origin、401，以及紀錄寫入失敗回 500 且不送出 PDF。
- [x] `POST …/signers/{signerPublicId}/completed-file/downloads`：只限建立人（同原本），PDF bytes 與標頭與原本 GET 相同，匯出人為建立人。
- [x] `POST /api/esign/signing-tasks/{signerPublicId}/completed-file/downloads`：員工 session，只限已簽本人（同 016）；匯出人為該員工。
- [x] `POST /api/external-signing-task/completed-file/downloads`：只限已簽的外部簽署人本人（同 016）；`created_by_user_id` 為 NULL；匯出人為「姓名＋Email」。
- [x] `POST /api/esign/history/export/{id}/downloads`：任何有效員工；只接受 `pdf` 紀錄；新紀錄的匯出人為目前使用者，文件、簽署人與範圍沿用原紀錄。
- [x] 副本未完成或權限不符時沿用原本錯誤，且不新增紀錄；簽署人標籤超過 255 字時截斷。
- [x] 舊的三條 GET 回 404；`core-esign-flow`、`internal-email-copy`、`esign-rejection`、`esign-document-delivery-security`、`security-core-esign-flow`、`api-coverage` 已改用 POST 並通過。
- [x] Swagger 說明與 contract 一致，移除「一般連結直接下載」的串接說明。

## 實作紀錄（2026-10-29，分支 `impl/015-04`，基準 `feat/015-export-history` f08e454）

狀態維持 `claimed`；合併至整合分支後改 `resolved`。

### 變更
- `server/src/features/esign/services/esign-export-history.service.ts`：
  - `recordPdf(signer, exporterUserId | null)`：寫入 `pdf` 紀錄（新 UUID、`status=completed`、`record_count=1`、`completed_at`），文件取簽署人所屬文件，範圍為簽署人標籤（內部「姓名（員工編號）」、外部「姓名（Email）」，依字元截斷到 255 字）。寫入失敗直接拋錯。
  - `redownloadPdf(recordId, userId)`：只接受 `pdf` 紀錄；簽署人或文件不存在（含已刪除）回 404；`personalCopy` 未產生回 409 `ESIGN_PERSONAL_COPY_NOT_READY`；送出前新增紀錄，範圍沿用原紀錄的說明，匯出人為目前使用者。
- `server/src/features/esign/services/esign-completion-access.service.ts`：`creatorFile`／`signerFile` 改回 `{ signer, file }`（`PersonalCopyDownload`）；新增 `PersonalCopyFile` 型別。`external-access.service.ts` 的 `completedFile` 同樣回 `{ signer, file }`。
- `server/src/features/esign/helpers/completed-pdf-reply.ts`（新增）：`sendCompletedPdf(reply, file)`，四條下載共用的附件送出（原本三處重複）；`Cache-Control` 與 `nosniff` 仍由各路由的 `@Header` 設定，錯誤回應也帶上。
- Controllers（皆 `OriginGuard`、`@HttpCode(200)`、Swagger 200 `application/pdf`）：
  - `documents.controller.ts`：`POST :documentId/signers/:signerPublicId/completed-file/downloads` 取代 GET；匯出人為建立人。
  - `signing-tasks.controller.ts`：`POST :signerPublicId/completed-file/downloads` 取代 GET；匯出人為該員工。
  - `external-signature.controller.ts`：`POST external-signing-task/completed-file/downloads` 取代 GET；匯出人 NULL；Swagger 移除「一般連結直接下載」。
  - `export-history.controller.ts`：`POST :id/downloads`。
  - 順序一律為：權限與副本檢查 → 副本未產生拋原本的錯誤 → 寫入紀錄 → 送出。
- `server/src/features/esign/repositories/export-job.repository.ts`：實作時新增 `findRecord(publicId, exportType)`；合併 03 後改用 03 的 `historyRecord(publicId)` 並移除（見下方合併紀錄）。
- 測試：
  - `server/test/esign-export-history.e2e-spec.ts`：新增「單人 PDF 下載紀錄」區塊 30 案（自建文件與已產製副本，走真實完整性驗證）。
  - 既有 e2e 改用 POST：`core-esign-flow`（另於 afterAll 清除本 suite 文件的匯出紀錄）、`internal-email-copy`、`internal-email-signing`、`internal-portal-completion`、`esign-rejection`、`esign-document-delivery-security`、`security-core-esign-flow`、`api-coverage`（舊三條 GET 404、新 POST 未登入 401）。`internal-email-signing` 與 `internal-portal-completion` 不在原清單，但也呼叫舊 GET，一併更新。
  - 單元測試：`esign-completion-access.service.spec.ts`、`external-access.service.spec.ts` 配合新回傳形狀；`document-upload.interceptor.spec.ts` 補上 `EsignExportHistoryService` stub。
- 契約：`specs/003-core-esign-flow/contracts/openapi.yaml` 的兩條下載路徑改為 POST `…/completed-file/downloads`（api-coverage 讀這份契約驗證 session gate）。
- 文件：`specs/015-export-history/tasks.md` 勾選 T018–T025；`quickstart.md`「驗證紀錄 › 04 PDF 下載紀錄」。

### 驗證
詳見 `specs/015-export-history/quickstart.md`「驗證紀錄 › 04 PDF 下載紀錄」。
- 紅燈：四個成功案例在路由實作前都因 404 失敗；錯誤、截斷與寫入失敗案例以變異檢查確認（3 案轉紅後還原）。
- `lint:check`：0 errors（265 個既有 warnings，總數不變）。
- `build`：通過。
- `test`：106 suites／964 tests。
- `test:schema`：2 suites／12 tests。
- e2e（本票涉及與匯出相關的 9 個 suites）：9 suites／134 tests。
- `test:e2e:security`：11 suites／60 tests。
- 全套 `test:e2e`：28 suites／286 tests。

### 與 contract／tasks 的對照
- 四條 POST 的路徑、身分、匯出人、標頭與錯誤都與 contract 相同；舊三條 GET 回 404。
- contract 沒寫、依既有行為決定的細節：
  - 重新下載時簽署人或文件已刪除回 404（與查詢不列出已刪除文件的紀錄一致）；副本無法取得時回 409（`ESIGN_PERSONAL_COPY_NOT_READY` 或 `ESIGN_INTEGRITY_FAILED`）。
  - 紀錄 id 不是 UUID 時回 404，不另做 400 格式驗證。
  - 重新下載的範圍逐字沿用原紀錄的 `scope_description`，不重新計算。
- tasks 寫法的差異（內部介面，不影響 API）：`recordPdf` 只收 `(signer, exporterUserId)`，文件取 `signer.documentId`；`creatorFile`／`signerFile`／`completedFile` 只多回 `signer`，不回 `document`。

### 合併整合分支（2026-10-29）

- 先在 `impl/015-04` 提交 `d62f98c`，再把整合分支最新版 `feat/015-export-history`（c922db8，含 03）合入。
- 衝突與處理：
  - `esign-export-history.service.ts`：兩票都新增 `documents`／`signers` 依賴與方法，保留 03 的 `recordExcel`／`excelDocument` 與本票的 `recordPdf`／`redownloadPdf`。重新下載改用 03 新增的 `ExportJobRepository.historyRecord(publicId)` 再比對 `pdf` 類型（與 `excelDocument` 相同寫法），移除本票重複的 `findRecord`；`historyRecord` 同時排除已刪除文件。
  - `export-history.controller.ts`：合併兩票的 import 與路由，重新下載補上 `ApiParam`（與 03 的 `GET :id/document` 一致）。
  - `esign-export-history.e2e-spec.ts`：兩票各自的 describe 都保留（「單人 PDF 下載紀錄」、「Excel 紀錄」），使用各自的文件。
  - `tasks.md`：T014–T027 全部勾選，`Status` 改為 27／30（03 沒有更新計數）。
  - `quickstart.md`：依票號排列 03、04 的驗證紀錄。
- 合併後在同一隔離庫（`feastogether_intranet_test1504`、`REDIS_DB=14`）重跑：

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors（265 個既有 warnings，總數不變） |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e`（全套） | 28 suites／313 tests 通過（03 合併後 282＋本票 31）；本票涉及的 suites：`esign-export-history` 71（02 的 14＋03 的 27＋本票 30）、`api-coverage` 35、`core-esign-flow` 25、`internal-email-copy` 9、`internal-portal-completion` 6、`esign-rejection` 5、`esign-export` 4、`esign-document-delivery-security` 3、`internal-email-signing` 3 |
| `pnpm -C server test:e2e:security`（含 `security-core-esign-flow`） | 11 suites／60 tests 通過 |

- Swagger（合併後的 build 產物）：`/api/esign/history/export` 底下 GET、POST、`GET {id}/document`、`POST {id}/downloads` 與三條 `POST …/completed-file/downloads` 都在文件中，四條下載為 200 `application/pdf`；三條舊 GET 不在文件中。

## 整合驗收紀錄（2026-10-29，`feat/015-export-history`）

- 審查 `impl/015-04`（a4b3872，含 d62f98c 與整合分支 c922db8 的合併）：
  - 四條 `POST` 下載（建立人、員工本人、外部本人、`/api/esign/history/export/{id}/downloads`）都套用 `OriginGuard` 與 `@HttpCode(200)`；順序為權限與副本檢查 → 副本未產生拋原本的錯誤 → `await recordPdf`／`insertPdf` → `sendCompletedPdf`。紀錄寫入失敗由例外過濾器回 500 JSON，不帶 `Content-Disposition`（e2e 以 `ExportJobRepository.save` 失敗驗證四條路由）。
  - 舊三條 `GET …/completed-file` 已從 controller 移除，`api-coverage` 驗證回 404；server 原始碼只剩 Swagger 說明與 access-log 單元測試的路徑字串。
  - 外部本人下載以 `recordPdf(signer, null)` 寫入，`created_by_user_id` 為 NULL；e2e 確認 `exportedBy` 為簽署人姓名＋Email、`employeeNo` 為 null。
  - 重新下載以 03 的 `historyRecord`（排除已刪除文件）讀紀錄，只接受 `pdf` 類型，其他類型、不存在或非 UUID 回 404；新紀錄沿用原紀錄的簽署人（含文件）與 `scope_description`，匯出人為目前使用者。
  - `specs/003-core-esign-flow/contracts/openapi.yaml` 只改兩條下載路徑（`get` → `post`、路徑加 `/downloads`、描述補一句 Spec 015 說明），`operationId` 與回應不變。`internal-email-signing` 只把外部 cookie 檢查清單的 `get /completed-file` 改為 `post /completed-file/downloads`；`internal-portal-completion` 只把 GET 換成帶 `Origin` 的 POST，斷言不變。兩處都正確且最小。
  - 沒有修改 client（`client/src/api/endpoints.ts` 仍指向舊 GET，依 contract「前端交接」由前端工程師與後端一起部署時處理），沒有 migration。
- 合併：`git merge --no-ff impl/015-04`，merge commit `e3507f8db24747eb6dfc653117de50a52cf2270a`，無衝突。
- 在合併後的工作樹以環境變數 `DB_MYSQL_DB=feastogether_intranet_test15m`、`REDIS_DB=10` 隔離執行：

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors；265 warnings，總數與 03 合併後相同 |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e`（全套） | 28 suites／313 tests 通過 |
| `pnpm -C server test:e2e:security` | 11 suites／60 tests 通過 |

狀態改為 `resolved`。
