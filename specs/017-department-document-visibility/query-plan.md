# Spec 017 查詢計畫實測（T043）

測試日期：2026-11-02。MySQL 8.4.11，獨立資料庫 `feastogether_intranet_test017perf`（127.0.0.1:13317），沒有存取共用 `test017`。全部資料為合成資料，無外部服務呼叫。

## 方法與重跑

[query-plan.cjs](./query-plan.cjs) 建立全新固定名稱的隔離資料庫、執行正式 migrations，直接呼叫編譯後 `DocumentRepository.findByDepartment`、`ExportJobRepository.historyPage/historyCounts`。TypeORM logger 擷取真正送出的 SQL 與參數，再以相同參數執行 `EXPLAIN`，沒有手寫替代查詢或 FORCE INDEX。

```bash
pnpm -C server build
node specs/017-department-document-visibility/query-plan.cjs > /tmp/spec017-query-plan.json
```

腳本刻意使用 `CREATE DATABASE`，既有同名資料庫時失敗，不覆寫資料。重跑需先確認並移除這個由腳本建立的隔離資料庫。測試完成保留資料供檢查；不使用 Redis。腳本與 build 必須來自同一份程式版本。

資料：100 個部門共 20,000 筆文件，每部門 200 筆、其中 20 筆軟刪除；另有 NULL 快照及小寫 `d000` 各一筆。每文件兩筆 Excel、一筆外部 PDF（匯出者 NULL）、一筆有快照 ZIP、一筆無快照 ZIP，共 100,010 匯出紀錄、20,002 簽署人。所有資料通過正式 FK/check 約束。插入後執行 `ANALYZE TABLE` 更新統計。

## 結果

- `D000` dep 列表只回 180 筆未刪除文件；NULL、小寫及其他部門均排除。
- 部門複合索引 `idx_esign_documents_department_deleted_updated_id` 用於 dep 列表與跨文件 history page/count。dep 列表由索引反向掃描完成 updated_at/id 排序，沒有 filesort。
- history page/count 先縮小至部門文件，再以 export job 的既有複合索引 join；未全掃 document/job。
- 跨文件 history 依匯出時間排序需要 temporary/filesort；候選範圍已受部門過濾。count 分組也使用 temporary。這是本次實測計畫的限制，不宣稱完全沒有排序成本。
- exporter 只有一筆合成員工，optimizer 選 `ALL` + hash join；這不是文件或匯出紀錄的全表掃描。
- 每頁 50 筆掃完全部頁面：Excel count=360/page聯集=360、PDF=180/180、ZIP=180/180，無重複且全部符合文件部門與軟刪除條件。無快照 ZIP 不計入。指定文件101得到2/1/1；跨部門文件102 count為空。
- 本機單次實際 repository 呼叫（含取回、ORM hydration）約 0.92–4.58ms，僅為這份合成資料的觀察值，**不是正式環境延遲保證或壓力測試**。EXPLAIN rows 為 optimizer 估計，不是 EXPLAIN ANALYZE 實際掃描量。大部門偏態與併發仍可能改變計畫/排序成本。

本次未發現需要新增索引的證據，未修改 runtime/schema。

## 真正執行的 SQL 與 EXPLAIN

### dep列表

單次 repository 呼叫：4.58 ms。

```sql
SELECT `EsignDocument`.`created_at` AS `EsignDocument_created_at`, `EsignDocument`.`updated_at` AS `EsignDocument_updated_at`, `EsignDocument`.`deleted_at` AS `EsignDocument_deleted_at`, `EsignDocument`.`id` AS `EsignDocument_id`, `EsignDocument`.`doc_number` AS `EsignDocument_doc_number`, `EsignDocument`.`title` AS `EsignDocument_title`, `EsignDocument`.`status` AS `EsignDocument_status`, `EsignDocument`.`created_by_user_id` AS `EsignDocument_created_by_user_id`, `EsignDocument`.`created_by_department_code` AS `EsignDocument_created_by_department_code`, `EsignDocument`.`created_by_department_name` AS `EsignDocument_created_by_department_name`, `EsignDocument`.`sign_start_at` AS `EsignDocument_sign_start_at`, `EsignDocument`.`sign_end_at` AS `EsignDocument_sign_end_at`, `EsignDocument`.`signing_payload_json` AS `EsignDocument_signing_payload_json`, `EsignDocument`.`signing_payload_sha256` AS `EsignDocument_signing_payload_sha256`, `EsignDocument`.`initiated_at` AS `EsignDocument_initiated_at`, `EsignDocument`.`completed_at` AS `EsignDocument_completed_at`, `EsignDocument`.`stopped_at` AS `EsignDocument_stopped_at`, `EsignDocument`.`stop_reason` AS `EsignDocument_stop_reason`, `EsignDocument`.`watermark_enabled` AS `EsignDocument_watermark_enabled`, `EsignDocument`.`allow_reject` AS `EsignDocument_allow_reject` FROM `esign_documents` `EsignDocument` WHERE ( ((`EsignDocument`.`created_by_department_code` = ?) AND (`EsignDocument`.`deleted_at` IS NULL)) ) AND ( `EsignDocument`.`deleted_at` IS NULL ) ORDER BY `EsignDocument`.`updated_at` DESC, `EsignDocument`.`id` DESC
```

