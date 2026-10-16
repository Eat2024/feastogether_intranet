# Data Model: 簽章驗證 QR Code

## Overview

本規格不新增 table；新增一個欄位 `esign_signature_records.verification_code`（migration `1792108800000-SignatureVerificationCode`）保存簽章驗證代碼。沿用 Spec 01 的 `esign_verification_records` 作文件驗證快照。其他資料表沿用 Spec 03 定義，只讀不改。

## 1. EsignVerificationRecord（既有 `esign_verification_records`）

每份完成文件一筆的文件驗證快照，在 Spec 03 Finalize 的第二個 transaction 內寫入。只為功能上線後結案的文件建立；上線前已完成的文件不回補。

| 欄位 | 規則 |
| --- | --- |
| `document_id` | unique FK → document；保證每份文件最多一筆 |
| `public_id` | Server 產生的 UUID v4；本規格不對外使用，保留給日後文件層級驗證入口 |
| `manifest_json` | canonical manifest，格式見下方 |
| `manifest_sha256` | canonical manifest UTF-8 bytes 的 SHA-256 |
| `final_pdf_sha256` | 等於同 transaction 寫入的 `completed_pdf` file object `sha256` |
| `audit_root_hash` | 同 transaction append 的 `document.completed` 事件 `event_hash` |
| `status` | 本規格只寫 `valid`；不實作 `revoked` / `superseded` |
| `issued_at` | 等於 document `completed_at` |
| `revoked_at` | 本規格永遠為 NULL |

Repository 沿用既有 `insert`，新增依 `document_id` 查詢；不使用 `revoke`，不提供 update/delete。

### Canonical verification manifest

沿用 Spec 03 `canonicalJson`：key 以字典順序序列化；`signers` 依 signer `sort_order`、`id` 排序。

```json
{
  "schemaVersion": "esign-verification-manifest-v1",
  "document": {
    "docNumber": "uuid",
    "sourcePdfSha256": "64-hex",
    "signingPayloadSha256": "64-hex",
    "finalPdfSha256": "64-hex",
    "completedAt": "2026-10-16T08:00:00.000Z"
  },
  "signers": [
    {
      "signerPublicId": "uuid",
      "signedAt": "2026-10-16T07:30:00.000Z",
      "authenticationMethod": "employee_session",
      "consentVersion": "esign-consent-v1",
      "documentSha256": "64-hex",
      "signingPayloadSha256": "64-hex"
    }
  ],
  "auditRootHash": "64-hex"
}
```

Manifest 不含姓名、Email、員編、IP、User-Agent 或簽名圖；姓名在公開查詢時由 signer 關聯取得。

## 2. 簽章驗證代碼（`esign_signature_records.verification_code`）

| 欄位 | 規則 |
| --- | --- |
| `verification_code` | `CHAR(22)` ascii_bin、UNIQUE、可為 NULL；簽署 transaction 內以 16 bytes 隨機值的 base64url 寫入，之後不修改 |

驗證網址為 `{EXTERNAL_SIGNING_ORIGIN}/verify/{code}`，只在簽署成功後對外提供；同一簽章每次回傳相同網址。Spec 04 上線前的簽署紀錄為 NULL，不回補，也不提供驗證網址。

## 3. 既有資料的使用方式（只讀）

| 資料 | 公開查詢時的用途 |
| --- | --- |
| `esign_signers` | 由簽署紀錄的 `signer_id` 取得；`status` 必須為 `signed`；`name_snapshot` 作為回傳姓名 |
| `esign_signature_records` | 以 `verification_code` 查找；`signed_at_utc`、`authentication_method`、`document_sha256`；與快照中本人項目比對 |
| `esign_documents` | `title`、`status`、`completed_at`、`stopped_at`；draft 或已刪除視為查無 |
| `esign_file_objects` | active `completed_pdf` 的 `sha256` 必須等於快照 `final_pdf_sha256` |
| `esign_audit_events` | 從第一筆重算 hash chain，必須能到達 `audit_root_hash` |

## 4. State transitions（擴充 Spec 03）

```text
finalizing --verified final PDF（含 QR） + verification snapshot--> completed
```

其餘 Spec 03 狀態轉換不變。公開驗證不造成任何狀態轉換。

## 5. Transaction boundaries（擴充 Spec 03）

1. **Sign**: 在同一 transaction 的簽署紀錄寫入 `verification_code`；commit 後以代碼組出驗證網址回應。
2. **Finalize**: transaction 外產生的完成 PDF 包含各簽名欄位的 QR；第二個 transaction 命中 lease token 後，依序寫 completed file metadata、signers、document status、`document.completed` audit 與驗證快照，任一失敗整筆 rollback。失去 lease 的 worker 不得寫入快照。
3. **Public verification**: 只讀，不開 transaction、不 lock、不寫 audit 或任何資料；代碼格式不符時不查 DB。
