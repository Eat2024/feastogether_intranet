# Data Model: 核心電子簽端到端流程

> **Spec 007 更新（2026-10-19）**：以下到期永久停止與補簽範圍外的記載為舊版決策，現由 Spec 007 取代。到期改為 expired，不填停止原因；人工停止維持永久 stopped。原始期限在固定 payload，sign_end_at 為有效期限；已簽證據及個人副本保留。補簽 API 與建立人取得新邀請端點已由 Spec 007 交付，沿用原證據且不自動寄信；前端正式串接另行交付。

## Overview

Spec 03 沿用 Spec 01 建立的電子簽 schema，不建平行文件或證據表。2026-10-16 修訂將欄位改為文件共用、完成檔改由個人簽署證據擁有；在既有 signer 增加產製狀態與 lease，不新增資料表。以下為目標模型，尚未套用 migration。關係資料以 MySQL 為權威；實際 PDF/PNG bytes 在 local/test/UAT 位於私有 persistent volume，production 位於私有 S3。

## 1. EsignDocument（既有 `esign_documents`）

| 欄位 | 規則 |
| --- | --- |
| `id` | BIGINT PK，API 內部 resource id |
| `doc_number` | UUID，unique，建立時由 Server 產生 |
| `title` | 1–200 字；只能在 draft 修改 |
| `status` | `draft \| active \| expired \| finalizing \| completed \| stopped` |
| `created_by_user_id` | FK → active `users.id`；草稿與 creator view 的授權源 |
| `sign_start_at` | UTC；發起時固定，必須早於 `sign_end_at` |
| `sign_end_at` | UTC；發起後不可變 |
| `signing_payload_json` | 發起當下的 canonical payload；不含 token、cookie 或簽名 bytes |
| `signing_payload_sha256` | canonical UTF-8 JSON 的 SHA-256 |
| `allow_reject` / `watermark_enabled` | 建立草稿時為 false；發起時由 initiation API 的 `allowReject`、`watermark` 寫入，並納入 canonical payload 的 `options` |
| `initiated_at` | 發起 transaction 的 Server UTC |
| `completed_at` | 所有個人副本與結案 snapshot 驗證並保存後的 Server UTC |
| `stopped_at` / `stop_reason` | 僅人工停止時寫入；舊版到期停止資料保留；不刪原資料 |
| `finalization_lease_token` | 舊 document lease 退役；新產製 lease 位於 signer |
| `finalization_lease_expires_at` | 隨舊 document lease 退役 |

### Canonical signing payload

Key 以穩定順序序列化，array 以穩定 id/sort order 排序：

```json
{
  "schemaVersion": 2,
  "document": {
    "id": "123",
    "docNumber": "uuid",
    "title": "文件名稱",
    "sourceFileSha256": "64-hex"
  },
  "period": {
    "startAt": "2026-10-13T00:00:00.000Z",
    "endAt": "2026-10-20T15:59:59.999Z"
  },
  "consent": {
    "version": "esign-consent-v1",
    "sha256": "64-hex"
  },
  "options": {
    "parallelSigning": true,
    "allowReject": false,
    "watermark": false
  },
  "signers": [],
  "fields": []
}
```

`fields` 保存共用 field ID/type/page/位置/sortOrder，不含 signerId；`schemaVersion: 2` 只用於新發起 payload，禁止重算歷史值。

`signers` 只包含發起 snapshot 與 signer type；外部 Email 可包含 normalized address，不含 invitation token/digest。

## 2. EsignSigner（既有 `esign_signers`）

| 欄位 | 規則 |
| --- | --- |
| `id` | BIGINT PK |
| `public_id` | 新增 UUID v4，unique，對 Client URL/DTO 使用，不是授權憑證 |
| `document_id` | FK → document |
| `signer_type` | `user \| email` |
| `user_id` / `email` | 沿用 check constraint 保證二選一；email 先 trim + lowercase |
| `empid_snapshot` | internal 必填；external 為 null |
| `name_snapshot` | 發起時固定 |
| `department_snapshot` / `title_snapshot` | internal 發起時由 User profile 固定 |
| `status` | `pending \| signed`；Spec 03 不產生 rejected |
| `signed_at` | 與 signature record `signed_at_utc` 同一 Server time |
| `invitation_token_sha256` | email signer 發起時必填，ASCII 64 hex；internal 為 null |
| `invitation_token_ciphertext` | 僅待寄送/重試期間存 AES-256-GCM payload；寄送成功後清除 |
| `invitation_expires_at` | `min(document.sign_end_at, invitation policy deadline)`；第一版等於 document deadline |
| `invitation_delivered_at` | SMTP 成功接受後的 UTC |
| `completion_receipt_sha256` / `completion_receipt_expires_at` | 新流程退役，不再核發 receipt；舊資料相容不列入此次驗收 |

