# Tasks: 歷史匯出紀錄 API

**Input**: [spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/export-history-http-api.md](contracts/export-history-http-api.md)、[quickstart.md](quickstart.md)。

**Status**: 0／30。

**Base**: 以 016（PR #34）為基礎；PR #33 須在 PR #34 之後合併。

**Scope**: 只做 server、必要 migration 與契約文件。不改 client、不部署、不建立 GitHub Issues；前端改動依 contract「前端交接」交給前端工程師。

**Tests**: 依 constitution V 與 quickstart 驗收矩陣，涵蓋 migration、CHECK、授權、GET 唯讀、紀錄寫入失敗與 ZIP 不受影響。每個故事先寫會失敗的測試，實作後轉綠。

## Format 與執行規則

- 格式：`- [ ] TNNN [P?] [USn?] 描述與檔案路徑`，路徑相對 repository root。
- `[P]`：同節的前置任務完成後，可與其他 `[P]` 任務平行；不代表可以忽略依賴，也不能同時修改相同檔案。
- 完成才勾選。MySQL 驗證沒有實際執行時保留未完成並記錄原因，不以 mock 代替。
- 測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料；不讀出 secret，不對開發資料庫執行 rollback。

## Phase 1: Setup — 基準

- [ ] T001 核對 root／server `AGENTS.md`、constitution 1.5.0、migration 次序（目前最新為 `1792454405000-InternalEmailInvitations`）與測試隔離設定。執行基準 `pnpm -C server test` 與 `pnpm -C server test:schema`，把 Node／pnpm 版本與結果記在 `specs/015-export-history/quickstart.md` 的「驗證紀錄」。

## Phase 2: Foundational — Schema

**目的**：讓 `esign_export_jobs` 能存 Excel／PDF 紀錄與本人下載，所有故事都依賴這一步。

- [ ] T002 [P] 在 `server/test/schema-constraints.e2e-spec.ts` 加入 `chk_esign_export_jobs_record_type` 案例：
  - 拒絕：`excel` 缺 `conditions_json` 或 `created_by_user_id`、或帶 `signer_id`；`pdf` 缺 `signer_id` 或帶 `conditions_json`；`signed_copies_zip` 缺 `created_by_user_id`、或帶任一新欄位。
  - 接受：合法 `excel`、`created_by_user_id` 有值或為 NULL 的 `pdf`、既有形狀的 ZIP。
  - `signer_id` 外鍵為 RESTRICT。（依賴 T001）
- [ ] T003 [P] 在 `server/test/schema-migration.e2e-spec.ts` 驗證隔離庫 up→down→up：
  - 既有 ZIP 資料在 up 後仍通過 CHECK。
  - 已有 `excel`／`pdf` 紀錄時，down 在任何 DDL 前拒絕，資料不變。
  - 沒有新類型紀錄時，down 移除欄位、索引、外鍵與 CHECK，`created_by_user_id` 回到 NOT NULL。（依賴 T001）
- [ ] T004 新增 `server/src/infrastructure/database/migrations/1792454406000-ExportHistory.ts`，依 data-model：`created_by_user_id` 改 NULL；新增 `signer_id`（外鍵＋索引）、`conditions_json`、三個複合索引 `idx_esign_export_jobs_type_created (export_type, created_at, id)`、`idx_esign_export_jobs_document_type_created (document_id, export_type, created_at, id)`、`idx_esign_export_jobs_signer_created (signer_id, created_at, id)` 與 CHECK；down 先檢查再回退。（依賴 T002、T003）
- [ ] T005 修改 `server/src/features/esign/entities/esign-export-job.entity.ts`：
  - `createdByUserId`／`createdByUser` 可為 NULL。
  - 新增 `signerId` 與 `signer`（`ManyToOne EsignSigner`，RESTRICT）。
  - 新增 `conditionsJson`，型別 `ExportConditions { statuses, depts, fields }`。
  - 新增 `@Index` 與 `@Check`；`server/src/features/esign/entities/schema-metadata.spec.ts` 通過。（依賴 T004）
- [ ] T006 執行 `pnpm -C server schema:dump` 更新 `server/src/infrastructure/database/schema.sql`，同步 `doc/esign-db-schema.sql`；在隔離 MySQL 執行 `pnpm -C server test:schema`，T002、T003 轉綠，結果記入 quickstart。（依賴 T005）

