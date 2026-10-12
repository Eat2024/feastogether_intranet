# 內部電子簽章平台資料字典

> 文件狀態：規劃中
> 對應模型：[internal-electronic-signature-er-model.md](./internal-electronic-signature-er-model.md)
> 範圍：第一階段 12 張 MySQL 資料表，不包含 RBAC、identity binding、provider、session 與 document version table。

## 1. 共通規則

- 所有 `datetime` 欄位以 UTC 寫入 MySQL，API／UI 邊界才轉換為台北時間。
- 所有 `DATE` 與 `DATETIME(6)` 欄位都必須建立專屬單欄索引；即使欄位已出現在複合索引中，也不得省略該單欄索引。
- 所有 SHA-256 欄位保存 64 字元小寫十六進位字串，不接受 client 傳入值作為最終可信結果，必須由 server 對實際持久化內容重新計算。
- `signing_payload_json` 與 `manifest_json` 在計算 hash 前必須使用固定 canonicalization 規則，避免 JSON 欄位順序、空白或序列化差異造成不同摘要。
- PDF、簽名圖檔、manifest、QR Code 與匯出檔案存放於 private object storage；MySQL 只保存 object key、hash、大小、MIME type 與狀態。
- `deleted_at` 僅供一般業務資料軟刪除。簽署證據、稽核事件與驗證紀錄不可透過一般後台刪除。
- `created_by_user_id`、`updated_by_user_id` 為 NULL 時代表由系統、同步程序或 worker 執行。
- 登入 session、SSO transaction、nonce、launch code 與 `jti` 重放防護存放於 Redis，不在本文件定義 MySQL table。
- SSO 僅以已驗證的員工編號對應 `users.empid`；本 schema 不保存 `oauth_sub` 或其他 provider identity binding。
- 外部簽署 Email 在寫入前只做 `trim + lowercase`，並使用大小寫不敏感欄位與 `(document_id, email)` 唯一鍵防重；不得因此建立假 User。
- `esign_signature_records`、`esign_audit_events` 的正式 repository 只提供 insert/query；`esign_verification_records` 只額外提供窄化 revoke，不提供一般 update/delete/soft-delete。
- DB CHECK 只保留 signer 身分類型 XOR 與 file object 至少一個 owner。狀態列舉、日期範圍、座標、數量及狀態時間搭配由後續 server service 驗證，不把易變業務規則堆在 entity。
- MySQL DDL 會 auto-commit，baseline migration 失敗時的 cleanup 僅是 best effort；測試與開發環境應丟棄半套資料庫後重建。

## 2. 組織與登入

### 2.1 `hr_departments`

公司部門／門市組織主檔，支援父子部門結構。員工透過 `users.department_id` 連結此表。

| 欄位                 | 型別         | 必填 | 鍵值／索引                      | 說明                                         |
| -------------------- | ------------ | ---: | ------------------------------- | -------------------------------------------- |
| `id`                 | BIGINT       |   是 | PK                              | 部門流水號，僅供本系統內部關聯。             |
| `department_name`    | VARCHAR(150) |   是 |                                 | 部門或門市顯示名稱。                         |
| `parent_id`          | BIGINT       |   否 | FK → `hr_departments.id`、INDEX | 上層部門；NULL 代表根節點。                  |
| `start_date`         | DATE         |   否 | INDEX                           | 部門生效日。                                 |
| `stop_date`          | DATE         |   否 | INDEX                           | 部門停止使用日期；歷史資料仍保留。           |
| `created_at`         | DATETIME(6)  |   是 | INDEX                           | 建立時間。                                   |
| `updated_at`         | DATETIME(6)  |   是 | INDEX                           | 最近更新時間。                               |
| `deleted_at`         | DATETIME(6)  |   否 | INDEX                           | 軟刪除時間；不可因此破壞既有員工或簽署歷史。 |
| `created_by_user_id` | BIGINT       |   否 | FK → `users.id`                 | 建立者；同步程序建立時可為 NULL。            |
| `updated_by_user_id` | BIGINT       |   否 | FK → `users.id`                 | 最近修改者；同步程序修改時可為 NULL。        |

### 2.2 `users`

合併原 `hr_users` 與登入 principal 的員工主檔。`users.id` 同時作為 JWT `sub`、Redis session 的員工 ID、文件建立人、簽署人及稽核操作人識別碼。

