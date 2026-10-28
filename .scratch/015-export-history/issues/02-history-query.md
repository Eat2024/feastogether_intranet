# 02: 歷史匯出紀錄查詢

**What to build:** 新增 `GET /api/esign/history/export?type=excel|pdf|zip&page&pageSize&documentId`，以頁碼分頁回傳紀錄、`total` 與 `typeTotals`，並移除 `GET /api/esign/exports`。

**Blocked by:** 01

**Status:** claimed

**Spec:** 015 — US1、FR-001～005、FR-011、FR-012；對應 T007–T013。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [x] 新增 `server/test/esign-export-history.e2e-spec.ts` 並加進 `jest-e2e.json`；先寫會失敗的查詢案例。
- [x] 參數驗證：缺 `type`、未知 `type`、`page=0`、`pageSize=101`、`documentId` 格式錯誤都回 400。
- [x] 分頁依 `created_at`、`id` 由新到舊，不漏不重；帶與不帶 `documentId` 時 `total`、`typeTotals` 都正確。
- [x] 任何有效員工可看全部紀錄；未登入與外部存取 cookie 回 401。
- [x] `exportedBy` 正確區分員工、本人下載的內部簽署人、外部簽署人；`zip` 項目沿用既有工作欄位，只計 `snapshot_json IS NOT NULL` 的工作。
- [x] API `type` 與 DB `export_type` 的對應只在 history service 一處。
- [x] `GET /api/esign/exports` 回 404；security 與 api-coverage e2e 已改用新路由；ZIP 申請、查詢、重試、下載的既有 e2e 不變。
- [x] Swagger 說明與 contract 一致。

## 實作紀錄（2026-10-28，分支 `impl/015-02`，基準 `feat/015-export-history` e7ed918）

狀態維持 `claimed`；合併至整合分支後改 `resolved`。

### 變更
- `server/src/features/esign/dto/export-history.dto.ts`（新增）：
  - `ExportHistoryQueryDto`：`type` 限 `excel|pdf|zip`；`page` 預設 1、上限 `Number.MAX_SAFE_INTEGER`（避免 OFFSET 溢位成 500）；`pageSize` 1–100、預設 10；`documentId` 沿用 `^[1-9][0-9]{0,14}$`。
  - 回應 DTO：`ExportHistoryPageDto`、`ExportHistoryItemDto`、`ExportedByDto`、`ExportHistoryDocumentDto`、`ExportConditionsDto`（目前只描述回應；03 可在同一個 class 加上驗證）、`ExportHistoryFileDto`、`ExportTypeTotalsDto`，供 Swagger plugin 產生 schema。
- `server/src/features/esign/repositories/export-job.repository.ts`：
  - 新增 `historyPage`（`ORDER BY created_at DESC, id DESC LIMIT/OFFSET`；inner join 未刪除文件，left join 匯出員工與簽署人；只選需要的欄位，不載入 ZIP 的 `snapshot_json`／`resolved_files_json`）與 `historyCounts`（`GROUP BY export_type`）。兩者共用 `historyQuery`：文件未刪除、`signed_copies_zip` 只計 `snapshot_json IS NOT NULL`。
  - 移除舊的 cursor `history()`。
- `server/src/features/esign/services/esign-export-history.service.ts`（新增）：`EXPORT_TYPE_COLUMN` 是 API `type` 與 DB `export_type` 唯一的對應；`list()` 同時取列表與分組計數，產生 `total`、`typeTotals`（沒有紀錄的類型為 0）；item 依 data-model 推導 `exportedBy`，`excel` 加 `conditions`、`pdf` 加 `signerPublicId`、`zip` 合併 `EsignExportService.view()`。
- `server/src/features/esign/controllers/export-history.controller.ts`（新增）：`@Controller('esign/history/export')` 的 `GET`，含 `ApiOperation`、200／400／401 與 `sessionCookie`。
- `server/src/features/esign/esign.module.ts`：註冊新 controller 與 service。
- 移除 `GET /api/esign/exports`：`exports.controller.ts` 的 `@Get('exports')`、`EsignExportService.history()`，以及只供它使用的 `ExportQueryDto.documentId`。
- 測試：
  - `server/test/esign-export-history.e2e-spec.ts`（新增）並加入 `jest-e2e.json`。
  - `esign-document-delivery-security`：讀取清單改用 `/api/esign/history/export?type=zip`（未登入與外部 cookie 401、員工 200 且不寫入）。
  - `api-coverage`：`GET /api/esign/exports` 回 404，新路由未登入回 401 `UNAUTHORIZED`。
- 文件：`specs/015-export-history/tasks.md` 勾選 T007–T013；`quickstart.md`「驗證紀錄 › 02 查詢」。

### 驗證
詳見 `specs/015-export-history/quickstart.md`「驗證紀錄 › 02 查詢」。
- 紅燈：先寫參數與授權案例，路由尚未存在時 8 個案例都因 404 失敗。排序、計數、匯出人與 ZIP 案例與實作同一輪完成，改以變異檢查確認會失敗（拿掉 ZIP 快照條件、排序只依流水號、內部員工匯出人改取簽署人快照 → 5 個案例轉紅）。
- `lint:check`：0 errors（265 個既有 warnings，本次變更檔案 0 個）。
- `build`：通過。
- `test`：106 suites／964 tests。
- `test:schema`：2 suites／12 tests。
- e2e `esign-export-history|esign-export|esign-document-delivery-security|api-coverage`：4 suites／55 tests（14／4／3／34）。
- 全套 `test:e2e`（額外回歸）：28 suites／255 tests 通過（01 合併後為 27／240；新增本檔 14 個與 api-coverage 1 個）。

### 與 contract 的對照
- 回應形狀與 contract 相同：`items`、`page`、`pageSize`、`total`、`typeTotals`；item 共同欄位 `id`（紀錄 UUID，ZIP 為工作 id）、`type`、`document`、`exportedBy`、`exportedAt`（`created_at`）、`scope`、`count`；`conditions` 只在 `excel`，`signerPublicId` 只在 `pdf`，ZIP 欄位與 `EsignExportJob` 相同且不含 `requesterName`。
- contract 沒寫、沿用既有行為的細節：已軟刪除文件的紀錄不列也不計（舊 `/exports` 相同；已發起文件不能刪除，實務上只影響草稿）；未知查詢參數回 400（全域 `forbidNonWhitelisted`）。
- `page` 加上 `Number.MAX_SAFE_INTEGER` 上限，屬「參數不合法回 400」的範圍。
- `GET /api/esign/exportable-documents?documentId=…` 由「忽略」變成 400（`documentId` 只供已移除的 `/exports` 使用）；client 沒有呼叫這個參數。

### 給 03／04 的備註
- `EsignExportHistoryService.item(job, type)` 需要 `job.document`、`job.createdByUser`、`job.signer` 已載入（`historyPage` 的 select）。03 的 `recordExcel`、04 的 `recordPdf` 回傳 item 時，要以相同欄位重新讀取或自行帶入關聯。
- `historyPage` 只選列出的欄位；新增 item 欄位時要一併加進 select。
- 新 e2e 在 `describe('查詢紀錄')` 的 `beforeAll` 以 `baseline` 差值驗證不帶 `documentId` 的 `typeTotals`。03／04 新增的 describe 若在它之前寫入紀錄，不影響差值（基準在該 `beforeAll` 取得）；在它之後寫入也不影響已執行的案例。共用 fixture（員工、`docA`／`docB`、內部／外部簽署人、`insertRecord`、`history()`）在最外層。