**Checkpoint**：schema 可存三種紀錄；應用程式行為尚未改變。

## Phase 3: US1 — 依類型查看匯出紀錄（P1）

**目標**：`GET /api/esign/history/export` 取代 `GET /api/esign/exports`。

**獨立驗收**：以合成資料建立三類型紀錄，經 HTTP 驗證分頁、排序、總數、匯出人與授權。

- [ ] T007 [US1] 新增 `server/test/esign-export-history.e2e-spec.ts`，並加進 `server/test/jest-e2e.json` 的 `testRegex`。查詢案例：
  - 參數錯誤回 400：缺 `type`、`type=sheet`、`page=0`、`pageSize=101`、`documentId` 格式錯誤。
  - 23 筆 `excel` 以 `pageSize=10` 翻頁得 10／10／3，依 `created_at`、`id` 由新到舊，不漏不重。
  - 帶與不帶 `documentId` 時，`total` 與 `typeTotals` 都正確。
  - 非建立人、非匯出人的員工看得到全部紀錄；未登入與外部存取 cookie 回 401。
  - `exportedBy` 三種形狀都正確：員工、本人下載的內部簽署人、外部簽署人。
  - `zip` 項目包含既有工作欄位、只計 `snapshot_json IS NOT NULL` 的工作，且不含 `requesterName`。
  - Excel／PDF 合成紀錄以 repository 直接寫入，不依賴後續故事。（依賴 T006）
- [ ] T008 [P] [US1] 在 `server/test/esign-document-delivery-security.e2e-spec.ts` 把讀取清單中的 `/api/esign/exports` 改為 `/api/esign/history/export?type=zip`；在 `server/test/api-coverage.e2e-spec.ts` 加入 `GET /api/esign/exports` 回 404、新路由未登入回 401。（依賴 T006）
- [ ] T009 [P] [US1] 新增 `server/src/features/esign/dto/export-history.dto.ts` 的 `ExportHistoryQueryDto`：`type` 限 `excel|pdf|zip`、`page` 預設 1、`pageSize` 為 1–100 且預設 10、`documentId` 沿用既有正整數字串規則。（依賴 T006）
- [ ] T010 [US1] 在 `server/src/features/esign/repositories/export-job.repository.ts` 新增頁碼列表（join 文件、匯出員工、簽署人）與依類型分組計數；`signed_copies_zip` 加上 `snapshot_json IS NOT NULL`；移除舊的 cursor `history()`。（依賴 T009）
- [ ] T011 [US1] 新增 `server/src/features/esign/services/esign-export-history.service.ts`：
  - API `type` 與 DB `export_type` 的對應只放這裡。
  - 列表 item：共同欄位、`exportedBy` 推導、`excel` 的 `conditions`、`pdf` 的 `signerPublicId`、`zip` 沿用 `EsignExportService.view()`。
  - 回傳 `total` 與 `typeTotals`。
  - 移除 `server/src/features/esign/services/esign-export.service.ts` 的 `history()`。（依賴 T010）
- [ ] T012 [US1] 新增 `server/src/features/esign/controllers/export-history.controller.ts`（`@Controller('esign/history/export')`）的 GET 與 Swagger 說明；在 `server/src/features/esign/esign.module.ts` 註冊；移除 `server/src/features/esign/controllers/exports.controller.ts` 的 `@Get('exports')`。（依賴 T011）
- [ ] T013 [US1] 執行 `esign-export-history`、`esign-export`、`esign-document-delivery-security`、`api-coverage` e2e，T007、T008 轉綠，ZIP 既有案例不變。（依賴 T012）

**Checkpoint**：歷史查詢可用；`GET /api/esign/exports` 已移除。

## Phase 4: US2 — 記錄 Excel 匯出（P1）

**目標**：前端下載 Excel 時以 `POST /api/esign/history/export` 回報，由後端寫入紀錄。

**獨立驗收**：經 HTTP 回報 Excel 紀錄後，查詢看得到正確的匯出人、範圍、筆數與條件；不合法的請求不留紀錄。

