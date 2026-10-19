# HTTP Contract: 文件已到期與補簽

本文件為契約增量：已到期讀取／篩選與人工停止已實作，補簽端點及歷程擴充待 ticket 02 交付。，沿用 `/api` prefix、全域 success/error envelope 與員工 session。新錯誤需集中定義於 app-errors.ts，實作時同步 Swagger 及正式 OpenAPI。非建立人與不存在文件均沿用 404，避免洩漏存在性。

## 1. POST /api/esign/documents/{documentId}/reopenings

建立補簽紀錄。既有員工 session＋OriginGuard，僅文件建立人。

Request JSON（不接受其他可變業務欄位）：

```json
{
  "expectedSignEndAt": "2026-10-19T00:00:00.000Z",
  "signEndAt": "2026-10-26T00:00:00.000Z",
  "reason": "讓尚未完成的簽署人補簽"
}
```

兩日期均為帶明確時區、最多毫秒精度的 ISO 8601 時間；服務轉 UTC 後比對。reason trim 後 1–500 個 Unicode code points。新期限必須晚於鎖內權威時間；文件須 persisted expired 或邏輯到期的 active，且有 pending。

201 response 的 `data`：

```json
{
  "documentId": "123",
  "status": "active",
  "originalSignEndAt": "2026-10-19T00:00:00.000Z",
  "signEndAt": "2026-10-26T00:00:00.000Z",
  "isReopened": true,
  "reopenedAt": "2026-10-19T02:00:00.000Z",
  "pendingCount": 2
}
```

回傳交易結果，不在提交後依賴 PDF 讀取。不得夾帶 token、signatures 或邀請密文。此 POST 不宣稱回放同一成功回應：成功後相同 expectedSignEndAt 再送回 409；前端重新讀取確認，不以最新期限自動重試。

| 狀況 | HTTP／規劃中的錯誤識別 |
| --- | --- |
| 輸入格式／原因／新期限不合法 | 400 ESIGN_REOPEN_INPUT_INVALID |
| 無有效登入 | 401 沿用 session 錯誤 |
| Origin 不被允許 | 403 沿用 OriginGuard |
| 不存在／不是建立人 | 404 ESIGN_RESOURCE_NOT_FOUND |
| expectedSignEndAt 與當前期限不同 | 409 ESIGN_REOPEN_STALE |
| 非到期／無 pending／已停止／finalizing／已完成 | 409 ESIGN_DOCUMENT_NOT_REOPENABLE |
| 固定證據不完整或雜湊不符 | 沿用 ESIGN_INTEGRITY_FAILED 的既有狀態與格式 |

授權先於業務狀態錯誤；expected 比對先於可補簽狀態檢查。草稿當前期限為 null，不能補簽。不能提供未來開始時間、簽署人清單或文件內容。

## 2. GET /api/esign/documents/{documentId}/reopening-invitations

新端點，並非現有能力。建立人主動取得目前補簽輪的有效外部邀請；沿用 session 與 creator 權限。只讀，不產生或輪替 token、不追加業務事件、不寄信。

200 response `data` 為陣列：

```json
[
  {
    "signerPublicId": "既有簽署人公開識別",
    "invitationUrl": "https://簽署站台/api/external-signature-invitations/opaque-token",
    "expiresAt": "2026-10-26T00:00:00.000Z"
  }
]
```

URL 沿用 EXTERNAL_SIGNING_ORIGIN 與既有 `/api/external-signature-invitations/:token` 橋接格式。僅回傳當前 isReopened=true、有效 active、pending email signer 的有效新邀請；沒有符合資料（包含已到期／停止／完成或尚未補簽）回 `[]`。不回傳 Email、姓名或密文；建立人可用 signerPublicId 對應既有詳情。

401／404 同前述授權規則。若應有有效邀請卻缺少／無法解密密文，回服務錯誤且不得假裝成功空陣列或重建憑證。加 `Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`；回應不進入 access/application logs、analytics 或一般頁面 props，僅供建立人主動複製。沿用受控同源讀取邊界，不開放跨域。

## 3. 既有讀取契約增量

- 文件 status enum 及 query filter 增加 `expired`；保留 finalizing。
- 文件列表／建立人詳情／內部與外部簽署任務摘要都回 `signEndAt`（有效期限）、`originalSignEndAt`（原期限）、`isReopened`。沿用 signStartAt 原值，不改成補簽生效時間。
- 篩選依有效狀態：worker 延遲時 `status=expired` 包含已過期限的 active，`status=active` 排除它們；統一同一 request 的 now。
- 內部 pending 待簽列表包含 expired；詳情可呈現等待補簽，實際開啟簽署與來源檔案仍沿用資格限制。外部舊邀請到期／輪替後直接失效，不為其新增未授權詳情入口。
- 補簽輪的 `invitationDelivery` 為 null，表示本輪未自動寄送，不沿用初次發起的舊 log。
- 歷程仍用 `GET /api/esign/documents/{id}/history`：新增 expired/reopened 事件；建立人補簽項目追加 `actorUserId`、`previousSignEndAt`、`signEndAt`，保留 type/occurredAt/actor/reason。簽署人補簽項目只回 type/occurredAt/signEndAt，省略 reason、actor、actorUserId、previousSignEndAt。不直接序列化 audit entity。
- 簽署提交結果的 documentStatus 同樣使用有效狀態，不能因合法重送讀到尚未落盤的 active 而與列表矛盾。

## 4. 前端獨立 PR 銜接

沿用 ResignButton 的對話框外觀，移除未來開始日；提交目前讀到的 signEndAt 作為 expectedSignEndAt，不以瀏覽器時鐘自行決定後端狀態。API 回日期為 ISO，顯示使用既有台北時區日期工具；不得直接把 YYYY/MM/DD 當 UTC。只有新截止時間與原因可編輯。

成功後重新讀取文件／待簽／歷程，必要時由建立人主動取得外部新邀請。409 顯示「文件狀態已變更，請重新確認」，重新讀取但不自動再送。停止仍不可恢復。已到期列表不提供簽署送出；補簽標記只在 active 且 isReopened 時顯示為「補簽中」，其餘狀態仍以文件狀態為主。

本次後端計畫不將 mock store 擴寫為正式資料來源，也不順便實作整個 client API 串接。