個人副本新增欄位：

| 欄位 | 規則 |
| --- | --- |
| `completion_status` | nullable varchar；未簽為 NULL；signed 後為 pending／processing／ready／failed |
| `completion_lease_token` / `completion_lease_expires_at` | nullable UUID／UTC；processing 必填，5 分鐘；claim 時新建，commit/release 依 token CAS |
| `completion_ready_at` | nullable UTC；成功保存本人 PDF 後設定，不是 document.completed_at |

增加 status/lease 掃描索引與狀態 check：未簽不得產製，ready 必須有 ready_at 且無 lease，processing 必須有 lease。有效完成檔由 record 唯一鍵查詢，不再重複保存 signer.completed_file_id。

Existing unique constraints 維持：

- `(document_id, user_id)` 保證同一內部員工不重複。
- `(document_id, email)` 保證同一 normalized external Email 不重複。
- Service 額外拒絕同一自然人被同時以 internal/email 加入的明顯歧義，不自動合併身分。

## 3. EsignDocumentField（既有 `esign_document_fields`）

| 欄位 | 規則 |
| --- | --- |
| `id` | BIGINT PK |
| `document_id` | FK → document |
| `signer_id` | 移除欄位、FK 及相關索引；共用欄位只屬於 document，草稿更換名單不更動欄位 |
| `field_type` | `signature \| date` |
| `page_number` | 1 至 source PDF page count；Spec 03 不另外生成系統確認頁 |
| `x_percent` / `y_percent` | `0 <= value < 100` |
| `width_percent` / `height_percent` | `0 < value <= 100`，且 x + width / y + height 不超出頁面 |
| `sort_order` | 同 document 顯示與 canonical payload 的穩定排序 |

發起不變量：文件至少有 1 名 signer、不設人數上限、1–200 個共用欄位且至少一個 signature field；每人須完成全部共用 signature fields。Date 可選，以本人 signed_at_utc 填入。

## 4. EsignSignatureRecord（既有 `esign_signature_records`）

| 欄位 | 規則 |
| --- | --- |
| `signer_id` | unique FK，保證每人每文件最多一筆成功證據 |
| `document_sha256` | 提交時重算的 persisted source PDF hash |
| `signing_payload_sha256` | 提交時重算，並與 document 固定值相等 |
| `consent_version` | 必須等於固定 payload 版本 |
| `authentication_method` | `employee_session \| email_invitation` |
| `authentication_event_id` | unique；由 Server 以 principal kind/id + request ID 建立，不接受 Client 伪造身分 |
| `source_ip` / `user_agent` | 窄化、限長度後保存；不作唯一身分證明 |
| `signed_at_utc` | Server 成功接受時間，同時驅動全部 date field |

此 entity/repository 維持 append-only，不提供 save/update/delete/soft-delete。

## 5. EsignFileObject（既有 `esign_file_objects`）

| 欄位 | 規則 |
| --- | --- |
| owner FK | source PDF 綁 `document_id`；個人 completed_pdf 與 signature_png 綁 `signature_record_id` 且 document_id 為 NULL；文件層級 completed_pdf 綁 `document_id` 且 signature_record_id 為 NULL。個人產物的文件由 record → signer → document 推導 |
| `document_field_id` | 新增 nullable FK → field；signature PNG 必填以對應指定欄位 |
| `file_purpose` | `source_pdf \| signature_png \| completed_pdf` |
| `object_key` | server-generated，unique，不使用上傳 filename/email/user id |
| `object_version` | local volume 為 null；S3 保存 write response 的 `VersionId`（若 bucket 未啟用 versioning 則為 null） |
| `original_file_name` | 只對 source PDF 保留裁切 basename，不作路徑 |
| `mime_type` | source/final: `application/pdf`；signature: `image/png` |
| `file_size` / `sha256` | 以實際 persisted bytes 計算 |
| `archive_status` | Spec 03 只寫 `active` |

