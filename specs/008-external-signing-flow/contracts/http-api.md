# HTTP API Contract: 外部簽署流程

本文件描述 Spec 008 對外部簽署端點的新增與變更；未列出的行為沿用 Spec 003 `contracts/openapi.yaml` 與 `contracts/external-invitation.md`。所有 JSON 回應沿用統一 envelope：成功 `{ success: true, data }`，失敗 `{ success: false, error: { code, message } }`。

外部存取 cookie：`FT_ESIGN_EXTERNAL_ACCESS`，HttpOnly、SameSite=Lax、path `/api/external-signing-task`，值為邀請 token。

## 端點總覽

| Method | Path | 變更 |
|--------|------|------|
| GET | `/api/external-signature-invitations/{token}` | 畫面改版；表單改送 `POST /api/external-signature-otps` |
| POST | `/api/external-signature-otps` | **新增**：驗證邀請並寄出驗證碼，回驗證碼輸入頁 |
| POST | `/api/external-signature-session` | 改為以 `token`＋`code` 驗證後才建立存取；已簽者可建立；失效頁改樣式 |
| POST | `/api/external-signing-task` | 已簽者可開啟 |
| GET | `/api/external-signing-task` | **新增**：唯讀查詢，不記稽核 |
| GET | `/api/external-signing-task/source-file` | 已簽者可讀取 |
| POST | `/api/external-signing-task/signatures` | 成功不清 cookie，改設為 session cookie；重送回既有結果；body 新增必填 `signerPublicId` |
| GET | `/api/external-signing-task/completed-file` | **新增**：下載本人副本 |
| DELETE | `/api/external-signature-session` | 不變 |

## GET /api/external-signature-invitations/{token}

- 不查 DB、不記錄、不設 cookie（不變）。
- 200 `text/html`：邀請確認頁，依設計稿 `01`／`02`。表單 `POST /api/external-signature-otps`，欄位 `token`。
- 400 `text/html`：token 格式錯誤，顯示失效頁。

## POST /api/external-signature-otps（新增）

Request：`application/x-www-form-urlencoded`，`token`（43 字元 base64url）。由邀請確認頁與驗證碼輸入頁的「重新寄送」送出；需 Origin（或 `Origin: null` 搭配 `Sec-Fetch-Site: same-origin`）；套用 `AuthThrottlerGuard`；body 不進 access log。

| 狀態 | 條件 | 回應 |
|------|------|------|
| 200 | 邀請有效（待簽者在有效簽署期間，或已簽者），寄出新驗證碼 | `text/html` 驗證碼輸入頁（設計稿 `11`），顯示遮罩後的信箱、10 分鐘有效、檢查垃圾郵件提示、重新寄送按鈕；舊驗證碼失效；記錄 `external_otp.sent` |
| 409 | 待簽者早於 `signStartAt` | `text/html` 尚未開始頁（設計稿 `04`），不寄信 |
| 429 | 距上次寄送未滿 60 秒，或 1 小時內已寄滿 5 封 | `text/html` 驗證碼輸入頁並顯示可再寄送的時間，不寄信、不覆寫現有驗證碼 |
| 400／401 | token 格式錯誤／其他所有失效情況 | `text/html` 失效頁（設計稿 `03`），不寄信 |
| 503 | 寄信失敗或服務暫時無法使用 | `text/html` 可重試的說明頁，不保留驗證碼、不計入寄送次數 |

驗證碼信：主旨「電子簽署驗證碼」；內容只有 6 位數驗證碼、「10 分鐘內有效」、文件名稱與「若非本人操作請忽略」，不含任何連結。

## POST /api/external-signature-session

Request：`application/x-www-form-urlencoded`，`token`（43 字元 base64url）＋`code`（6 位數字）。由驗證碼輸入頁送出；需 Origin（同上）；套用 `AuthThrottlerGuard`；body 不進 access log。

