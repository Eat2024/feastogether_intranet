# Phase 1 Data Model：舊授權清理與電子簽資料基礎

## Model conventions

- MySQL 8.4、InnoDB、`utf8mb4_unicode_ci`；`synchronize=false`，migration 是 schema 單一事實來源。
- 所有時間以 UTC `DATETIME(6)` 保存。`created_at` 由 DB／TypeORM 建立時間機制填入。
- 每個 `DATE`／`DATETIME(6)` 欄位都建立命名為 `idx_<table>_<column>` 的專屬單欄索引；既有複合索引不取代此要求。
- 主鍵及 FK 使用同型別 signed `BIGINT`。目前 TypeScript 沿用 `number`，在 API／repository 邊界明確轉型；本規格不改成 string ID。
- UUID 與 SHA-256 使用 ASCII binary collation；SHA-256 固定 64 字元小寫十六進位。
- JSON 在 TypeScript 表示為 `Record<string, unknown> | null`；送入 hash 前必須 canonicalize。
- `DECIMAL(6,3)` 在 TypeScript 使用 decimal string 或既有 Decimal transformer，不以 JS `number` 做精度敏感運算。
- 所有 FK 使用 RESTRICT／NO ACTION；不設定 TypeORM cascade 或 eager relation。
- 一般軟刪除仍占用 unique key。草稿簽署人刪除後重新加入同一 identity 時，復原既有列，不插入第二列。
- DB CHECK 只保留 signer 身分類型 XOR 與 file object 至少一個 owner 兩項結構性約束；狀態列舉、日期範圍、座標、數量及狀態時間搭配由後續 service 驗證，避免把業務規則堆在 entity。

## Audit／mutation profiles

| Profile              | Columns / access                                                                   | Entities                                                   |
| -------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| User-auditable       | `AuditableEntity` 加 nullable BIGINT `created_by_user_id`, `updated_by_user_id`    | `hr_departments`, `esign_document_fields`, `esign_signers` |
| Editable master      | `AuditableEntity`：`created_at`, `updated_at`, `deleted_at`，不自動增加 actor 欄位 | `users`, `esign_documents`                                 |
| Append-only evidence | 只有 `created_at`；正式 repository 僅 insert/query                                 | `esign_signature_records`, `esign_audit_events`            |
| Controlled evidence  | 建立後只允許指定狀態轉換，不提供 general save/delete                               | `esign_verification_records`                               |
| Operational record   | 僅按表定義的狀態與完成時間更新，不提供一般 soft-delete                             | file objects、notifications、export jobs                   |

AuditSubscriber 從 CLS 取得 user ID，寫入 nullable BIGINT actor 欄位；system／worker 操作可為 NULL。

## Required single-column time indexes

| Table                        | 每欄皆須建立專屬單欄 INDEX 的日期／時間欄位                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `hr_departments`             | `start_date`, `stop_date`, `created_at`, `updated_at`, `deleted_at`                                                    |
| `users`                      | `last_login_at`, `created_at`, `updated_at`, `deleted_at`                                                              |
| `esign_documents`            | `sign_start_at`, `sign_end_at`, `initiated_at`, `completed_at`, `stopped_at`, `created_at`, `updated_at`, `deleted_at` |
| `esign_document_fields`      | `created_at`, `updated_at`, `deleted_at`                                                                               |
| `esign_signers`              | `signed_at`, `rejected_at`, `created_at`, `updated_at`, `deleted_at`                                                   |
| `esign_signature_records`    | `signed_at_utc`, `created_at`                                                                                          |
| `esign_file_objects`         | `created_at`                                                                                                           |
| `esign_audit_events`         | `occurred_at`, `created_at`                                                                                            |
| `esign_verification_records` | `issued_at`, `revoked_at`, `created_at`                                                                                |
| `esign_notification_batches` | `created_at`                                                                                                           |
| `esign_notification_logs`    | `created_at`, `completed_at`                                                                                           |
| `esign_export_jobs`          | `created_at`, `updated_at`, `completed_at`                                                                             |

共 39 個日期／時間欄位、39 個專屬單欄索引。Entity metadata、migration、schema integration test 與 schema snapshot 必須一致。下列各 entity 的業務複合索引仍另外保留。

## Entities

### 1. `hr_departments`

組織節點。欄位：`id`, `department_name`, nullable `parent_id`, `start_date`, `stop_date`，以及 user-auditable 欄位。

- FK：`parent_id → hr_departments.id`；actor IDs → `users.id`（建立 users 後補上）。
- Index：`parent_id`，以及本文件時間索引矩陣列出的 5 個單欄索引。
- Service validation：`stop_date IS NULL OR start_date IS NULL OR stop_date >= start_date`。

### 2. `users`

登入、文件建立、內部簽署與 audit actor 的唯一 principal。

欄位：`id`, unique `empid VARCHAR(32)`, `name VARCHAR(100)`, nullable `person_status`, `department_id`, `department_name`, `title_name`, `last_login_at`, `deleted_at`，required `is_active DEFAULT 1`, `created_at`, `updated_at`。

