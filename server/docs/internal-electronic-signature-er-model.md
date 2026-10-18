# 內部電子簽章平台 ER Model

> 文件狀態：規劃中
> 範圍：第一階段 12 張 MySQL 資料表
> 說明：登入 session、SSO transaction、nonce、launch code 與重放防護存放於 Redis，不建立 MySQL session table。

圖中為維持可讀性只列主要欄位；完整欄位、可空性、索引與語意以 [internal-electronic-signature-data-dictionary.md](./internal-electronic-signature-data-dictionary.md) 為準。

所有 `DATE` 與 `DATETIME(6)` 欄位均建立專屬單欄索引；ER 圖不逐一標記這 39 個索引，以資料字典與正式 migration 為準，既有複合索引不取代此要求。

```mermaid
erDiagram
    direction LR

    hrDepartments o|--o{ hrDepartments : "包含下層部門"
    hrDepartments o|--o{ users : "包含員工"
    users ||--o{ esignDocuments : "建立文件"
    users o|--o{ esignSigners : "擔任內部簽署人"
    esignDocuments ||--o{ esignDocumentFields : "配置簽署欄位"
    esignDocuments ||--o{ esignSigners : "指定簽署人"
    esignSigners ||--o| esignSignatureRecords : "完成簽署"
    esignDocuments o|--o{ esignFileObjects : "保存文件檔案"
    esignSignatureRecords o|--o{ esignFileObjects : "保存簽署產物"
    esignDocuments ||--o{ esignAuditEvents : "產生稽核事件"
    users o|--o{ esignAuditEvents : "執行操作"
    esignSigners o|--o{ esignAuditEvents : "關聯簽署事件"
    esignDocuments ||--o| esignVerificationRecords : "產生驗證紀錄"
    esignVerificationRecords o|--o{ esignFileObjects : "保存驗證產物"
    esignDocuments ||--o{ esignNotificationBatches : "產生通知批次"
    esignNotificationBatches ||--o{ esignNotificationLogs : "包含通知明細"
    esignSigners ||--o{ esignNotificationLogs : "接收通知"
    esignDocuments o|--o{ esignExportJobs : "關聯匯出工作"
    esignExportJobs o|--o| esignFileObjects : "輸出匯出檔案"

    hrDepartments["hr_departments 部門"] {
        bigint id PK
        string department_name
        bigint parent_id FK
        date start_date
        date stop_date
        datetime deleted_at
    }

    users["users 員工與登入主體"] {
        bigint id PK
        string empid UK
        string name
        string person_status
        bool is_active
        bigint department_id FK
        string department_name
        string title_name
        datetime last_login_at
        datetime deleted_at
    }

    esignDocuments["esign_documents 電子簽文件"] {
        bigint id PK
        uuid doc_number UK
        string title
        string status
        bigint created_by_user_id FK
        datetime sign_start_at
        datetime sign_end_at
        bool watermark_enabled
        bool allow_reject
        json signing_payload_json
        string signing_payload_sha256
        datetime completed_at
    }

    esignDocumentFields["esign_document_fields 文件欄位"] {
        bigint id PK
        bigint document_id FK
        string field_type
        int page_number
        decimal x_percent
        decimal y_percent
        decimal width_percent
        decimal height_percent
        int sort_order
    }

    esignSigners["esign_signers 簽署人"] {
        bigint id PK
        bigint document_id FK
        string signer_type
        bigint user_id FK
        string email
        string empid_snapshot
        string name_snapshot
        string department_snapshot
        string title_snapshot
        string status
        datetime signed_at
        string completion_status
        uuid completion_lease_token
        datetime completion_lease_expires_at
        datetime completion_ready_at
        datetime rejected_at
    }

    esignSignatureRecords["esign_signature_records 簽署證據"] {
        bigint id PK
        bigint signer_id FK, UK
        string document_sha256
        string signing_payload_sha256
        string consent_version
        string authentication_method
        string authentication_event_id UK
        string source_ip
        datetime signed_at_utc
        datetime created_at
    }

    esignFileObjects["esign_file_objects 私有檔案"] {
        bigint id PK
        bigint document_id FK
        bigint signature_record_id FK
        bigint completed_signature_record_id UK
        bigint verification_record_id FK
        bigint export_job_id FK
        string file_purpose
        string object_key UK
        string mime_type
        bigint file_size
        string sha256
    }

    esignAuditEvents["esign_audit_events 稽核事件鏈"] {
        bigint id PK
        bigint document_id FK
        bigint signer_id FK
        bigint actor_user_id FK
        string event_type
        datetime occurred_at
        string previous_event_hash
        string event_hash UK
        string request_id
        json metadata_json
    }

    esignVerificationRecords["esign_verification_records QR驗證"] {
        bigint id PK
        bigint document_id FK, UK
        uuid public_id UK
        json manifest_json
        string manifest_sha256
        string final_pdf_sha256
        string audit_root_hash
        string status
        datetime issued_at
        datetime revoked_at
    }

    esignNotificationBatches["esign_notification_batches 通知批次"] {
        bigint id PK
        bigint document_id FK
        string filter_type
        int target_count
        bigint notified_by_user_id FK
        datetime created_at
    }

    esignNotificationLogs["esign_notification_logs 通知明細"] {
        bigint id PK
        bigint batch_id FK
        bigint signer_id FK
        string channel
        string result
        string error_code
        datetime created_at
    }

    esignExportJobs["esign_export_jobs 匯出工作"] {
        bigint id PK
        string export_type
        bigint document_id FK
        bigint created_by_user_id FK
        string status
        string scope_description
        int record_count
        datetime created_at
        datetime completed_at
    }
```

## 模型邊界

- 文件進入 `in_progress` 後，文件、欄位、簽署人及 `signing_payload_json` 必須鎖定；需要修改時建立新文件。
- `signing_payload_json` 與 `manifest_json` 必須使用固定 canonicalization 規則，再由 server 計算 SHA-256。
- QR Code 只包含 `/verify/{public_id}` 驗證網址，不包含完整 manifest、員工個資或簽名圖檔。
- PDF、簽名圖檔、manifest、QR Code 與匯出檔案存放於 private object storage；MySQL 的 `esign_file_objects` 只保存 object key、hash 及必要 metadata。
- `esign_signature_records`、`esign_audit_events` 與 `esign_verification_records` 屬證據資料，不提供一般管理後台修改或刪除。
- 第一階段不建立 `auth_users`、identity binding、RBAC、provider、session 或 document version 資料表；單一 issuer 驗證完成後直接以員工編號對應 `users.empid`。

## 共用欄位與個人副本（2026-10-16）

一份 document 配 10 位 signer，各有一筆 signature record 與一份 record-owned completed_pdf，共 10 份個人 PDF；共用 3 個欄位仍只有 3 筆 field。簽署人數不設固定上限。

completed_pdf 的 document_id 與 signature_record_id 為互斥 owner。未來簽到表可用一份 document-owned PDF，由 manifest 記錄多筆參與證據；本次不實作簽到表，也不增加 junction table。來源 PDF 的 owner 永遠為 document。

個人 signed 即排入產製，ready 可在 active／finalizing／stopped／completed 下載；全員 signed／ready 才提交 manifest v2 與 completed。manifest 保存各個人檔摘要，新 snapshot 的 final_pdf_sha256 為 NULL。

外部邀請簽完失效，不再發 receipt；個人檔僅建立人與本人內部員工可下載。
