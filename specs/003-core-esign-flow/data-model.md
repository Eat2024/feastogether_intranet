# Data Model: 核心電子簽端到端流程

## Overview

Spec 03 沿用 Spec 01 建立的電子簽 schema，不建平行文件或證據表。Migration 只補上多人欄位歸屬、外部 invitation lifecycle、簽名檔案對應與 invitation outbox retry 所需欄位。關係資料以 MySQL 為權威；實際 PDF/PNG bytes 在 local/test/UAT 位於私有 persistent volume，production 位於私有 S3。

## 1. EsignDocument（既有 `esign_documents`）

| 欄位 | 規則 |
| --- | --- |
| `id` | BIGINT PK，API 內部 resource id |
| `doc_number` | UUID，unique，建立時由 Server 產生 |
| `title` | 1–200 字；只能在 draft 修改 |
| `status` | `draft \| active \| finalizing \| completed \| stopped` |
| `created_by_user_id` | FK → active `users.id`；草稿與 creator view 的授權源 |
| `sign_start_at` | UTC；發起時固定，必須早於 `sign_end_at` |
| `sign_end_at` | UTC；發起後不可變 |
| `signing_payload_json` | 發起當下的 canonical payload；不含 token、cookie 或簽名 bytes |
| `signing_payload_sha256` | canonical UTF-8 JSON 的 SHA-256 |
| `allow_reject` / `watermark_enabled` | Spec 03 建檔固定為 false，不接受 Client 改寫 |
| `initiated_at` | 發起 transaction 的 Server UTC |
| `completed_at` | final PDF 驗證並保存後的 Server UTC |
| `stopped_at` / `stop_reason` | 手動或到期停止時寫入；不刪原資料 |
| `finalization_lease_token` | 新增 nullable UUID；worker claim 時產生，完成/失敗必須以此值作 CAS fencing |
| `finalization_lease_expires_at` | 新增 nullable UTC；過期才可被新 worker 回收與替換 token |

### Canonical signing payload

Key 以穩定順序序列化，array 以穩定 id/sort order 排序：