Additional unique indexes：

- 保留 `(document_id, file_purpose)`，source_pdf 必須 document_id non-null 且 signature_record_id null，維持每文件一份原檔，並允許每文件最多一份文件層級 completed_pdf；兩種 file_purpose 各自計數。
- 新增 nullable generated `completed_signature_record_id = CASE WHEN file_purpose = 'completed_pdf' THEN signature_record_id ELSE NULL END` 並建立 unique，保證每個 record 最多一份完成檔。此 computed 欄位同步 schema/entity metadata，不接受應用寫入。
- completed_pdf check：`(document_id IS NOT NULL AND signature_record_id IS NULL) OR (document_id IS NULL AND signature_record_id IS NOT NULL)`；document_field_id、verification_record_id、export_job_id 均為 NULL。必須恰有一種歸屬，同時填兩者或兩者皆空均拒絕。
- signature_png 必須 record + field，service 重驗 field 與 record 的 document 相符。不得依靠含 NULL 的三欄 unique 保證 completed_pdf 唯一。
- 文件層級唯一性由 `(document_id, file_purpose)` 保證；個人層級唯一性由 generated completed_signature_record_id 保證。同一 document 可表示一份文件層級完成檔及多人的個人完成檔，DB 表示能力不等於本次同時產製兩種結果。
- `assertFileIntegrity` 按檔案用途與歸屬驗證：本次個人下載必須逐層檢查 record/signer/document，不能只比 document_id，亦不得回退讀取文件層級完成檔。
- `(signature_record_id, document_field_id, file_purpose)` 保證同一簽署證據每欄位只有一張 signature PNG。

一份實體完成 PDF 對應一筆檔案 metadata，不將此表當成 document/signature 的多對多關聯表。未來簽到表可用文件層級 completed_pdf，包含哪些 signature records 由其結案 manifest 固定；本次不新增簽到表類型欄位、排版器、產製服務或 API，亦不改變每人一份副本的驗收條件。

### 歸屬對照範例（FR-038）

假設文件 D 有 10 位簽署人，成功證據為 R1～R10：

- 個人副本 F1～F10 各自保存 `signature_record_id = Ri`、`document_id = NULL`；透過 record → signer → document 回到同一個 D，不建立額外 document。
- 未來簽到表共用檔 F 保存 `document_id = D`、`signature_record_id = NULL`；manifest 固定實際納入的 R1～R10 與完成檔摘要，不為每人重複插入同一檔案。
- owner 表示檔案歸屬，不等於 PDF 參與人清單。這不是直接的多對多關聯表；未來若需要任意證據與任意檔案的可查詢多對多關係，須另訂需求與模型。

## 6. EsignAuditEvent（既有 `esign_audit_events`）

Spec 03 event types：

- `document.created`
- `document.draft_updated`
- `signer.assigned`
- `document.initiated`
- `document.opened`
- `external_invitation.delivered`
- `external_invitation.opened`
- `consent.accepted`
- `signature.submitted`
- `signature.completed`
- `signer.copy_failed`
- `signer.copy_completed`
- `document.completed`
- `document.stopped_by_creator`
- `document.stopped_by_deadline`

`previous_event_hash` + canonical event bytes 生成 `event_hash`。Canonical bytes 固定為 UTF-8 JSON，key 依字典順序，time 為 UTC ISO-8601，只包含 document/signer/actor local ID、event type、occurred time、request ID、裁切 metadata 與 previous hash。所有 append（含第一筆與 worker/mail path）先 lock 穩定的 document row，再讀最後 event，因此空 chain 也可序列化。Metadata 不放 PDF/PNG、cookie、token、完整 Email/IP/User-Agent 或 session 內容。

## 7. Invitation outbox（沿用 notification tables）

### EsignNotificationBatch

- `filter_type = external_invitation`
- 每次 document initiation 最多一筆 batch。
- `target_count` 等於 external signer 數量。
- `notified_by_user_id` 為 creator。