參數：`["D000"]`

| table         | type | key                                               | rows（估計） | Extra                            |
| ------------- | ---- | ------------------------------------------------- | -----------: | -------------------------------- |
| EsignDocument | ref  | idx_esign_documents_department_deleted_updated_id |          180 | Using where; Backward index scan |

### history分組count

單次 repository 呼叫：2.42 ms。

```sql
SELECT `job`.`export_type` AS `exportType`, COUNT(*) AS `count` FROM `esign_export_jobs` `job` INNER JOIN `esign_documents` `document` ON `document`.`id`=`job`.`document_id` AND (`document`.`deleted_at` IS NULL) WHERE (`job`.`export_type` <> ? OR `job`.`snapshot_json` IS NOT NULL) AND `document`.`created_by_department_code` = ? AND `job`.`export_type` IN (?, ?, ?) GROUP BY `job`.`export_type`
```

參數：`["signed_copies_zip", "D000", "excel", "pdf", "signed_copies_zip"]`

| table    | type | key                                               | rows（估計） | Extra                                     |
| -------- | ---- | ------------------------------------------------- | -----------: | ----------------------------------------- |
| document | ref  | idx_esign_documents_department_deleted_updated_id |          180 | Using where; Using index; Using temporary |
| job      | ref  | idx_esign_exports_reuse                           |            4 | Using index condition; Using where        |

### history-excel-page

單次 repository 呼叫：3.42 ms。

```sql
SELECT `job`.`public_id` AS `job_public_id`, `job`.`snapshot_at` AS `job_snapshot_at`, `job`.`processed_count` AS `job_processed_count`, `job`.`waiting_count` AS `job_waiting_count`, `job`.`expires_at` AS `job_expires_at`, `job`.`id` AS `job_id`, `job`.`export_type` AS `job_export_type`, `job`.`document_id` AS `job_document_id`, `job`.`created_by_user_id` AS `job_created_by_user_id`, `job`.`signer_id` AS `job_signer_id`, `job`.`conditions_json` AS `job_conditions_json`, `job`.`status` AS `job_status`, `job`.`scope_description` AS `job_scope_description`, `job`.`record_count` AS `job_record_count`, `job`.`failure_code` AS `job_failure_code`, `job`.`completed_at` AS `job_completed_at`, `job`.`created_at` AS `job_created_at`, `document`.`id` AS `document_id`, `document`.`doc_number` AS `document_doc_number`, `document`.`title` AS `document_title`, `exporter`.`id` AS `exporter_id`, `exporter`.`empid` AS `exporter_empid`, `exporter`.`name` AS `exporter_name`, `signer`.`id` AS `signer_id`, `signer`.`public_id` AS `signer_public_id`, `signer`.`email` AS `signer_email`, `signer`.`name_snapshot` AS `signer_name_snapshot` FROM `esign_export_jobs` `job` INNER JOIN `esign_documents` `document` ON `document`.`id`=`job`.`document_id` AND (`document`.`deleted_at` IS NULL)  LEFT JOIN `users` `exporter` ON `exporter`.`id`=`job`.`created_by_user_id`  LEFT JOIN `esign_signers` `signer` ON `signer`.`id`=`job`.`signer_id` WHERE (`job`.`export_type` <> ? OR `job`.`snapshot_json` IS NOT NULL) AND `document`.`created_by_department_code` = ? AND `job`.`export_type` = ? ORDER BY `job_created_at` DESC, `job_id` DESC LIMIT 50 OFFSET 0
```

參數：`["signed_copies_zip", "D000", "excel"]`

| table    | type   | key                                               | rows（估計） | Extra                                                  |
| -------- | ------ | ------------------------------------------------- | -----------: | ------------------------------------------------------ |
| document | ref    | idx_esign_documents_department_deleted_updated_id |          180 | Using index condition; Using temporary; Using filesort |
| job      | ref    | idx_esign_export_jobs_document_type_created       |            1 | —                                                      |
| exporter | ALL    | —                                                 |            1 | Using where; Using join buffer (hash join)             |
| signer   | eq_ref | PRIMARY                                           |            1 | —                                                      |

