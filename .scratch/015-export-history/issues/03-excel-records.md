# 03: Excel 匯出紀錄與重新下載資料

**What to build:** 前端下載 Excel 時以 `POST /api/esign/history/export` 回報文件、範圍、筆數與條件，由後端寫入紀錄；任何員工可用 `GET /api/esign/history/export/{id}/document` 取得重新產生 Excel 所需的窄資料。

**Blocked by:** 02

**Status:** resolved

**Spec:** 015 — US2、US4（Excel）、FR-006、FR-009、FR-010；對應 T014–T017、T026–T027。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [x] 先寫會失敗的 HTTP 案例，涵蓋成功、404、400、Origin 與 401；每個失敗案例都確認沒有新增紀錄。
- [x] 有效員工即可記錄，不檢查建立人；文件須存在、未刪除且已發起，否則 404 `ESIGN_RESOURCE_NOT_FOUND`。
- [x] 匯出人只取自 session；body 規則依 contract（`type` 只接受 `excel`、條件鍵限定集合、`scope` 為 1–255 字、`count` 為 0 以上整數、`depts` 上限），未知欄位回 400。
- [x] 成功回 201，內容與查詢的 item 形狀相同。
- [x] `GET …/{id}/document` 唯讀、不新增紀錄；只回 contract 列出的欄位，不含管理備註、通知結果、驗證網址與簽署人 publicId；非 `excel` 紀錄或文件已刪除時回 404。
- [x] Swagger 說明與 contract 一致。

## 實作紀錄（2026-10-28，分支 `impl/015-03`，基準 `feat/015-export-history` f08e454）

狀態維持 `claimed`；合併至整合分支後改 `resolved`。

### 變更（只有 server 與規格文件，沒有 migration、client）
- `server/src/features/esign/dto/export-history.dto.ts`：
  - `ExportConditionsDto` 加上驗證（記錄與查詢共用）：`statuses` 為 `pending|signed|rejected` 子集；`depts` 最多 500 個、每個 1–255 字；`fields` 至少一個、為 contract 9 個鍵的子集；三者都不得重複。
  - 新增 `CreateExcelExportRecordDto`：`type` 只接受 `excel`；`documentId` 沿用 `^[1-9][0-9]{0,14}$`；`scope` trim 後 1–255 字；`count` 為 0～`Number.MAX_SAFE_INTEGER` 的整數；`conditions` 必須是物件並做巢狀驗證。
  - 新增回應 DTO `ExcelExportDocumentDto` 與 `ExcelExportSignerDto`（`PickType(EsignSignerViewDto, …)`，欄位名稱與文件詳情相同）。
- `server/src/features/esign/repositories/export-job.repository.ts`：把 `historyPage` 的欄位清單與 join 抽成私有 `historyItems`，新增 `historyRecord(publicId)`（條件與 `historyPage` 相同：文件未刪除、ZIP 只計有快照的工作）。
- `server/src/features/esign/services/esign-export-history.service.ts`：
  - `recordExcel(userId, body)`：文件須存在、未刪除且非草稿，否則 `ESIGN_RESOURCE_NOT_FOUND`；不檢查建立人。寫入 `excel` 紀錄（新 UUID、`status=completed`、`completed_at`、`conditions_json` 只取三個鍵），再以 `historyRecord` 讀回，回傳與查詢相同的 item。已發起文件不會回到草稿或被刪除，因此不鎖定。
  - `excelDocument(publicId)`：只接受文件未刪除的 `excel` 紀錄，否則 404；讀文件、建立人與未移除的簽署人，交給 mapper 裁切；唯讀。
- `server/src/features/esign/services/esign-view.mapper.ts`：新增 `excelExportDocument`；把截止時間推導（`signEndAt`／`originalSignEndAt`／`isReopened`）抽成私有 `signingEnd`，與 `documentSummary` 共用；把簽署人身分與簽署結果抽成私有 `signerResult`，與 `signer()` 共用。既有回應的欄位與順序不變。
- `server/src/features/esign/controllers/export-history.controller.ts`：`POST`（`OriginGuard`，201）與 `GET :id/document`，含 Swagger 說明。
- `server/test/esign-export-history.e2e-spec.ts`：新增「Excel 紀錄」區塊（27 個案例），使用自己的文件、簽署人與員工，不影響「查詢紀錄」的 `docA` 計數。
- 文件：`specs/015-export-history/tasks.md` 勾選 T014–T017、T026–T027；`quickstart.md`「驗證紀錄 › 03 Excel 紀錄」。