- [ ] T014 [US2] 在 `server/test/esign-export-history.e2e-spec.ts` 加入 Excel 紀錄案例：
  - 非建立人也能記錄，回 201、item 形狀，匯出人取自 session。
  - 草稿、已刪除、不存在的文件回 404。
  - 以下回 400：未知欄位、未知狀態或欄位鍵、`fields` 為空、`scope` trim 後為 0 字或 256 字、`count` 為 -1 或小數、`type` 為 `pdf`／`zip`、`depts` 超過 500 個或單一鍵超過 255 字。
  - 缺 Origin 被拒；未登入與外部存取 cookie 回 401。
  - 每個失敗案例都確認沒有新增紀錄。（依賴 T013）
- [ ] T015 [P] [US2] 在 `server/src/features/esign/dto/export-history.dto.ts` 新增 `CreateExcelExportRecordDto` 與巢狀 `ExportConditionsDto`，規則依 contract。（依賴 T013）
- [ ] T016 [US2] 在 `EsignExportHistoryService` 新增 `recordExcel(userId, body)`：
  - 文件必須存在、未刪除且已發起，否則拋 `ESIGN_RESOURCE_NOT_FOUND`。
  - 寫入 `excel` 紀錄：新的 `public_id`、`status=completed`、`completed_at`、`conditions_json`。
  - 回傳與查詢相同的 item。（依賴 T015）
- [ ] T017 [US2] 在 `export-history.controller.ts` 新增 POST，套用 `OriginGuard`，回 201，加上 Swagger 說明；T014 轉綠。（依賴 T016）

## Phase 5: US3 — 記錄單人 PDF 下載（P1）

**目標**：建立人下載與簽署人本人下載都改為 POST，並在回傳 PDF 的同一請求寫入紀錄；舊 GET 移除。

**獨立驗收**：建立人、內部簽署人本人、外部簽署人本人各下載一次，歷史各多一筆且匯出人正確；舊 GET 回 404。

- [ ] T018 [US3] 在 `server/test/esign-export-history.e2e-spec.ts` 加入下載紀錄案例：
  - 建立人呼叫 `POST …/signers/{signerPublicId}/completed-file/downloads`：PDF bytes 與標頭和原本 GET 相同，新增紀錄，匯出人為建立人、範圍為簽署人標籤。
  - 外部簽署人以存取 cookie 呼叫 `POST /api/external-signing-task/completed-file/downloads`：紀錄的 `created_by_user_id` 為 NULL，匯出人為「姓名＋Email」。
  - 內部員工以員工 session 呼叫 `POST /api/esign/signing-tasks/{signerPublicId}/completed-file/downloads`：匯出人為該員工（姓名＋員工編號）；非本人或未簽回原本的錯誤。
  - 副本未完成或權限不符：沿用原本錯誤，且不新增紀錄；缺 Origin 被拒。
  - 讓紀錄寫入失敗（例如以 spy 讓寫入拋錯）：回 500，回應不含 PDF。（依賴 T013）
- [ ] T019 [P] [US3] 把既有 e2e 的三條 GET 下載改為對應的 POST（帶 Origin）：`server/test/core-esign-flow.e2e-spec.ts`、`server/test/internal-email-copy.e2e-spec.ts`、`server/test/esign-rejection.e2e-spec.ts`、`server/test/esign-document-delivery-security.e2e-spec.ts`、`server/test/security-core-esign-flow.e2e-spec.ts`。並在 `server/test/api-coverage.e2e-spec.ts` 加入：舊的三條 GET 回 404，新 POST 未登入回 401。（依賴 T013）
- [ ] T020 [US3] 在 `EsignExportHistoryService` 新增 `recordPdf(document, signer, exporterUserId | null)`：簽署人標籤依 data-model，超過 255 字時截斷；寫入 `pdf` 紀錄。（依賴 T018）
- [ ] T021 [US3] 在 `server/src/features/esign/controllers/documents.controller.ts` 以 `POST :documentId/signers/:signerPublicId/completed-file/downloads`（`OriginGuard`）取代原本的 GET。讓 `EsignCompletionAccessService.creatorFile` 一併回傳記錄需要的文件與簽署人；先取得檔案，再記錄，最後送出。更新 Swagger。（依賴 T020）
- [ ] T022 [US3] 本人下載兩條路由：
  - `server/src/features/esign/controllers/signing-tasks.controller.ts` 以 `POST :signerPublicId/completed-file/downloads`（`OriginGuard`）取代原本的 GET；讓 `EsignCompletionAccessService.signerFile` 一併回傳文件與簽署人，匯出人為目前員工。
  - `server/src/features/esign/controllers/external-signature.controller.ts` 以 `POST external-signing-task/completed-file/downloads`（`OriginGuard`）取代原本的 GET；讓 `ExternalAccessService.completedFile` 一併回傳文件與簽署人，匯出人為 NULL。
  - 更新兩邊的 Swagger 說明。（依賴 T020）
