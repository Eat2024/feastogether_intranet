# Spec 009：簽署人管理契約草案

此文件為 Spec 009 簽署人管理契約；Ticket 01、03–06 已實作，整體交付驗證依 implementation-notes.md；沿用既有 `/api`、回應 envelope、員工 session 與寫入來源驗證。本階段催簽僅支援外部 Email 簽署人；內部同事催簽留待後續規格。新增寫入使用 requestId（UUID）識別同次操作；相同 requestId 不同內容回409，錯誤碼由 AppErrors 集中管理。

本文件對應 [主規格 US4–US6、FR-022–041](../spec.md)。外部限定只適用催簽；內外部名單、拒簽與備註仍依各自權限支援。

## 1. 讀取管理名單

沿用 `GET /api/esign/documents/{documentId}` 的 `signers`，不為相同頁面另建重複名單入口。建立人視角每人至少提供：

- `publicId`、`type`、`name` 與既有必要身分欄位。
- `status: pending | signed | rejected`。
- `signedAt: string | null`：沿用既有成功簽署時間。
- `rejectedAt: string | null`：拒簽時間。
- `rejectReason: string | null`：非拒簽為 null；已拒但未填原因為空字串。
- `note: string`：管理備註，未設定為空字串。
- 通知摘要：區分邀請與催簽、最近結果及已寄出催簽次數，欄位為 `latestInvitation`、`latestReminder`（各含 status/completedAt/reasonCode）、`deliveredReminderCount`、`reminderEligibility`（eligible/reasonCode/nextEligibleAt）。

時間以帶明確時區的 ISO 時間表示，畫面轉台北時間。此組管理欄位不得原樣供應給本人簽署頁；原有 `invitationDelivery` 不能當作完整通知歷史。

## 2. 儲存管理備註

`PATCH /api/esign/documents/{documentId}/signers/{signerPublicId}/note`。

```json
{ "note": "已聯繫，待本人完成" }
```

後端驗證建立人、文件與簽署人歸屬；trim 後 0–30 個 Unicode code points。空字串清除，拒絕 null、非字串及超長值。成功回應 data：

```json
{ "signerPublicId": "<簽署人公開識別>", "note": "已聯繫，待本人完成" }
```

只更新管理備註，不更新名單、拒簽原因或簽署證據。跨文件或非建立人沿用隱藏資源存在性的錯誤規則。

## 3. 建立一批催簽

`POST /api/esign/documents/{documentId}/notification-batches`。

單人與多人共用 selected；單人只傳一個識別：

```json
{
  "requestId": "<UUID>",
  "selection": "selected",
  "signerPublicIds": ["<簽署人公開識別 A>", "<簽署人公開識別 B>"]
}
```

通知所有符合資格的外部未簽者：

```json
{ "requestId": "<UUID>", "selection": "all_pending" }
```

- `selected` 名單不可空；相同識別去重。`all_pending` 在本規格明確限定外部 Email 簽署人，由後端選出完整符合資格名單，不接受只代表當前頁的資料，也不與指定名單混用。
- 前端「通知所有待簽外部簽署人」的按鈕說明與人數只涵蓋外部對象；指定名單中的內部員工回報本階段未支援，不寄信、不計入成功數。未來納入內部員工時須由後續規格明確修訂 `all_pending` 語意，不默默擴張。
- 不接受前端指定的收件 Email、姓名、任意郵件內容或邀請憑證；後端查詢權威資料。
- 寫入通知批次、操作者與逐人明細後才受理背景寄送。同次申請的重送需可辨識，以 documentId＋操作者＋requestId 的唯一鍵及正規化 payload hash 驗證，不新增通用防重框架。
- 成功回 `202 Accepted`，data 含 `batchId`、`status`、`selectedCount`、`queuedCount`、`notSentCount`。這是已受理，不是全部寄出；無人可寄時回409 ESIGN_NO_ELIGIBLE_REMINDER_RECIPIENTS，details 只含同文件可見人員的未寄原因，不建空批次。
- 跨文件／不存在識別整批拒絕；同文件但為內部員工、已簽、已拒或無可用地址者須有可查的未寄送原因，不冒充成功。
- 同一文件、同一外部簽署人催簽一天一次，不因批次或操作者不同而解除；已有排隊／處理中的明細不得重複排入。受限者回傳可辨識的未寄送原因；日界線為台北時間每日午夜 00:00，不採滾動 24 小時；跨午夜仍在排隊或處理中的同一人不可重複排入。
- 寄送前再次檢查文件、簽署人及當前有效入口。SMTP 接受結果不保證實際收件或已讀。