### history-pdf-page

單次 repository 呼叫：1.97 ms。

```sql
SELECT `job`.`public_id` AS `job_public_id`, `job`.`snapshot_at` AS `job_snapshot_at`, `job`.`processed_count` AS `job_processed_count`, `job`.`waiting_count` AS `job_waiting_count`, `job`.`expires_at` AS `job_expires_at`, `job`.`id` AS `job_id`, `job`.`export_type` AS `job_export_type`, `job`.`document_id` AS `job_document_id`, `job`.`created_by_user_id` AS `job_created_by_user_id`, `job`.`signer_id` AS `job_signer_id`, `job`.`conditions_json` AS `job_conditions_json`, `job`.`status` AS `job_status`, `job`.`scope_description` AS `job_scope_description`, `job`.`record_count` AS `job_record_count`, `job`.`failure_code` AS `job_failure_code`, `job`.`completed_at` AS `job_completed_at`, `job`.`created_at` AS `job_created_at`, `document`.`id` AS `document_id`, `document`.`doc_number` AS `document_doc_number`, `document`.`title` AS `document_title`, `exporter`.`id` AS `exporter_id`, `exporter`.`empid` AS `exporter_empid`, `exporter`.`name` AS `exporter_name`, `signer`.`id` AS `signer_id`, `signer`.`public_id` AS `signer_public_id`, `signer`.`email` AS `signer_email`, `signer`.`name_snapshot` AS `signer_name_snapshot` FROM `esign_export_jobs` `job` INNER JOIN `esign_documents` `document` ON `document`.`id`=`job`.`document_id` AND (`document`.`deleted_at` IS NULL)  LEFT JOIN `users` `exporter` ON `exporter`.`id`=`job`.`created_by_user_id`  LEFT JOIN `esign_signers` `signer` ON `signer`.`id`=`job`.`signer_id` WHERE (`job`.`export_type` <> ? OR `job`.`snapshot_json` IS NOT NULL) AND `document`.`created_by_department_code` = ? AND `job`.`export_type` = ? ORDER BY `job_created_at` DESC, `job_id` DESC LIMIT 50 OFFSET 0
```

參數：`["signed_copies_zip", "D000", "pdf"]`

| table    | type   | key                                               | rows（估計） | Extra                                                  |
| -------- | ------ | ------------------------------------------------- | -----------: | ------------------------------------------------------ |
| document | ref    | idx_esign_documents_department_deleted_updated_id |          180 | Using index condition; Using temporary; Using filesort |
| job      | ref    | idx_esign_export_jobs_document_type_created       |            1 | —                                                      |
| exporter | ALL    | —                                                 |            1 | Using where; Using join buffer (hash join)             |
| signer   | eq_ref | PRIMARY                                           |            1 | —                                                      |

### history-signed_copies_zip-page

單次 repository 呼叫：1.68 ms。

```sql
SELECT `job`.`public_id` AS `job_public_id`, `job`.`snapshot_at` AS `job_snapshot_at`, `job`.`processed_count` AS `job_processed_count`, `job`.`waiting_count` AS `job_waiting_count`, `job`.`expires_at` AS `job_expires_at`, `job`.`id` AS `job_id`, `job`.`export_type` AS `job_export_type`, `job`.`document_id` AS `job_document_id`, `job`.`created_by_user_id` AS `job_created_by_user_id`, `job`.`signer_id` AS `job_signer_id`, `job`.`conditions_json` AS `job_conditions_json`, `job`.`status` AS `job_status`, `job`.`scope_description` AS `job_scope_description`, `job`.`record_count` AS `job_record_count`, `job`.`failure_code` AS `job_failure_code`, `job`.`completed_at` AS `job_completed_at`, `job`.`created_at` AS `job_created_at`, `document`.`id` AS `document_id`, `document`.`doc_number` AS `document_doc_number`, `document`.`title` AS `document_title`, `exporter`.`id` AS `exporter_id`, `exporter`.`empid` AS `exporter_empid`, `exporter`.`name` AS `exporter_name`, `signer`.`id` AS `signer_id`, `signer`.`public_id` AS `signer_public_id`, `signer`.`email` AS `signer_email`, `signer`.`name_snapshot` AS `signer_name_snapshot` FROM `esign_export_jobs` `job` INNER JOIN `esign_documents` `document` ON `document`.`id`=`job`.`document_id` AND (`document`.`deleted_at` IS NULL)  LEFT JOIN `users` `exporter` ON `exporter`.`id`=`job`.`created_by_user_id`  LEFT JOIN `esign_signers` `signer` ON `signer`.`id`=`job`.`signer_id` WHERE (`job`.`export_type` <> ? OR `job`.`snapshot_json` IS NOT NULL) AND `document`.`created_by_department_code` = ? AND `job`.`export_type` = ? ORDER BY `job_created_at` DESC, `job_id` DESC LIMIT 50 OFFSET 0
```