- FK：`department_id → hr_departments.id`。
- Index：unique `empid`；`department_id`；`person_status`；`is_active`，以及時間索引矩陣列出的 4 個單欄索引。
- 不含：role、permission、description/local note、password、OAuth identity binding、`oauth_sub`。
- SSO：每次只以上游已驗證的 `employee_number` claim 對應 `empid`；inactive 或 soft-deleted 使用者不得建立或繼續使用受保護 session。

### 3. `esign_documents`

欄位：`id`, unique `doc_number CHAR(36)`, `title`, `status`, `created_by_user_id`, nullable `sign_start_at`, `sign_end_at`, `signing_payload_json`, `signing_payload_sha256`, `initiated_at`, `completed_at`, `stopped_at`, `stop_reason`, `deleted_at`，`watermark_enabled DEFAULT 0`, `allow_reject DEFAULT 1`, `created_at`, `updated_at`。

- FK：建立人 → `users.id`。
- Service validation：status 為 `draft | in_progress | completed | stopped`，且 `sign_end_at` 不得早於 `sign_start_at`。
- Index：unique `doc_number`；`(created_by_user_id, status, updated_at, id)`，以及時間索引矩陣列出的 8 個單欄索引。
- `watermark_enabled`、`allow_reject` 必須進入 canonical signing payload。進入 `in_progress` 後，內容、fields、signers 與兩個選項由後續 service 鎖定。

### 4. `esign_document_fields`

欄位：`id`, `document_id`, `field_type`, `page_number`, `x_percent`, `y_percent`, nullable `width_percent`, `height_percent`, `sort_order DEFAULT 0`，以及 user-auditable 欄位。

- FK：document → `esign_documents.id`。
- Service validation：type 為 `signature | date`；page >= 1；各 percent 為 0..100；有尺寸時 `x + width <= 100`、`y + height <= 100`。
- Index：`(document_id, page_number, sort_order, id)`，以及時間索引矩陣列出的 3 個單欄索引。

### 5. `esign_signers`

欄位：`id`, `document_id`, `signer_type`, nullable `user_id`, `email`, `empid_snapshot`, `department_snapshot`, `title_snapshot`, required `name_snapshot`, `status DEFAULT 'pending'`, nullable `signed_at`, `rejected_at`, `reject_reason`, `sort_order DEFAULT 0`，以及 user-auditable 欄位。

- FK：document → documents；user／actor IDs → users。
- Identity CHECK：

```sql
(signer_type = 'user' AND user_id IS NOT NULL
  AND email IS NULL AND empid_snapshot IS NOT NULL)
OR
(signer_type = 'email' AND user_id IS NULL
  AND email IS NOT NULL AND empid_snapshot IS NULL)
```

- Service validation：pending 時兩個 terminal timestamp 皆 NULL；signed 只需 `signed_at`；rejected 只需 `rejected_at`。`reject_reason` 可選。
- Unique：`(document_id, user_id)`、`(document_id, email)`。Email 先 trim + lowercase，欄位用 case-insensitive collation。
- Index：`(user_id, status, document_id)`；`(document_id, status, sort_order, id)`，以及時間索引矩陣列出的 5 個單欄索引。

### 6. `esign_signature_records`

每位成功簽署人最多一筆不可變證據。欄位：`id`, unique `signer_id`, `document_sha256`, `signing_payload_sha256`, `consent_version`, `authentication_method`, unique `authentication_event_id`, nullable `source_ip`, `user_agent`, `signed_at_utc`, `created_at`。

- FK：signer → signers。
- Index：unique signer/auth event；`signing_payload_sha256`，以及時間索引矩陣列出的 2 個單欄索引。
- 不含 `updated_at`／`deleted_at`，不提供 update/delete repository 方法。

### 7. `esign_file_objects`

Private object storage metadata。欄位：`id`, nullable `document_id`, `signature_record_id`, `verification_record_id`, `export_job_id`, `file_purpose`, unique case-sensitive `object_key`, nullable `object_version`, `original_file_name`, required `mime_type`, `file_size`, `sha256`, `archive_status`, `created_at`。

- FK：四個 owner IDs 分別連 documents、signature records、verification records、export jobs。
- Owner CHECK：四個 owner 欄位至少一個非 NULL；purpose 與 owner 的更細 mapping 由後續 server service 驗證。
- Service validation：`file_size >= 0`；purpose 限資料字典列舉；archive status 為 `active | sealed | deleted`。
- Index：所有 owner FK；unique `object_key`；`file_purpose`, `sha256`, `archive_status`，以及 `created_at` 單欄索引。
- 不保存公開 URL 或檔案內容。

### 8. `esign_audit_events`

文件範圍 append-only hash chain。欄位：`id`, `document_id`, nullable `signer_id`, `actor_user_id`, `previous_event_hash`, `request_id`, `metadata_json`, required `event_type`, `occurred_at`, unique `event_hash`, `created_at`。