### EsignNotificationLog

| 欄位 | 規則 |
| --- | --- |
| `channel` | 固定 `email` |
| `result` | `pending \| processing \| delivered \| failed` |
| `error_code` | 穩定非敏感錯誤類別，不放 SMTP/SES response、body 或 address |
| `attempt_count` | 新增，每次 claim 原子 +1 |
| `next_attempt_at` | 新增，有上限指數 backoff |
| `processing_started_at` | 新增，超時可回收為 failed |
| `completed_at` | delivered 時寫入 |

BullMQ invitation processor 只接收 `notificationLogId`，先以 MySQL CAS claim log，送出前才從 signer 解密 token；成功後同 transaction 設 delivered、寫 `invitation_delivered_at`、清空 ciphertext 並 append audit。已清空 ciphertext 的 delivered log 不可被當成催簽重送。重複 BullMQ job 因 claim/result state 成為 no-op。

### BullMQ operational state（不新增業務 table）

- `esign-external-invitation` job data：僅 `notificationLogId`。
- `esign-document-finalization` job data：僅 `{documentId, signerId}`；DB lease token 不放 job data，由 processor claim 時新建。
- `esign-maintenance`：以固定 scheduler ID `esign-maintenance:30s` 註冊，job 無敏感 payload。
- Queue job ID、attempts、delay 或完成狀態不是業務證據；MySQL document/signer/notification state 仍是唯一權威。
- 不使用固定 business-key `jobId` 去重。Reconciliation 可能重複 enqueue，由 DB CAS/unique/lease 保證 no-op 或唯一結果。

## 8. Private file object（local volume / production S3）

Logical key 格式：

```text
documents/<document-public-uuid>/source/<random>.pdf
documents/<document-public-uuid>/signatures/<signer-public-uuid>/<field-id>/<random>.png
documents/<document-public-uuid>/completed/<signer-public-uuid>/<random>.pdf
```

- Key 只能由 Server 建立且不可覆寫；local adapter resolve 後必須確認仍在 `ESIGN_STORAGE_ROOT` 內。
- 權限不寫在 key；每次讀取仍以 DB resource relation 驗證。
- local/test/UAT 使用 local adapter；HTTP/worker 的 storage root 必須是同一、跨重啟保留的 persistent volume，不滿足時啟動 fail fast。
- production 使用 private S3 adapter；bucket 必須啟用 Block Public Access，應用程式 IAM role 只授權必要 bucket/prefix，`VersionId`（若有）寫入 `object_version`。
- DB 不保存 bucket URL 或 presigned URL；下載只由完成 resource authorization 的 API stream 提供。
- production 的 S3 driver、bucket、region 或權限缺失時 fail closed，不 fallback 到 local filesystem。

## 9. State transitions

### Document

```text
draft --initiate--> active
draft --delete----> soft-deleted
active --last successful signature--> finalizing
finalizing --all personal PDFs ready + snapshot saved--> completed
active/expired/finalizing --creator stop--> stopped
active --deadline + pending signer--> expired
```

個人產製不改 document 狀態；failed/retry 不把 finalizing 改回 active。Stopped 可產製既有成功簽署的副本但永不轉 completed。所有發起後的 source/title/signer/field/period/options 均不可修改。

### Signer 與個人副本

```text
signer: pending --valid signature transaction--> signed
copy: NULL --same signature transaction--> pending
pending/failed --claim with new lease--> processing
processing --persist + verify + same lease commit--> ready
processing --failure with same lease--> failed
processing --expired lease--> processing (new lease fences old worker)
```

Signed 不回退；ready 不覆寫、不重新產製。個人 ready commit 與整體結案使用分開的短交易，結案 snapshot 失敗不回滾 ready，maintenance 可重試結案。

### External invitation access

Pending invitation 在有效期間可重開；signed/stopped/deadline 立即失效。新流程不核發 receipt、不提供 external-completions 下載；當次簽署成功回應仍可回 Spec 04 的 verificationUrl，不授予檔案權限。

## 10. Transaction boundaries