## 4. 查詢催簽結果與歷史

`GET /api/esign/documents/{documentId}/notification-batches` 及 `GET /api/esign/documents/{documentId}/notification-batches/{batchId}`，僅建立人。

提供批次操作者與時間、各簽署人識別及姓名、邀請／催簽類型、逐人結果、嘗試次數、成功時間或穩定失敗／未寄送原因；支援分頁，避免大量通知歷史一次回傳。不得回傳邀請原值、郵件憑證或 SMTP 原始錯誤。

## 5. 拒簽與歷程

- `POST /api/esign/signing-tasks/{signerPublicId}/rejection`：員工 session，必須為該本人。
- `POST /api/external-signing-task/rejection`：沿 Spec008 OTP 後的 HttpOnly 存取 cookie，body 的 signerPublicId 必須與 credential 一致。
- body 為 `{requestId,reason}`（外部另含 signerPublicId）；reason omitted 視為空字串，trim 後最多200 code points，null 非法；不收前端拒簽時間。
- 首次201，同一次 requestId 重送200，data `{signerPublicId,status:"rejected",rejectedAt,reason}`。不得為同次重送再次記錄事件或改原原因。
- 未開放拒簽／已簽／不同 requestId 已拒／不在期間／停止回409；外部 credential 失效仍回通用401。查驗重送時可驗已拒本人身分，但不授予來源PDF或已簽PDF存取。
- 內外部任務 DTO 回 allowReject 與本人 status/rejectedAt/rejectReason；已拒以結果頁呈現，不提供簽署／補簽。本人 GET 不回其他人及管理備註。

建立人的文件歷程補上簽署／拒簽事件的 `signerPublicId` 與可辨識姓名，保留事件時間與拒簽原因；本人視角裁切管理備註、其他人及內部管理資訊。事件 `signer.rejected`；歷程 DTO 的 actor 為 `{kind:"signer"|"employee"|"system",name,signerPublicId?}`。依事件類型辨認動作者，不能只看 signerId；寄信與產製副本仍屬 system。舊 audit 不回填，讀取時由既有關聯及姓名快照映射。

## 6. 通知狀態與錯誤

batch detail 回 `batchId,kind,requestedBy,createdAt,status,selectedCount,queuedCount,notSentCount,items,nextCursor`，每個 item 為 signerPublicId/name/status/attemptCount/completedAt/reasonCode。batch 狀態由明細推導 queued/processing/completed/partial_failed/failed/unknown；明細 delivered 只代表 SMTP 已接受。

名單不合法400；跨文件或不存在404（整批）；相同 requestId 不同 payload409；無合格對象409；無權限沿現有404。逐人略過原因固定 `INTERNAL_REMINDER_UNSUPPORTED`、`SIGNER_ALREADY_COMPLETED`、`REMINDER_DAILY_LIMIT`、`REMINDER_IN_PROGRESS`、`SIGNING_WINDOW_CLOSED`、`RECIPIENT_UNAVAILABLE`。unknown 使用 `DELIVERY_OUTCOME_UNKNOWN`；不輸出 SMTP 原始錯誤。

`GET /api/esign/documents/{documentId}/notification-batches` 回 cursor/limit 分頁，支援 kind 篩選，以便管理人同時查初次 invitation 與 reminder；明細也分頁。`cursor` 為上一頁回傳的不透明數字字串，`limit` 預設20、範圍1–100；批次由新到舊、明細依建立順序。列表回 `{items,nextCursor}`，每批列表項目不含逐人明細；detail 回 `{batchId,kind,requestedBy,createdAt,status,selectedCount,queuedCount,notSentCount,items,nextCursor}`。`requestedBy` 為 `{userId,name}`，無操作者為null。明確失敗仍有排程重試時，整批視為queued、逐人仍顯示failed及嘗試紀錄；資格回REMINDER_IN_PROGRESS，必須沿用原明細。一天一次以實際派送台北曆日為準，pending/processing 跨午夜仍不可新排；初次邀請與 OTP 不計入催簽額度。

新增 reminder 憑證仍經 `/api/external-signature-invitations/{token}` → OTP → 外部 session；不改原 invitation digest，不允許用 signerPublicId 直接授權。hash 留存及 generation 校驗詳見 [資料模型](../data-model.md)。