- FK：document、signer、actor user。
- Index：`(document_id, occurred_at, id)`；signer、actor、event type、request ID；unique event hash，以及 `occurred_at`、`created_at` 各自的單欄索引。
- 第一筆 previous hash 為 NULL；其餘 chain 連續性與 canonical event hash 由後續 service transaction 驗證。
- 不含 `updated_at`／`deleted_at`，metadata 不得放 token、cookie、OTP、簽名圖或文件全文。

### 9. `esign_verification_records`

欄位：`id`, unique `document_id`, unique `public_id CHAR(36)`, `manifest_json`, `manifest_sha256`, `final_pdf_sha256`, `audit_root_hash`, `status DEFAULT 'valid'`, `issued_at`, nullable `revoked_at`, `created_at`。

- FK：document → documents。
- Service validation：status 為 `valid | revoked | superseded`；revoked 時 `revoked_at` 必填，非 revoked 時為 NULL。
- Index：unique document/public ID；manifest/final PDF hash；status，以及 `issued_at`、`revoked_at`、`created_at` 各自的單欄索引。
- 除 `status`、`revoked_at` 的窄化 revoke 操作外，其他欄位不可更新；不可刪除。

### 10. `esign_notification_batches`

欄位：`id`, `document_id`, `filter_type`, `target_count`, nullable `notified_by_user_id`, `created_at`。

- FK：document、notified user。
- Service validation：filter 為 `all | pending`；`target_count >= 0`。
- Index：`document_id`，以及 `created_at` 單欄索引。

### 11. `esign_notification_logs`

欄位：`id`, `batch_id`, `signer_id`, `channel`, `result DEFAULT 'pending'`, nullable `error_code`, `completed_at`, `created_at`。

- FK：batch → batches；signer → signers。
- Unique：`(batch_id, signer_id, channel)`。
- Service validation：result 為 `pending | success | fail | unknown`；channel 限資料字典允許值。
- Index：batch、signer、result，以及 `created_at`、`completed_at` 各自的單欄索引；錯誤只存穩定 code，不存供應商完整 response／stack。

### 12. `esign_export_jobs`

欄位：`id`, `export_type`, nullable `document_id`, `created_by_user_id`, `status DEFAULT 'pending'`, `scope_description`, nullable `record_count`, `failure_code`, `completed_at`, `created_at`, `updated_at`。

- FK：document、created-by user。
- Service validation：type 為 `signing_log_excel | signed_pdf`；status 為 `pending | processing | completed | failed`；`record_count IS NULL OR record_count >= 0`。
- Index：document；`(created_by_user_id, status, created_at, id)`；status，以及 `created_at`、`updated_at`、`completed_at` 各自的單欄索引。

## Relationships

```text
hr_departments 1 ── * users
hr_departments 1 ── * hr_departments (parent)
users      1 ── * esign_documents (creator)
esign_documents 1 ── * esign_document_fields
esign_documents 1 ── * esign_signers
users      1 ── * esign_signers (user signer; nullable)
esign_signers  1 ── 0..1 esign_signature_records
esign_documents 1 ── * esign_audit_events
esign_documents 1 ── 0..1 esign_verification_records
esign_documents 1 ── * esign_notification_batches
esign_notification_batches 1 ── * esign_notification_logs
esign_signers  1 ── * esign_notification_logs
esign_documents 1 ── * esign_export_jobs (nullable for cross-document export)
esign_file_objects * ── 1..* business owners (at least one owner column)
```

## State transitions and cross-row invariants

### Document

```text
draft → in_progress → completed
                    ↘ stopped
draft ─────────────────→ stopped
```

- `in_progress` 起鎖定文件內容、fields、signers、watermark 與 allow-reject。
- `completed` 前所有 signers 必須是 `signed` 或 `rejected`，且最終 PDF、verification record 與必要 file objects 已建立。
- 有 rejected signer 不會阻止其他人簽署；只要仍有 pending signer 就不能 completed。

### Signer

```text
pending → signed
pending → rejected    # 僅文件 allow_reject=true
```

- signed 必須原子建立唯一 signature record，且 `signed_at` 相符。
- rejected 必須沒有 signature record，且 `rejected_at` 必填。

### Operational records

- Verification：valid → revoked／superseded；撤銷同時追加 audit event。
- Export：pending → processing → completed／failed；completed 必須有 purpose=export 的 file object。
- Notification：pending → success／fail／unknown；completed_at 在 terminal result 填入。

上述跨列不變量無法只靠單列 CHECK 完整保證；Spec 1 只建立資料形狀與 repository 邊界，正式交易與狀態機由後續業務 spec 實作及驗收。

## Migration creation and rollback order

```text
UP
1 departments（含 self FK，不含 user actor FK）
2 users（含 department FK）
3 ALTER departments 加 user actor FK
4 documents
5 document_fields
6 signers
7 signature_records
8 audit_events
9 verification_records
10 notification_batches
11 notification_logs
12 export_jobs
13 file_objects

DOWN
先 DROP departments 的 user actor FK，再按上述資料表反序 DROP。
```