- [ ] T023 [US3] 執行 T018、T019 涉及的 e2e 全部轉綠。（依賴 T021、T022）

## Phase 6: US4 — 從紀錄重新下載（P2）

**目標**：任何員工都能從 PDF 紀錄重新下載並新增紀錄，也能取得 Excel 重新產生所需的資料。

**獨立驗收**：以非建立人身分對 PDF 紀錄重新下載得到副本且多一筆紀錄；對 Excel 紀錄取得窄資料且不新增紀錄。

- [ ] T024 [US4] 在 `server/test/esign-export-history.e2e-spec.ts` 加入 PDF 重新下載案例：
  - 非建立人對 `pdf` 紀錄 `POST /api/esign/history/export/{id}/downloads`：取得 PDF，新增一筆紀錄，匯出人為目前使用者，文件、簽署人與範圍沿用原紀錄。
  - `excel`／`zip`／不存在的紀錄回 404；未登入與外部 cookie 回 401；缺 Origin 被拒。（依賴 T023）
- [ ] T025 [US4] 在 `EsignExportHistoryService` 與 `export-history.controller.ts` 新增 `POST :id/downloads`（`OriginGuard`）：讀紀錄 → `personalCopy` → `recordPdf`（匯出人為目前使用者）→ 送出，加上 Swagger；T024 轉綠。（依賴 T024）
- [ ] T026 [US4] 在 `server/test/esign-export-history.e2e-spec.ts` 加入 Excel 重新下載資料案例：
  - 任何員工對 `excel` 紀錄 `GET /api/esign/history/export/{id}/document`：只回 contract 列出的欄位，不含管理備註、通知結果、驗證網址與簽署人 publicId，也不新增紀錄。
  - `pdf`／`zip`／不存在、文件已刪除時回 404。（依賴 T017）
- [ ] T027 [US4] 在 `EsignExportHistoryService` 與 `export-history.controller.ts` 新增 `GET :id/document`。在 `server/src/features/esign/services/esign-view.mapper.ts` 新增 Excel 用的窄簽署人 view，欄位名稱與文件詳情相同；加上 Swagger；T026 轉綠。（依賴 T026）

## Phase 7: Polish — 回歸與交接

- [ ] T028 完整回歸：`pnpm -C server lint:check`、`build`、`test`、`test:schema`、`test:e2e`。核對 quickstart 矩陣 #22、#23：ZIP 申請、重用、重試、下載與 worker／維護掃描不受新類型影響。結果記入 quickstart「驗證紀錄」。（依賴 T025、T027）
- [ ] T029 對照實作與 `contracts/export-history-http-api.md`，有差異時先回報使用者再更新契約；更新 `docs/agents/電子簽串接待辦清單.md` 的「匯出紀錄（歷史匯出文件頁）」為「後端已完成，待前端串接」；新增 `specs/015-export-history/implementation-notes.md` 記錄交付與限制。（依賴 T028）
- [ ] T030 準備給前端工程師的交接：contract「前端交接」列出的必須同時部署三處、歷史頁、Excel 回報流程與重新下載流程。不得描述歷史頁已完成。（依賴 T029）

## 依賴與票單

| 票單 | 任務 | Blocked by |
|---|---|---|
| `01-export-history-schema` | T001–T006 | — |
| `02-history-query` | T007–T013 | 01 |
| `03-excel-records` | T014–T017、T026–T027 | 02 |
| `04-pdf-download-records` | T018–T025 | 02 |
| `05-verification-handoff` | T028–T030 | 03、04 |

03 與 04 互不依賴，但都會修改 `esign-export-history.service.ts`、`export-history.controller.ts` 與同一個 e2e 檔，建議依序合併以減少衝突。