| 欄位              | 型別         | 必填 | 鍵值／索引                      | 說明                                                                    |
| ----------------- | ------------ | ---: | ------------------------------- | ----------------------------------------------------------------------- |
| `id`              | BIGINT       |   是 | PK                              | 員工在本系統內的不可變流水號。                                          |
| `empid`           | VARCHAR(32)  |   是 | UNIQUE                          | 公司員工編號，供 HR／SSO 對應；不可用姓名或 Email 取代。                |
| `name`            | VARCHAR(100) |   是 |                                 | 員工姓名，由受信任 HR／SSO 來源同步。                                   |
| `person_status`   | VARCHAR(50)  |   否 | INDEX                           | 上游人員狀態原始語意，例如試用、正式、離職。                            |
| `is_active`       | TINYINT(1)   |   是 | INDEX，預設 1                   | 在職且可登入本系統。設為 0 時拒絕新 session 並撤銷既有 Redis sessions。 |
| `department_id`   | BIGINT       |   否 | FK → `hr_departments.id`、INDEX | 所屬部門。                                                              |
| `department_name` | VARCHAR(150) |   否 |                                 | 部門名稱冗餘顯示值，避免列表查詢每次 JOIN；不是歷史簽署快照。           |
| `title_name`      | VARCHAR(100) |   否 |                                 | 目前職稱。                                                              |
| `last_login_at`   | DATETIME(6)  |   否 | INDEX                           | 最近一次成功通過 SSO 並建立本地 session 的時間。                        |
| `created_at`      | DATETIME(6)  |   是 | INDEX                           | 首次建立員工資料時間。                                                  |
| `updated_at`      | DATETIME(6)  |   是 | INDEX                           | 最近一次同步或本地更新時間。                                            |
| `deleted_at`      | DATETIME(6)  |   否 | INDEX                           | 軟刪除時間。一般離職只應設定 `is_active = 0`，不得刪除歷史簽署人。      |

## 3. 電子簽核心

### 3.1 `esign_documents`

電子簽案件主檔。第一階段不建立版本表，因此文件進入 `in_progress` 後必須鎖定；任何實質修改都建立新文件。