1. **Create/update draft**: DB resource authorization + draft conditional write；file replacement 先持久化新 object，transaction 內 hard-delete 舊 source metadata 並寫新 metadata，commit 後才刪舊 bytes。此 hard-delete 僅限尚未發起、尚未形成證據的 draft source；發起後永不使用此路徑。
2. **Initiate**: document/signer/field locks + source hash verify + payload snapshot/hash + invitation/outbox + audit + active transition；commit 後 best-effort enqueue outbox IDs，失敗不回滾已 commit 文件，由 maintenance reconciliation 補入列。
3. **Sign**: 固定 document → signer lock 順序，驗身分、期限、source/payload/consent 與共用欄位；寫 record、本人 PNG metadata、signed、completion pending 及 audit。最後一人使 document 進入 finalizing。Commit 後每次 enqueue signer；失敗由 DB 狀態 reconciliation 補回。不再寫 receipt。
4. **Stop/expire**: document lock 下重驗狀態；手動可停 active/expired/finalizing，到期只將仍有 pending signer 的 active 文件轉為 expired。不得停止已 completed 或刪除個人產物。
5. **Personal PDF**: 短交易按 document → signer lock claim；交易外產檔；第二短交易重驗 token/source/payload/record/file，寫 metadata + ready + signer.copy_completed。舊 worker 失去 lease 只能清理自己的暫存輸出。失敗只改本人 failed，不影響其他副本。
6. **Aggregate finalization**: 個人 ready commit 後另開短交易鎖 document，確認所有 signer signed/ready，驗每份檔案摘要與歸屬，保存 manifest v2、document.completed audit、snapshot 與 completed。Stopped 不結案；重複提交 no-op。
7. **Maintenance**: 沿用 30 秒 scheduler，補入 invitation、signed 且副本未 ready 的 signer（含 stopped）、回收 stale signer lease，並重試所有副本 ready 的 finalizing 文件結案。Queue payload 只傳非敏感 ID，不依賴固定 jobId。

## 11. Spec 04 結案 snapshot

保留 `esign_verification_records` 的 document unique。`manifest_json` v2 逐人保存 signatureRecordId、completedFileId、completedPdfSha256、copyCompletedEventHash；本人的 QR code 綁同一 record。`final_pdf_sha256` 改 nullable，新 snapshot 為 NULL，不拿任一個人的 hash 代表全體。Audit root 仍為 document.completed，驗證鏈包含各人的 copy_completed 事件。

公開查詢依 verificationCode → record → signer 選本人副本與 manifest 項目，比對原檔、固定參數、record、個人產物及 audit；已結案才回本人 completedPdfSha256，未結案/停止維持 null。內部下載 ready 個人檔仍須檢查 persisted bytes hash，不要求整體結案。

## 12. Migration 與大量名單

新增 incremental migration 同步 entities、兩份 schema SQL 與資料字典，不新增表、不修改已套用 migration。使用者確認舊資料皆為單人，不再以存在非草稿資料阻擋部署，不實作舊多人合簽相容。可將既有單人完成檔 metadata 對應唯一 record 並回填 ready；PDF bytes、hash、原 payload／snapshot 不重算。舊資料回放與 QR／receipt 相容不列入本次驗收。回滾僅於獨立測試 DB 驗證，不刪除新簽署證據以回復舊限制。

Signer 不設每文件筆數限制，仍保留文件內 user/email 唯一鍵。完整名單與 snapshots 在 initiation 同一交易保存，可分批查詢及寫入，不能部分 active。簽署完成判斷與 ready 判斷使用聚合／EXISTS；維護掃描按穩定游標分批涵蓋全部符合資格的 signer。6,000 人與 6,001 人驗收不得因單批大小、名單頁數、SQL 參數或傳輸大小而靜默截斷。

## Spec 007 補簽增量

已到期或邏輯到期的 active 可由建立人以 expectedSignEndAt、新期限與原因重新開放。document → notification logs → signers 的鎖內比對防止跨輪重送，追加 document.reopened 稽核；原 payload/hash 與已簽副本不變。pending email signer 取得新密文、digest 與新期限，未 delivered 的舊通知退休為 INVITATION_SUPERSEDED，scanner/worker 不再使用。新一輪只由建立人主動取得邀請，無新通知批次。