### 驗證
詳見 `specs/015-export-history/quickstart.md`「驗證紀錄 › 03 Excel 紀錄」。
- `lint:check`：0 errors（265 個既有 warnings，本次變更檔案 0 個）。
- `build`：通過。
- `test`：106 suites／964 tests。
- `test:schema`：2 suites／12 tests。
- e2e `(esign-export-history|esign-export|api-coverage).e2e-spec.ts$`：3 suites／79 tests（41／4／34）。
- 全套 `test:e2e`（額外回歸）：28 suites／282 tests。

### 與 contract 的對照
- 路由、狀態碼、body 規則、回應形狀與 contract 相同。
- contract 沒寫、屬「參數不合法回 400」範圍的細節：`conditions` 三個陣列不得有重複值（「子集」）；缺 `conditions` 或不是物件回 400；`documentId` 格式錯誤回 400；`count` 上限 `Number.MAX_SAFE_INTEGER`。
- 缺 Origin 回 403 `CSRF_ORIGIN_REJECTED`（`OriginGuard` 的既有行為）。
- `GET …/{id}/document`：`id` 不是 UUID 也回 404；`createdBy` 在建立人帳號不存在時為 null，簽署人排序與排除已移除者都與文件詳情相同。
- 沒有修改 `api-coverage`（避免與 04 衝突）；兩條新路由的 401 已在本檔驗證。

### 給 04／05 的備註
- `ExportJobRepository.historyRecord(publicId)` 可供 `recordPdf` 寫入後讀回新列，及 `POST :id/downloads` 讀取原紀錄（再自行檢查 `exportType`）。
- `ExportConditionsDto` 已有驗證裝飾器；它同時是查詢回應的 schema。

## 整合驗收紀錄（2026-10-29，`feat/015-export-history`）

- 審查 `impl/015-03`（27e63df）：
  - `POST /api/esign/history/export` 套用 `OriginGuard`，回 201；匯出人只取自 `@CurrentUserId()`，body 沒有匯出人欄位（`forbidNonWhitelisted` 擋下前端傳入）；文件以 `DocumentRepository.findById`（排除已刪除）讀取並排除草稿，不檢查建立人。
  - `GET /api/esign/history/export/{id}/document` 只讀不寫；先以 `historyRecord` 讀紀錄（文件未刪除），只接受 `excel` 類型，否則 404。回應經 `excelExportDocument` 裁切，簽署人只有 `type`、`name`、`employeeNo`、`department`、`title`、`email`、`status`、`signedAt`、`rejectedAt`、`rejectReason`，不含 `publicId`、管理備註、通知結果與 `verificationUrl`。
  - `esign-view.mapper.ts` 重構：`documentSummary` 以 `...this.signingEnd()` 開頭，仍依序為 `signEndAt`、`originalSignEndAt`、`isReopened`、`id`…；`signer()` 仍依序為 `publicId`、`type`…`rejectReason`、`completion`、`invitationDelivery`、`verificationUrl`。既有回應的欄位與順序不變，全套 e2e 通過。
  - `ExportJobRepository` 把欄位清單抽成 `historyItems`，`historyPage` 的排序、分頁與 `historyCounts` 行為不變。
  - 沒有修改 client，沒有 migration。
- 合併：`git merge --no-ff impl/015-03`，merge commit `4a8570581026304fefbe0540cac08be32bd78634`，無衝突。
- 在合併後的工作樹以環境變數 `DB_MYSQL_DB=feastogether_intranet_test15m`、`REDIS_DB=10` 隔離執行：

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors；265 warnings 都不在本票變更的檔案 |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e`（全套；mapper 重構影響其他路由） | 28 suites／282 tests 通過 |

狀態改為 `resolved`。