| 欄位                     | 型別         | 必填 | 鍵值／索引             | 說明                                                                                                                |
| ------------------------ | ------------ | ---: | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`                     | BIGINT       |   是 | PK                     | 文件流水號。                                                                                                        |
| `doc_number`             | CHAR(36)     |   是 | UNIQUE                 | 對外文件 UUID；建立後不可變更。                                                                                     |
| `title`                  | VARCHAR(200) |   是 |                        | 文件顯示名稱。                                                                                                      |
| `status`                 | VARCHAR(20)  |   是 | INDEX                  | 文件狀態：`draft`、`in_progress`、`completed`、`stopped`；`completed` 可包含已拒絕者，但不得仍有 `pending` 簽署人。 |
| `created_by_user_id`     | BIGINT       |   是 | FK → `users.id`、INDEX | 文件建立人；也是第一階段通知、停止與匯出的權限判斷依據。                                                            |
| `sign_start_at`          | DATETIME(6)  |   否 | INDEX                  | 可開始簽署的 UTC 時間；NULL 代表發起後立即開始。                                                                    |
| `sign_end_at`            | DATETIME(6)  |   否 | INDEX                  | 簽署截止 UTC 時間；NULL 代表未設定截止時間。                                                                        |
| `watermark_enabled`      | TINYINT(1)   |   是 | 預設 0                 | 是否在下載或匯出的已簽署 PDF 每一頁加入系統浮水印；不改寫原始檔。草稿階段可調整，進入 `in_progress` 後不可修改。    |
| `allow_reject`           | TINYINT(1)   |   是 | 預設 1                 | 是否允許簽署人拒絕簽署。草稿階段可調整，進入 `in_progress` 後不可修改。                                             |
| `signing_payload_json`   | JSON         |   否 |                        | 發起簽署時固定的 canonical payload，包含文件、欄位、簽署人、條款版本等必要參數；draft 階段可為 NULL。               |
| `signing_payload_sha256` | CHAR(64)     |   否 | INDEX                  | Server 對 canonical `signing_payload_json` 計算的 SHA-256；進入 `in_progress` 後不可修改。                          |
| `initiated_at`           | DATETIME(6)  |   否 | INDEX                  | 文件由 `draft` 轉為 `in_progress` 的時間。                                                                          |
| `completed_at`           | DATETIME(6)  |   否 | INDEX                  | 所有簽署人均已簽署或拒絕，且最終文件產生完成的時間。                                                                |
| `stopped_at`             | DATETIME(6)  |   否 | INDEX                  | 文件停止簽署時間。                                                                                                  |
| `stop_reason`            | VARCHAR(500) |   否 |                        | 停止簽署原因。                                                                                                      |
| `created_at`             | DATETIME(6)  |   是 | INDEX                  | 建立時間。                                                                                                          |
| `updated_at`             | DATETIME(6)  |   是 | INDEX                  | 最近狀態或草稿內容更新時間。                                                                                        |
| `deleted_at`             | DATETIME(6)  |   否 | INDEX                  | 草稿軟刪除時間；已進入簽署流程的文件不得由一般後台刪除。                                                            |

`watermark_enabled` 與 `allow_reject` 必須納入發起簽署時固定的
`signing_payload_json` 及其摘要，確保簽署期間不會在未留下新文件證據的情況下改變。

### 3.2 `esign_document_fields`

文件上的簽名、日期等版面欄位。座標使用相對頁面百分比，避免 PDF 顯示尺寸不同造成位置偏移。

| 欄位                 | 型別         | 必填 | 鍵值／索引                       | 說明                                              |
| -------------------- | ------------ | ---: | -------------------------------- | ------------------------------------------------- |
| `id`                 | BIGINT       |   是 | PK                               | 文件欄位流水號。                                  |
| `document_id`        | BIGINT       |   是 | FK → `esign_documents.id`、INDEX | 所屬文件。                                        |
| `field_type`         | VARCHAR(20)  |   是 |                                  | 欄位類型；第一階段支援 `signature`、`date`。      |
| `page_number`        | INT          |   是 | 複合 INDEX                       | PDF 頁碼，從 1 起算。                             |
| `x_percent`          | DECIMAL(6,3) |   是 |                                  | 欄位左上角相對頁面寬度的 X 百分比。               |
| `y_percent`          | DECIMAL(6,3) |   是 |                                  | 欄位左上角相對頁面高度的 Y 百分比。               |
| `width_percent`      | DECIMAL(6,3) |   否 |                                  | 欄位寬度百分比。                                  |
| `height_percent`     | DECIMAL(6,3) |   否 |                                  | 欄位高度百分比。                                  |
| `sort_order`         | INT          |   是 | 預設 0                           | 欄位顯示或處理順序。                              |
| `created_at`         | DATETIME(6)  |   是 | INDEX                            | 建立時間。                                        |
| `updated_at`         | DATETIME(6)  |   是 | INDEX                            | 最近更新時間；文件進入 `in_progress` 後不得更新。 |
| `deleted_at`         | DATETIME(6)  |   否 | INDEX                            | 草稿階段軟刪除時間。                              |
| `created_by_user_id` | BIGINT       |   否 | FK → `users.id`                  | 建立者。                                          |
| `updated_by_user_id` | BIGINT       |   否 | FK → `users.id`                  | 最近修改者。                                      |

### 3.3 `esign_signers`

文件指定簽署人及目前簽署狀態，支援內部員工的「我的電子簽」查詢，以及尚未具員工身分之面試錄取人員等 Email 外部簽署人。員工資料快照用於保留簽署當時身分，不隨 HR 資料更新而改變。`signed` 與 `rejected` 都是終止狀態；拒絕者不產生成功簽署證據，但不阻止其他簽署人繼續。

| 欄位                  | 型別         | 必填 | 鍵值／索引                | 說明                                                                                |
| --------------------- | ------------ | ---: | ------------------------- | ----------------------------------------------------------------------------------- |
| `id`                  | BIGINT       |   是 | PK                        | 簽署人指派流水號。                                                                  |
| `document_id`         | BIGINT       |   是 | FK → `esign_documents.id` | 所屬文件。                                                                          |
| `signer_type`         | VARCHAR(20)  |   是 | INDEX                     | 簽署人類型：`user`（內部員工）或 `email`（Email 外部簽署人）。                      |
| `user_id`             | BIGINT       |   否 | FK → `users.id`           | 被指定的內部員工；`signer_type = user` 時必填，外部簽署人為 NULL。                  |
| `email`               | VARCHAR(255) |   否 |                           | 外部簽署人的正規化通知與識別 Email；`signer_type = email` 時必填，內部員工為 NULL。 |
| `empid_snapshot`      | VARCHAR(32)  |   否 |                           | 發起簽署時的員編快照；外部簽署人為 NULL。                                           |
| `name_snapshot`       | VARCHAR(100) |   是 |                           | 發起簽署時的姓名快照。                                                              |
| `department_snapshot` | VARCHAR(150) |   否 |                           | 發起簽署時的部門快照。                                                              |
| `title_snapshot`      | VARCHAR(100) |   否 |                           | 發起簽署時的職稱快照。                                                              |
| `status`              | VARCHAR(20)  |   是 | INDEX，預設 `pending`     | 狀態：`pending`、`signed`、`rejected`。                                             |
| `signed_at`           | DATETIME(6)  |   否 | INDEX                     | 成功簽署時間，必須與成功的簽署證據紀錄一致。                                        |
| `rejected_at`         | DATETIME(6)  |   否 | INDEX                     | 拒絕簽署時間。                                                                      |
| `reject_reason`       | VARCHAR(500) |   否 |                           | 拒絕原因。                                                                          |
| `sort_order`          | INT          |   是 | 預設 0                    | 簽署人顯示或通知順序。                                                              |
| `created_at`          | DATETIME(6)  |   是 | INDEX                     | 指派時間。                                                                          |
| `updated_at`          | DATETIME(6)  |   是 | INDEX                     | 最近狀態更新時間。                                                                  |
| `deleted_at`          | DATETIME(6)  |   否 | INDEX                     | 僅草稿階段可軟刪除；發起簽署後不得移除。                                            |
| `created_by_user_id`  | BIGINT       |   否 | FK → `users.id`           | 指派操作人。                                                                        |
| `updated_by_user_id`  | BIGINT       |   否 | FK → `users.id`           | 最近修改者。                                                                        |

必要約束與索引：

```text
UNIQUE (document_id, user_id)
UNIQUE (document_id, email)
INDEX (user_id, status)
```

每筆簽署人必須且只能使用一種識別方式：內部員工使用 `user_id`，Email 外部簽署人使用正規化 `email`。Email 大小寫差異不得繞過同一文件內的唯一性。Stage 1 不支援手機號碼簽署人。外部簽署人的邀請、身分驗證與重放防護由後續功能規格定義，不得只依 client 宣告的 Email 完成簽署。

### 3.4 `esign_signature_records`

成功簽署後建立的不可變證據紀錄。`esign_signers` 保存目前狀態，本表保存當次實際簽署的文件摘要、同意版本與身分驗證結果。

| 欄位                      | 型別         | 必填 | 鍵值／索引                      | 說明                                                          |
| ------------------------- | ------------ | ---: | ------------------------------- | ------------------------------------------------------------- |
| `id`                      | BIGINT       |   是 | PK                              | 簽署證據流水號。                                              |
| `signer_id`               | BIGINT       |   是 | FK → `esign_signers.id`、UNIQUE | 對應簽署人；第一階段每名簽署人最多一筆成功簽署。              |
| `document_sha256`         | CHAR(64)     |   是 |                                 | 簽署時實際呈現文件位元內容的 server-side SHA-256。            |
| `signing_payload_sha256`  | CHAR(64)     |   是 | INDEX                           | 簽署時所接受 canonical signing payload 的 SHA-256。           |
| `consent_version`         | VARCHAR(50)  |   是 |                                 | 簽署意圖與電子形式告知文案版本。                              |
| `authentication_method`   | VARCHAR(50)  |   是 |                                 | 簽署前驗證方式，例如 `INTRANET_SSO`、`OIDC_MFA`、`WEBAUTHN`。 |
| `authentication_event_id` | VARCHAR(255) |   是 | UNIQUE                          | 上游或本系統產生的一次性驗證事件 ID，防止重複使用。           |
| `source_ip`               | VARCHAR(45)  |   否 |                                 | 簽署來源 IPv4／IPv6，僅作輔助證據。                           |
| `user_agent`              | VARCHAR(500) |   否 |                                 | 簽署端 user agent，僅作輔助證據。                             |
| `signed_at_utc`           | DATETIME(6)  |   是 | INDEX                           | Server 接受並完成簽署交易的 UTC 時間。                        |
| `created_at`              | DATETIME(6)  |   是 | INDEX                           | 證據紀錄建立時間，通常與 `signed_at_utc` 相同。               |

本表不提供 `updated_at`、`deleted_at`，避免一般 repository 暴露修改或軟刪除語意。

## 4. 檔案、稽核與 QR 驗證

### 4.1 `esign_file_objects`

保存 private object storage 物件 metadata。所有關聯欄位均可為 NULL，但應依 `file_purpose` 至少連結一個業務擁有者。

| 欄位                     | 型別         | 必填 | 鍵值／索引                                  | 說明                                                                                                                   |
| ------------------------ | ------------ | ---: | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`                     | BIGINT       |   是 | PK                                          | 檔案 metadata 流水號。                                                                                                 |
| `document_id`            | BIGINT       |   否 | FK → `esign_documents.id`、INDEX            | 所屬文件；跨文件清單匯出可為 NULL。                                                                                    |
| `signature_record_id`    | BIGINT       |   否 | FK → `esign_signature_records.id`、INDEX    | 所屬簽署證據，例如簽名圖或個人簽署 PDF。                                                                               |
| `verification_record_id` | BIGINT       |   否 | FK → `esign_verification_records.id`、INDEX | 所屬驗證紀錄，例如 manifest 或 QR Code。                                                                               |
| `export_job_id`          | BIGINT       |   否 | FK → `esign_export_jobs.id`、INDEX          | 產生此檔案的匯出工作。                                                                                                 |
| `file_purpose`           | VARCHAR(30)  |   是 | INDEX                                       | 用途：`source_pdf`、`signature_image`、`signer_pdf`、`completed_pdf`、`manifest`、`audit_trail`、`qr_code`、`export`。 |
| `object_key`             | VARCHAR(500) |   是 | UNIQUE                                      | Private bucket 內的物件 key；不得存永久公開 URL。                                                                      |
| `object_version`         | VARCHAR(255) |   否 |                                             | Object storage version ID。                                                                                            |
| `original_file_name`     | VARCHAR(255) |   否 |                                             | 上傳或產出時的人類可讀檔名；顯示前需處理不安全字元。                                                                   |
| `mime_type`              | VARCHAR(100) |   是 |                                             | 經 server 驗證的 MIME type，不完全信任上傳 header。                                                                    |
| `file_size`              | BIGINT       |   是 |                                             | 實際持久化物件大小，單位 bytes。                                                                                       |
| `sha256`                 | CHAR(64)     |   是 | INDEX                                       | Server 對實際持久化物件計算的 SHA-256。                                                                                |
| `archive_status`         | VARCHAR(20)  |   是 | INDEX                                       | `active`、`sealed`、`deleted`；證據檔完成後應轉為 `sealed`。                                                           |
| `created_at`             | DATETIME(6)  |   是 | INDEX                                       | 物件 metadata 建立時間。                                                                                               |

