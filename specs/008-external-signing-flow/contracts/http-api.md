# HTTP API Contract: 外部簽署流程

本文件描述 Spec 008 對外部簽署端點的新增與變更；未列出的行為沿用 Spec 003 `contracts/openapi.yaml` 與 `contracts/external-invitation.md`。所有 JSON 回應沿用統一 envelope：成功 `{ success: true, data }`，失敗 `{ success: false, error: { code, message } }`。

外部存取 cookie：`FT_ESIGN_EXTERNAL_ACCESS`，HttpOnly、SameSite=Lax、path `/api/external-signing-task`，值為邀請 token。

## 端點總覽

| Method | Path | 變更 |
|--------|------|------|
| GET | `/api/external-signature-invitations/{token}` | 只改畫面樣式 |
| POST | `/api/external-signature-session` | 已簽者可建立；新增 409 尚未開始頁；失效頁改樣式 |
| POST | `/api/external-signing-task` | 已簽者可開啟 |
| GET | `/api/external-signing-task` | **新增**：唯讀查詢，不記稽核 |
| GET | `/api/external-signing-task/source-file` | 已簽者可讀取 |
| POST | `/api/external-signing-task/signatures` | 成功不清 cookie，改設為 session cookie；重送回既有結果 |
| GET | `/api/external-signing-task/completed-file` | **新增**：下載本人副本 |
| DELETE | `/api/external-signature-session` | 不變 |

## GET /api/external-signature-invitations/{token}

- 不查 DB、不記錄、不設 cookie（不變）。
- 200 `text/html`：邀請確認頁，依設計稿 `01`／`02`。表單 `POST /api/external-signature-session`，欄位 `token`。
- 400 `text/html`：token 格式錯誤，顯示失效頁。

## POST /api/external-signature-session

Request：`application/x-www-form-urlencoded`，`token`（43 字元 base64url）。需 Origin（或 `Origin: null` 搭配 `Sec-Fetch-Site: same-origin`，不變）。

| 狀態 | 條件 | 回應 |
|------|------|------|
| 303 | 待簽者在有效簽署期間；或已簽者（不設期限） | `Set-Cookie`（待簽者 `Expires`＝`invitation_expires_at`；已簽者為 session cookie，不設 `Expires`）、`Location: /external-signatures/{signerPublicId}`；記錄 `external_invitation.opened` |
| 409 | 憑證有效、待簽、文件 active，但現在早於 `signStartAt` | `text/html` 尚未開始頁（設計稿 `04`），顯示「請於 yyyy/MM/dd HH:mm（台北時間）後簽署」；不設 cookie、不記錄 |
| 400 | token 格式錯誤 | `text/html` 失效頁 |
| 401 | 其他所有失效情況（不存在、不相符；待簽者的過期、停止、到期；簽署人或文件刪除） | `text/html` 失效頁（設計稿 `03`），不區分原因 |
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

`ESIGN_SIGNING_NOT_STARTED` 的 envelope 另帶 `details: { startAt: "ISO 8601" }`；只有持有效邀請憑證的待簽者會收到。

## 前端畫面與 API 狀態對應

| 畫面（設計稿） | 觸發條件 |
|----------------|----------|
| `01`／`02` 邀請確認頁 | GET 邀請連結 |
| `03` 失效頁 | session 401／400；前端呼叫任何外部 API 收到 401 時顯示同內容 |
| `04` 尚未開始 | session 409；前端收到 `ESIGN_SIGNING_NOT_STARTED` 時顯示 message |
| `05` 同意聲明 | 任務 `signer.status = pending`，尚未勾選同意 |
| `06`／`07` 閱讀與簽名 | 已同意聲明 |
| `08` 完成・可下載 | `signer.status = signed` 且 `completion.status = ready` |
| `09` 完成・產生中 | `completion.status` 為 `pending` 或 `processing` |
| `10` 完成・產製失敗 | `completion.status = failed` |