參數：`["signed_copies_zip", "D000", "signed_copies_zip"]`

| table    | type   | key                                               | rows（估計） | Extra                                                  |
| -------- | ------ | ------------------------------------------------- | -----------: | ------------------------------------------------------ |
| document | ref    | idx_esign_documents_department_deleted_updated_id |          180 | Using index condition; Using temporary; Using filesort |
| job      | ref    | idx_esign_export_jobs_document_type_created       |            1 | Using where                                            |
| exporter | ALL    | —                                                 |            1 | Using where; Using join buffer (hash join)             |
| signer   | eq_ref | PRIMARY                                           |            1 | —                                                      |

### history單文件count

單次 repository 呼叫：1.61 ms。

```sql
SELECT `job`.`export_type` AS `exportType`, COUNT(*) AS `count` FROM `esign_export_jobs` `job` INNER JOIN `esign_documents` `document` ON `document`.`id`=`job`.`document_id` AND (`document`.`deleted_at` IS NULL) WHERE (`job`.`export_type` <> ? OR `job`.`snapshot_json` IS NOT NULL) AND `document`.`created_by_department_code` = ? AND `job`.`document_id` = ? AND `job`.`export_type` IN (?, ?, ?) GROUP BY `job`.`export_type`
```

參數：`["signed_copies_zip", "D000", 101, "excel", "pdf", "signed_copies_zip"]`

| table    | type  | key                                         | rows（估計） | Extra                              |
| -------- | ----- | ------------------------------------------- | -----------: | ---------------------------------- |
| document | const | PRIMARY                                     |            1 | —                                  |
| job      | range | idx_esign_export_jobs_document_type_created |            5 | Using index condition; Using where |

### history單文件page

單次 repository 呼叫：0.92 ms。

```sql
SELECT `job`.`public_id` AS `job_public_id`, `job`.`snapshot_at` AS `job_snapshot_at`, `job`.`processed_count` AS `job_processed_count`, `job`.`waiting_count` AS `job_waiting_count`, `job`.`expires_at` AS `job_expires_at`, `job`.`id` AS `job_id`, `job`.`export_type` AS `job_export_type`, `job`.`document_id` AS `job_document_id`, `job`.`created_by_user_id` AS `job_created_by_user_id`, `job`.`signer_id` AS `job_signer_id`, `job`.`conditions_json` AS `job_conditions_json`, `job`.`status` AS `job_status`, `job`.`scope_description` AS `job_scope_description`, `job`.`record_count` AS `job_record_count`, `job`.`failure_code` AS `job_failure_code`, `job`.`completed_at` AS `job_completed_at`, `job`.`created_at` AS `job_created_at`, `document`.`id` AS `document_id`, `document`.`doc_number` AS `document_doc_number`, `document`.`title` AS `document_title`, `exporter`.`id` AS `exporter_id`, `exporter`.`empid` AS `exporter_empid`, `exporter`.`name` AS `exporter_name`, `signer`.`id` AS `signer_id`, `signer`.`public_id` AS `signer_public_id`, `signer`.`email` AS `signer_email`, `signer`.`name_snapshot` AS `signer_name_snapshot` FROM `esign_export_jobs` `job` INNER JOIN `esign_documents` `document` ON `document`.`id`=`job`.`document_id` AND (`document`.`deleted_at` IS NULL)  LEFT JOIN `users` `exporter` ON `exporter`.`id`=`job`.`created_by_user_id`  LEFT JOIN `esign_signers` `signer` ON `signer`.`id`=`job`.`signer_id` WHERE (`job`.`export_type` <> ? OR `job`.`snapshot_json` IS NOT NULL) AND `document`.`created_by_department_code` = ? AND `job`.`document_id` = ? AND `job`.`export_type` = ? ORDER BY `job_created_at` DESC, `job_id` DESC LIMIT 50 OFFSET 0
```

參數：`["signed_copies_zip", "D000", 101, "excel"]`

| table    | type   | key                     | rows（估計） | Extra                                      |
| -------- | ------ | ----------------------- | -----------: | ------------------------------------------ |
| document | const  | PRIMARY                 |            1 | Using temporary; Using filesort            |
| job      | ref    | idx_esign_exports_reuse |            2 | —                                          |
| exporter | ALL    | —                       |            1 | Using where; Using join buffer (hash join) |
| signer   | eq_ref | PRIMARY                 |            1 | —                                          |