| 狀態 | 條件 | 回應 |
|------|------|------|
| 303 | 邀請仍有效且驗證碼正確、未過期、未使用 | `Set-Cookie` session cookie（不設 `Expires`，待簽者與已簽者相同）、`Location: /external-signatures/{signerPublicId}`；刪除驗證碼挑戰；記錄 `external_otp.verified` 與 `external_invitation.opened` |
| 401 | 驗證碼錯誤（未滿 5 次） | `text/html` 驗證碼錯誤頁（設計稿 `12`），顯示剩餘次數；記錄 `external_otp.failed` |
| 401 | 驗證碼錯滿 5 次、已過期、已使用或不存在 | `text/html` 驗證碼錯誤頁，顯示「驗證碼已失效，請重新寄送」；錯滿 5 次時記錄 `external_otp.locked` 並刪除挑戰 |
| 409 | 待簽者早於 `signStartAt` | `text/html` 尚未開始頁 |
| 400 | token 或 code 格式錯誤 | `text/html` 失效頁 |
| 401 | 邀請本身失效（不存在、不相符；待簽者的過期、停止、到期；簽署人或文件刪除） | `text/html` 失效頁（設計稿 `03`），不區分原因 |
| 503 | 服務暫時無法使用 | `text/html` 服務暫停頁 |

## POST /api/external-signing-task

需 cookie 與 Origin。記錄 `document.opened`。

| 狀態 | 條件 |
|------|------|
| 200 | 待簽者在有效期間；或已簽者在期限內 |
| 401 | 失效（`ESIGN_EXTERNAL_UNAUTHORIZED`） |
| 409 | 待簽者早於開始時間（`ESIGN_SIGNING_NOT_STARTED`，message 含開始時間，`details.startAt` 為 ISO 8601） |

200 `data`（前端使用的欄位，其餘沿用現有 `SigningTask`）：

```json
{
  "signerPublicId": "uuid",
  "document": { "id": "1", "title": "供應商保密協議（NDA）", "status": "active", "signEndAt": "2026-10-31T16:00:00.000Z" },
  "signer": {
    "publicId": "uuid",
    "type": "email",
    "name": "王大明",
    "email": "daming.wang@example.com",
    "status": "pending | signed",
    "signedAt": "ISO 8601 | null",
    "completion": { "status": "pending | processing | ready | failed | null", "readyAt": "ISO 8601 | null" }
  },
  "fields": [{ "id": "10", "type": "signature | date", "page": 2, "xPercent": 10, "yPercent": 72, "widthPercent": 23.478, "heightPercent": 7.071, "sortOrder": 0 }],
  "consent": { "version": "esign-consent-v1", "text": "本人已閱讀並了解本文件內容……", "sha256": "…" }
}
```

前端依 `signer.status` 決定流程：`pending` → 同意聲明與簽署；`signed` → 完成頁，依 `signer.completion.status` 顯示副本狀態。

## GET /api/external-signing-task（新增）

- 需 cookie，不需 Origin；不記錄稽核、不寫入任何資料。
- 狀態碼與 `data` 同 `POST /api/external-signing-task`。
- 用途：完成頁在副本 `pending`／`processing` 時每 3 秒輪詢，`ready` 或 `failed` 即停止。
- Header：`Cache-Control: private, no-store`。

## GET /api/external-signing-task/source-file

- 狀態碼不變，授權改為存取檢查（已簽者在期限內也可讀取原始 PDF）。

## POST /api/external-signing-task/signatures

Request（不變）：

```json
{
  "signerPublicId": "uuid（頁面路由中的簽署人；後端與 cookie 對應的簽署人比對）",
  "requestId": "uuid（同一次送出的重試沿用同一個）",
  "consentVersion": "esign-consent-v1",
  "accepted": true,
  "signatures": [{ "fieldId": "10", "pngDataUrl": "data:image/png;base64,…" }]
}
```

