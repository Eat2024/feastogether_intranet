# Data Model：歷史匯出紀錄

## `esign_export_jobs`（沿用，擴充）

### Migration `1792454406000-ExportHistory`

| 變更 | 內容 |
|---|---|
| 修改欄位 | `created_by_user_id bigint NULL`（原 NOT NULL）；NULL 代表外部簽署人本人下載 |
| 新增欄位 | `signer_id bigint NULL COMMENT '單人副本的簽署人'`，外鍵連到 `esign_signers(id)` ON DELETE RESTRICT |
| 新增欄位 | `conditions_json json NULL COMMENT 'Excel 匯出條件'` |
| 新增索引 | `idx_esign_export_jobs_type_created (export_type, created_at, id)`：依類型分頁 |
| 新增索引 | `idx_esign_export_jobs_document_type_created (document_id, export_type, created_at, id)`：帶 `documentId` 的查詢與分組計數 |
| 新增索引 | `idx_esign_export_jobs_signer_created (signer_id, created_at, id)`：外鍵與依簽署人查詢 |

既有的 7 個日期欄位（`created_at`、`updated_at`、`completed_at`、`snapshot_at`、`expires_at`、`lease_expires_at`、`next_attempt_at`）都已有單欄索引，不另外新增。
| 新增 CHECK | `chk_esign_export_jobs_record_type`，見下方 |

```sql
CONSTRAINT chk_esign_export_jobs_record_type CHECK (
  (export_type <> 'excel' OR (conditions_json IS NOT NULL AND created_by_user_id IS NOT NULL AND signer_id IS NULL))
  AND (export_type <> 'pdf' OR (signer_id IS NOT NULL AND conditions_json IS NULL))
  AND (export_type IN ('excel', 'pdf') OR (created_by_user_id IS NOT NULL AND signer_id IS NULL AND conditions_json IS NULL))
)
```

`down`：已有 `export_type IN ('excel','pdf')` 的資料時拋錯，拒絕回退；否則依序移除 CHECK、索引、外鍵與兩個新欄位，再把 `created_by_user_id` 改回 NOT NULL。

同步更新：`EsignExportJob` entity、`server/src/infrastructure/database/schema.sql`（`schema:dump`）、`doc/esign-db-schema.sql`。

### 各類型使用的欄位

| 欄位 | `excel` | `pdf` | `signed_copies_zip`（API `zip`） |
|---|---|---|---|
| `public_id` | 新 UUID | 新 UUID | 既有 |
| `document_id` | 文件 | 文件 | 文件 |
| `created_by_user_id` | 匯出人 | 匯出人；外部簽署人本人下載為 NULL | 申請人 |
| `signer_id` | NULL | 副本所屬簽署人 | NULL |
| `conditions_json` | `{ statuses, depts, fields }` | NULL | NULL |
| `status` | `completed` | `completed` | 工作狀態 |
| `scope_description` | 前端傳入的範圍說明；超過 255 字時存成前 254 字加「…」 | 簽署人標籤，超過 255 字截斷 | 既有 |
| `record_count` | 前端傳入的筆數 | 1 | 既有 |
| `completed_at` | 寫入時間 | 寫入時間 | 完成時間 |
| ZIP 專用欄位 | NULL | NULL | 既有 |

### 衍生欄位

- **匯出人 `exportedBy`**：
  - `created_by_user_id` 有值：`{ name: users.name, employeeNo: users.empid, email: null }`，員工已軟刪除也照常顯示。
  - `created_by_user_id` 為 NULL：外部簽署人本人下載，取 `signer_id` 對應簽署人的 `{ name: name_snapshot, employeeNo: null, email: external_email }`。
- **PDF 簽署人標籤**：內部為 `name_snapshot（empid_snapshot）`，外部為 `name_snapshot（external_email）`。
- **文件**：`{ id, title, docNumber }` 取自 `esign_documents` 目前的資料。

### 不變量

- 紀錄只新增；`excel`、`pdf` 紀錄寫入後不再更新。
- `excel`、`pdf` 紀錄的 `snapshot_json` 一律為 NULL，因此不會進入 ZIP 的重試掃描與 ZIP 歷史（這些查詢以 `snapshot_json IS NOT NULL` 辨識 ZIP 工作）。
- `excel`、`pdf` 的 `status` 固定為 `completed` 且 `expires_at` 為 NULL，不會被到期清理或租約查詢選中。
- ZIP 的重用與「最近一次匯出」查詢已限定 `export_type = 'signed_copies_zip'`，不受影響。