### 4.2 `esign_audit_events`

電子簽流程 append-only 稽核事件及 hash chain。事件順序以同一文件為範圍串接。

| 欄位                  | 型別         | 必填 | 鍵值／索引                       | 說明                                                                                               |
| --------------------- | ------------ | ---: | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                  | BIGINT       |   是 | PK                               | 稽核事件流水號。                                                                                   |
| `document_id`         | BIGINT       |   是 | FK → `esign_documents.id`、INDEX | 所屬文件。                                                                                         |
| `signer_id`           | BIGINT       |   否 | FK → `esign_signers.id`、INDEX   | 與特定簽署人相關時填入。                                                                           |
| `actor_user_id`       | BIGINT       |   否 | FK → `users.id`、INDEX           | 執行者；worker 或系統事件可為 NULL。                                                               |
| `event_type`          | VARCHAR(50)  |   是 | INDEX                            | 事件類型，例如 `document_created`、`signer_notified`、`signature_completed`、`document_exported`。 |
| `occurred_at`         | DATETIME(6)  |   是 | INDEX、複合 INDEX                | 業務事件實際發生時間。                                                                             |
| `previous_event_hash` | CHAR(64)     |   否 |                                  | 同文件上一筆事件 hash；第一筆為 NULL。                                                             |
| `event_hash`          | CHAR(64)     |   是 | UNIQUE                           | 對 canonical event payload 與 `previous_event_hash` 計算的 SHA-256。                               |
| `request_id`          | VARCHAR(100) |   否 | INDEX                            | 串接 API request、worker job 與結構化 log 的追蹤 ID。                                              |
| `metadata_json`       | JSON         |   否 |                                  | 依 `event_type` 白名單 schema 保存必要中繼資料，不得寫入 token、cookie、OTP、簽名圖或文件全文。    |
| `created_at`          | DATETIME(6)  |   是 | INDEX                            | 資料列實際寫入時間。                                                                               |