| 狀態 | 條件 | 回應 |
|------|------|------|
| 201 | 首次成功簽署 | `Set-Cookie` 同 token、session cookie（不設 `Expires`）；`data` 為簽署結果（含 `completion`） |
| 200 | 同一 `requestId` 已成功（重送） | 同上，回既有結果 |
| 400 | 輸入錯誤（缺欄位、簽名格式） | envelope |
| 401 | 失效；或已簽者以新的 `requestId` 再次簽署 | envelope |
| 409 | 早於開始時間、期間外、狀態衝突 | envelope |
| 409 | `signerPublicId` 與 cookie 對應的簽署人不符 | envelope `ESIGN_EXTERNAL_SIGNER_MISMATCH`，不建立簽署 |

## GET /api/external-signing-task/completed-file（新增）

- 需 cookie，不需 Origin；不記錄稽核。
- 只回傳 cookie 所屬簽署人的個人副本，經既有完整性檢查。

| 狀態 | 條件 | 回應 |
|------|------|------|
| 200 | 已簽署且 `completion.status = ready` | `application/pdf`、`Content-Disposition: attachment; filename="completed.pdf"`、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff` |
| 401 | 失效、尚未簽署 | envelope `ESIGN_EXTERNAL_UNAUTHORIZED` |
| 409 | 副本產生中或產製失敗 | envelope `ESIGN_PERSONAL_COPY_NOT_READY` |
| 409 | 完整性驗證失敗 | envelope `ESIGN_INTEGRITY_FAILED`，不回傳檔案 |

## 新增錯誤定義

| 名稱 | Code | HTTP | 訊息 |
|------|------|------|------|
| `ESIGN_SIGNING_NOT_STARTED(startAt)` | `ESIGN_STATE_CONFLICT` | 409 | 簽署尚未開始，請於 {yyyy/MM/dd HH:mm}（台北時間）後簽署 |
| `ESIGN_EXTERNAL_SIGNER_MISMATCH` | `ESIGN_STATE_CONFLICT` | 409 | 此頁面的簽署對象已變更，請重新開啟邀請信中的連結 |

驗證碼相關的回應都是 HTML 頁面，訊息直接寫在頁面上：驗證碼錯誤「驗證碼錯誤，還可以再試 N 次」、失效「驗證碼已失效，請重新寄送」、冷卻「請於 N 秒後再重新寄送」、每小時上限「寄送次數已達上限，請於 HH:mm 後再試」、寄信失敗「驗證碼寄送失敗，請稍後再試」。

`ESIGN_SIGNING_NOT_STARTED` 的 envelope 另帶 `details: { startAt: "ISO 8601" }`；只有持有效邀請憑證的待簽者會收到。

## 前端畫面與 API 狀態對應

| 畫面（設計稿） | 觸發條件 |
|----------------|----------|
| `01`／`02` 邀請確認頁 | GET 邀請連結 |
| `03` 失效頁 | otps／session 的邀請失效 401／400；前端呼叫任何外部 API 收到 401 時顯示同內容；送出簽名收到 `ESIGN_EXTERNAL_SIGNER_MISMATCH` 時顯示其 message |
| `04` 尚未開始 | otps／session 409；前端收到 `ESIGN_SIGNING_NOT_STARTED` 時顯示 message |
| `11` 輸入驗證碼 | otps 200；429 時同頁顯示可再寄送時間 |
| `12` 驗證碼錯誤 | session 401（驗證碼錯誤、失效） |
| `05` 同意聲明 | 任務 `signer.status = pending`，尚未勾選同意 |
| `06`／`07` 閱讀與簽名 | 已同意聲明 |
| `08` 完成・可下載 | `signer.status = signed` 且 `completion.status = ready` |
| `09` 完成・產生中 | `completion.status` 為 `pending` 或 `processing` |
| `10` 完成・產製失敗 | `completion.status = failed` |