```json
{
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
| `completion_receipt_sha256` | external signer 簽署成功時生成；只授權終止狀態與 completed PDF |
| `completion_receipt_expires_at` | 簽署時為 null，不會在 finalization 前過期；completed/stopped 時由同一 transaction 設為終止時間 + 30 日 |

Existing unique constraints 維持：

- `(document_id, user_id)` 保證同一內部員工不重複。
- `(document_id, email)` 保證同一 normalized external Email 不重複。
- Service 額外拒絕同一自然人被同時以 internal/email 加入的明顯歧義，不自動合併身分。

## 3. EsignDocumentField（既有 `esign_document_fields`）

| 欄位 | 規則 |
| --- | --- |
| `id` | BIGINT PK |
| `document_id` | FK → document |
| `signer_id` | 新增 nullable FK → signer；發起前必須 non-null 且 signer.document_id 相同 |
| `field_type` | `signature \| date` |
| `page_number` | 1 至 source PDF page count；Spec 03 不另外生成系統確認頁 |
| `x_percent` / `y_percent` | `0 <= value < 100` |
| `width_percent` / `height_percent` | `0 < value <= 100`，且 x + width / y + height 不超出頁面 |
| `sort_order` | 同 signer 顯示與 canonical payload 的穩定排序 |

發起不變量：每名 signer 至少有一個 `signature` field；date field 可選，但一律由 Server 填入。

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
| owner FK | source/final PDF 綁 `document_id`；signature PNG 綁 `signature_record_id` |
| `document_field_id` | 新增 nullable FK → field；signature PNG 必填以對應指定欄位 |
| `file_purpose` | `source_pdf \| signature_png \| completed_pdf` |
| `object_key` | server-generated，unique，不使用上傳 filename/email/user id |
| `object_version` | local volume 為 null；S3 保存 write response 的 `VersionId`（若 bucket 未啟用 versioning 則為 null） |
| `original_file_name` | 只對 source PDF 保留裁切 basename，不作路徑 |
| `mime_type` | source/final: `application/pdf`；signature: `image/png` |
| `file_size` / `sha256` | 以實際 persisted bytes 計算 |
| `archive_status` | Spec 03 只寫 `active` |

Additional unique indexes：

- `(document_id, file_purpose)` 對 `source_pdf` / `completed_pdf` 只能各有一筆 active object（以 service + migration 支援的 generated key/constraint 實作）。
- `(signature_record_id, document_field_id, file_purpose)` 保證同一簽署證據每欄位只有一張 signature PNG。

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
- `document.finalization_failed`
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
- `esign-document-finalization` job data：僅 `documentId`；DB lease token 不放 job data，由 processor claim 時新建。
- `esign-maintenance`：以固定 scheduler ID `esign-maintenance:30s` 註冊，job 無敏感 payload。
- Queue job ID、attempts、delay 或完成狀態不是業務證據；MySQL document/signer/notification state 仍是唯一權威。
- 不使用固定 business-key `jobId` 去重。Reconciliation 可能重複 enqueue，由 DB CAS/unique/lease 保證 no-op 或唯一結果。

## 8. Private file object（local volume / production S3）

Logical key 格式：

```text
documents/<document-public-uuid>/source/<random>.pdf
documents/<document-public-uuid>/signatures/<signer-public-uuid>/<field-id>/<random>.png
documents/<document-public-uuid>/completed/<random>.pdf
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
active --all signed / worker claim--> finalizing
finalizing --verified final PDF--> completed
finalizing --generation/save failure--> active
finalizing --stale lease recovery----> active
active --creator stop---------------> stopped
active --deadline + pending---------> stopped
```

Forbidden：

- `active/finalizing/completed/stopped -> draft`
- `completed -> stopped`
- 任何發起後的 title/source/signer/field/period/options mutation
- soft-delete 非 draft

### Signer

```text
pending --valid signature transaction--> signed
```

`signed` 無回退、更新、刪除或複製到新文件的路徑。

### External invitation access

```text
pending delivery -> delivered -> reusable access
reusable access --signer signed/document stopped/document completed/deadline--> invalid
signer signed --issue document-scoped receipt--> read-only terminal status/completed PDF access
```

Invitation token 開啟次數不改變可用性；每次開啟只 append audit。
Receipt 以 signer public ID 與 path-scoped cookie 區隔，可同時保留多份文件；不可用於原 PDF、簽署寫入、其他文件或內部功能，文件完成或停止 30 日後失效且不復原。

## 10. Transaction boundaries

1. **Create/update draft**: DB resource authorization + draft conditional write；file replacement 先持久化新 object，transaction 內 hard-delete 舊 source metadata 並寫新 metadata，commit 後才刪舊 bytes。此 hard-delete 僅限尚未發起、尚未形成證據的 draft source；發起後永不使用此路徑。
2. **Initiate**: document/signer/field locks + source hash verify + payload snapshot/hash + invitation/outbox + audit + active transition；commit 後 best-effort enqueue outbox IDs，失敗不回滾已 commit 文件，由 maintenance reconciliation 補入列。
3. **Sign**: document/signer locks + expiry/hash/consent/field validation + signature record/files metadata + signer signed + audits；external signer 同 transaction 寫入 receipt digest。實際 PNG 寫入失敗時不開 transaction；DB rollback 後嘗試清理新 object。Commit 後若全員已簽則 best-effort enqueue document ID，失敗由 maintenance reconciliation 補入列。
4. **Stop/expire**: document lock + status/time re-check + stopped fields + audit。
5. **Finalize**: BullMQ processor 的短 transaction 以新 UUID claim `active -> finalizing`；transaction 外產檔；第二個 transaction 重驗 hashes/state 且必須命中同一 lease token 才能寫 completed file metadata/audit/status。舊 worker 在 lease 被回收後所產生的檔案只能清理，不能改狀態；BullMQ retry 或重複 job 不能跳過此 claim/CAS。
6. **Maintenance reconciliation**: BullMQ scheduler 每 30 秒喚醒 processor；processor 分批查詢可寄送 invitation outbox、全員已簽 active document、過期 finalizing lease 與 deadline 已到的 active document，前兩者 enqueue 到專用 queue，後兩者依 DB lock/state 處理。Redis outage 恢復後以 MySQL 現況收斂，不從 queue state反推業務狀態。