本表不提供 `updated_at`、`deleted_at`。建議索引：

```text
INDEX (document_id, occurred_at, id)
```

### 4.3 `esign_verification_records`

文件完成後產生的 QR Code 公開驗證紀錄。QR Code 僅包含 `/verify/{public_id}`，不直接包含完整 manifest 或簽署人個資。

| 欄位               | 型別        | 必填 | 鍵值／索引                        | 說明                                                                                                       |
| ------------------ | ----------- | ---: | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`               | BIGINT      |   是 | PK                                | 驗證紀錄流水號。                                                                                           |
| `document_id`      | BIGINT      |   是 | FK → `esign_documents.id`、UNIQUE | 第一階段每份完成文件最多一筆正式驗證紀錄。                                                                 |
| `public_id`        | CHAR(36)    |   是 | UNIQUE                            | QR Code 公開網址使用的不可預測 UUID，不使用 DB 流水號。                                                    |
| `manifest_json`    | JSON        |   是 |                                   | 完成文件的 canonical 驗證 manifest；包含 schema version、文件 hash、最終 PDF hash、簽署結果及 audit root。 |
| `manifest_sha256`  | CHAR(64)    |   是 | INDEX                             | Server 對 canonical manifest 計算的 SHA-256。                                                              |
| `final_pdf_sha256` | CHAR(64)    |   是 | INDEX                             | 寫入 object storage 的最終 PDF SHA-256。                                                                   |
| `audit_root_hash`  | CHAR(64)    |   是 |                                   | 文件最後一筆有效 audit event hash。                                                                        |
| `status`           | VARCHAR(20) |   是 | INDEX，預設 `valid`               | `valid`、`revoked`、`superseded`。                                                                         |
| `issued_at`        | DATETIME(6) |   是 | INDEX                             | QR 驗證紀錄正式生效時間。                                                                                  |
| `revoked_at`       | DATETIME(6) |   否 | INDEX                             | 驗證紀錄失效時間；僅 `status = revoked` 時填入。                                                           |
| `created_at`       | DATETIME(6) |   是 | INDEX                             | 建立時間。                                                                                                 |

除 `status`、`revoked_at` 外，其他證據欄位建立後不得修改。撤銷必須同步追加 `esign_audit_events`，不可直接刪除驗證紀錄。

## 5. 通知與匯出

### 5.1 `esign_notification_batches`

每次「通知簽署人」操作建立一筆批次，保存實際通知範圍與人數。

| 欄位                  | 型別        | 必填 | 鍵值／索引                       | 說明                                   |
| --------------------- | ----------- | ---: | -------------------------------- | -------------------------------------- |
| `id`                  | BIGINT      |   是 | PK                               | 通知批次流水號。                       |
| `document_id`         | BIGINT      |   是 | FK → `esign_documents.id`、INDEX | 被通知的文件。                         |
| `filter_type`         | VARCHAR(20) |   是 |                                  | 通知對象：`all` 或 `pending`。         |
| `target_count`        | INT         |   是 |                                  | 建立批次時實際展開的通知對象數量快照。 |
| `notified_by_user_id` | BIGINT      |   否 | FK → `users.id`                  | 手動通知操作人；自動通知可為 NULL。    |
| `created_at`          | DATETIME(6) |   是 | INDEX                            | 建立批次及排入 worker 的時間。         |

### 5.2 `esign_notification_logs`

通知批次內每名簽署人的發送結果。每個收件人、每次批次各一筆。

| 欄位           | 型別         | 必填 | 鍵值／索引                                  | 說明                                                     |
| -------------- | ------------ | ---: | ------------------------------------------- | -------------------------------------------------------- |
| `id`           | BIGINT       |   是 | PK                                          | 通知明細流水號。                                         |
| `batch_id`     | BIGINT       |   是 | FK → `esign_notification_batches.id`、INDEX | 所屬通知批次。                                           |
| `signer_id`    | BIGINT       |   是 | FK → `esign_signers.id`、INDEX              | 通知對象。                                               |
| `channel`      | VARCHAR(20)  |   是 |                                             | 通知管道，例如 `email`、`sms`、`intranet`。              |
| `result`       | VARCHAR(20)  |   是 | INDEX，預設 `pending`                       | `pending`、`success`、`fail`、`unknown`。                |
| `error_code`   | VARCHAR(100) |   否 |                                             | 發送失敗的穩定錯誤代碼，不保存包含個資的供應商完整回應。 |
| `created_at`   | DATETIME(6)  |   是 | INDEX                                       | 明細建立時間。                                           |
| `completed_at` | DATETIME(6)  |   否 | INDEX                                       | 供應商回覆成功、失敗或逾時判定時間。                     |

必要約束：

```text
UNIQUE (batch_id, signer_id, channel)
```

### 5.3 `esign_export_jobs`

PDF 或簽署紀錄清單匯出的背景工作。產出檔案透過 `esign_file_objects.export_job_id` 關聯。

| 欄位                 | 型別         | 必填 | 鍵值／索引                       | 說明                                                  |
| -------------------- | ------------ | ---: | -------------------------------- | ----------------------------------------------------- |
| `id`                 | BIGINT       |   是 | PK                               | 匯出工作流水號。                                      |
| `export_type`        | VARCHAR(30)  |   是 | INDEX                            | `signing_log_excel` 或 `signed_pdf`。                 |
| `document_id`        | BIGINT       |   否 | FK → `esign_documents.id`、INDEX | 單一文件匯出時填入；跨文件清單匯出為 NULL。           |
| `created_by_user_id` | BIGINT       |   是 | FK → `users.id`、INDEX           | 發起匯出的員工。                                      |
| `status`             | VARCHAR(20)  |   是 | INDEX，預設 `pending`            | `pending`、`processing`、`completed`、`failed`。      |
| `scope_description`  | VARCHAR(255) |   是 |                                  | 匯出範圍的人類可讀說明，不取代實際查詢條件驗證。      |
| `record_count`       | BIGINT       |   否 |                                  | 成功匯出的資料筆數；完成前可為 NULL。                 |
| `failure_code`       | VARCHAR(100) |   否 |                                  | 失敗時的穩定錯誤代碼，不保存 stack trace 或敏感資料。 |
| `created_at`         | DATETIME(6)  |   是 | INDEX                            | 建立工作時間。                                        |
| `updated_at`         | DATETIME(6)  |   是 | INDEX                            | 最近狀態更新時間。                                    |
| `completed_at`       | DATETIME(6)  |   否 | INDEX                            | 成功或失敗終止時間。                                  |

## 6. 主要查詢與權限規則

### 電子簽列表

登入者可看見自己建立或自己被指定簽署的文件：

```text
esign_documents.created_by_user_id = currentUserId
OR EXISTS esign_signers(
  document_id = esign_documents.id,
  user_id = currentUserId
)
```

### 我的電子簽

```text
esign_signers.user_id = currentUserId
```

並以 `status` 篩選待簽、已簽或已拒絕。

### 通知與匯出

第一階段只有 `esign_documents.created_by_user_id` 可對該文件發送通知、停止簽署或執行單一文件匯出。所有 server 寫入必須重新檢查此規則，不得只依賴 client 隱藏按鈕。

### QR Code 驗證

公開驗證 endpoint 以 `esign_verification_records.public_id` 查找紀錄，重新計算 `manifest_sha256`、最終 PDF hash 與 audit chain，並只回傳最小必要資訊。不得公開文件內容、完整員編、簽名圖片或未遮罩個資。

## 7. 狀態一致性

- `esign_documents.status = completed` 前，所有 `esign_signers.status` 必須為 `signed` 或 `rejected`，不得仍有 `pending`；最終 PDF、verification record 及必要 file objects 必須已成功建立，且完成結果須明確保留每位簽署人的實際終止狀態。
- `esign_signers.status = signed` 時，必須存在唯一的 `esign_signature_records`。
- `esign_signers.status = rejected` 時，`rejected_at` 必填且不得存在成功簽署紀錄。
- `esign_verification_records.status = valid` 時，`manifest_sha256`、`final_pdf_sha256` 與 `audit_root_hash` 必須可重新驗證。
- `esign_export_jobs.status = completed` 時，必須存在對應 `file_purpose = export` 的 `esign_file_objects`。
- `users.is_active = 0` 時，不得建立新 session 或完成新簽署，但既有簽署與稽核資料必須保留。
