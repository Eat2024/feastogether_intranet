# 01: 匯出紀錄 schema 擴充

**What to build:** 讓 `esign_export_jobs` 能存 Excel 與單人 PDF 紀錄，以及簽署人本人下載：`created_by_user_id` 改為可 NULL，新增 `signer_id`、`conditions_json`、三個以日期結尾的複合索引與類型 CHECK。

**Blocked by:** None (can start immediately).

**Status:** resolved

**Spec:** 015 — data-model、research R1–R4、R11、R12；對應 T001–T006。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [x] 核對指引、constitution 1.5.0、migration 次序與測試隔離；基準 `test`、`test:schema` 結果記入 quickstart。
- [x] `schema-constraints` 涵蓋 CHECK 的拒絕與接受案例，以及 `signer_id` 外鍵 RESTRICT。
- [x] `schema-migration` 驗證 up→down→up；既有 ZIP 資料在 up 後通過 CHECK；已有 `excel`／`pdf` 紀錄時 down 在任何 DDL 前拒絕且資料不變。
- [x] 索引：`(export_type, created_at, id)`、`(document_id, export_type, created_at, id)`、`(signer_id, created_at, id)`；既有日期欄位的單欄索引保留。
- [x] Migration `1792454406000-ExportHistory`、entity、`schema.sql`、`doc/esign-db-schema.sql` 一致，`schema-metadata.spec.ts` 通過。
- [x] 應用程式行為不變：既有 unit 與 ZIP e2e 仍通過。

## 實作紀錄（2026-10-28，分支 `impl/015-01`，基準 `feat/015-export-history` f974afe）

狀態維持 `claimed`；合併至整合分支後改 `resolved`。

### 變更
- Migration `server/src/infrastructure/database/migrations/1792454406000-ExportHistory.ts`，並在 `mysql.options.ts` 註冊：
  - `up`：一個 `ALTER TABLE` 完成 data-model 的全部變更。外鍵命名為 `fk_esign_export_jobs_signer`。`created_by_user_id` 的 comment 改為「建立員工 ID，NULL 為外部簽署人本人下載」。
  - `down`：已有 `excel`／`pdf` 紀錄時，在任何 DDL 前拋出「無法回滾」；沒有時，以一個 `ALTER TABLE` 移除 CHECK、外鍵、索引與兩欄，並把 `created_by_user_id` 改回 NOT NULL。
- Entity `server/src/features/esign/entities/esign-export-job.entity.ts`：
  - `createdByUserId`／`createdByUser` 可為 NULL。
  - 新增 `signerId`／`signer`（RESTRICT）與 `conditionsJson: ExportConditions`。
  - 新增三個 `@Index` 與 `@Check`。
- `server/src/infrastructure/database/schema.sql` 從已套用新 migration 的隔離庫重新匯出，`doc/esign-db-schema.sql` 改為與它相同。
  - 匯出同時修正先前手動編修的段落：欄位順序與 CHECK 正規化，涉及 `esign_documents`、`esign_file_objects`、`esign_notification_*`、`esign_signers`。舊檔有欄位排在 KEY 之後，無法載入；新檔已實測可載入。
  - `doc/esign-db-schema.sql` 原本停在 c08789f，這次一併補齊。
- 測試：
  - 共用 `revertAfter` 移到 `server/test/schema-migration.helper.ts`。
  - 兩個原本預設「最後一個 migration」的既有案例改為指定版本：constraints 的內部邀請回滾、migration 的內部邀請前置檢查。
  - `mysql.options.spec.ts` 的 migration 清單加入新項目。

### 驗證
詳見 `specs/015-export-history/quickstart.md`「驗證紀錄 › 01 schema」。
- `lint:check`：0 errors。
- `build`：通過。
- `test`：106 suites／964 tests。
- `test:schema`：2 suites／12 tests，原本 8 個。
- ZIP e2e `esign-export`：1 suite／4 tests。
- 全套 `test:e2e`（額外回歸）：27 suites／240 tests。

### 備註
- `test:schema` 的 DB 名稱不可用 `feastogether_intranet_test_015_NN`：加上 33 字元亂數後超過 MySQL 64 字元上限。本票以 `DB_MYSQL_DB=feastogether_intranet_test1501` 執行。
- `pnpm schema:dump` 預設讀 `.env`（開發庫）。本票改讀 `.env.test` 執行同一支腳本，沒有碰開發庫。
- constitution 目前為 2.0.0（016 修訂），驗收條件寫的 1.5.0 已過時；本票沒有牴觸。

## 整合驗收紀錄（2026-10-28，`feat/015-export-history`）

- 審查 `impl/015-01`（54592b7）：
  - CHECK 與 data-model 一致。
  - `down` 在任何 DDL 前檢查 `excel`／`pdf` 紀錄。
  - 沒有修改 client。
  - `schema.sql` 與 `doc/esign-db-schema.sql` 內容相同，不含 `AUTO_INCREMENT=` 或 `DEFINER`。
- 合併：`git merge --no-ff impl/015-01`，merge commit `88253172ffebf33f54dd3484f35aa9d3e66b1c14`，無衝突。
- 在合併後的工作樹以環境變數 `DB_MYSQL_DB=feastogether_intranet_test15m`、`REDIS_DB=10` 隔離執行：

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors；265 warnings 都不在本票變更的檔案 |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test` | 106 suites／964 tests 通過 |
| `pnpm -C server test:schema` | 2 suites／12 tests 通過 |
| `pnpm -C server test:e2e --testRegex 'esign-export.e2e-spec.ts$'` | 1 suite／4 tests 通過 |

狀態改為 `resolved`。
