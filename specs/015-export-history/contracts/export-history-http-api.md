# HTTP 契約：歷史匯出紀錄

`/api/esign/history/export` 底下的路由都需要有效員工 session，外部簽署 session 一律拒絕。寫入路由都需同源（`OriginGuard`）。錯誤沿用既有 envelope 與錯誤碼。

## 類型

| type | 頁籤 | 何時產生紀錄 |
|---|---|---|
| `excel` | 簽署紀錄清單 Excel | 前端呼叫 `POST /api/esign/history/export`（首次匯出與重新下載） |
| `pdf` | 單人已簽署文件 PDF | 後端在 PDF 下載路由回傳檔案時記錄（見「單人 PDF 下載」） |
| `zip` | 已簽署副本 ZIP（是否加頁籤由前端評估） | 建立 ZIP 匯出工作（Spec 009，不變）；下載不記錄 |

ZIP 申請路由 `POST /api/esign/documents/{documentId}/exports` 的 body `{ "type": "signed_copies_zip" }` 是 Spec 009 的既有契約，本次不變。

## 查詢紀錄

`GET /api/esign/history/export?type=excel&page=1&pageSize=10&documentId=123`

| 參數 | 規則 |
|---|---|
| `type` | 必填，上表三者之一 |
| `page` | 選填，正整數，預設 1 |
| `pageSize` | 選填，1–100，預設 10（與現有畫面相同） |
| `documentId` | 選填，限定單一文件；同時套用到 `typeTotals` |

依匯出時間由新到舊，時間相同時以紀錄流水號由大到小。

```json
{
  "items": [
    {
      "id": "6f1c…（紀錄 UUID）",
      "type": "excel",
      "document": { "id": "123", "title": "2026 年度個資同意書", "docNumber": "550e8400-…" },
      "exportedBy": { "name": "王小明", "employeeNo": "11506071", "email": null },
      "exportedAt": "2026-10-28T03:15:00.000Z",
      "scope": "狀態：已簽署；部門：全部",
      "count": 120,
      "conditions": { "statuses": ["signed"], "depts": [], "fields": ["name", "employeeNo", "dept", "status", "signedAt"] }
    },
    {
      "id": "…",
      "type": "pdf",
      "document": { "id": "123", "title": "…", "docNumber": "…" },
      "exportedBy": { "name": "林外部", "employeeNo": null, "email": "lin@example.com" },
      "exportedAt": "…",
      "scope": "林外部（lin@example.com）",
      "count": 1,
      "signerPublicId": "…"
    },
    {
      "id": "…（即 ZIP 匯出工作 id）",
      "type": "zip",
      "document": { "id": "123", "title": "…", "docNumber": "…" },
      "exportedBy": { "name": "…", "employeeNo": "…", "email": null },
      "exportedAt": "…",
      "scope": "全部已簽署副本",
      "count": 6000,
      "documentId": "123",
      "status": "completed",
      "snapshotAt": "…", "expectedCount": 6000, "processedCount": 6000, "waitingCount": 0,
      "completedAt": "…", "expiresAt": "…", "failureCode": null,
      "files": [{ "id": "9", "fileName": "…zip", "size": 123456, "sha256": "…", "downloadPath": "/api/esign/documents/123/exports/…/files/9" }]
    }
  ],
  "page": 1,
  "pageSize": 10,
  "total": 37,
  "typeTotals": { "excel": 37, "pdf": 12, "zip": 4 }
}
```

- 回應的 `items` 只會有查詢的那一種 `type`；上例並列三種只為說明各類型的形狀。
- `exportedBy`：員工有 `employeeNo`、`email` 為 null；外部簽署人相反。
- `conditions` 只在 `excel` 出現；`signerPublicId` 只在 `pdf` 出現。
- ZIP 專屬欄位與目前 `EsignExportJob` 相同，ZIP 面板沿用既有型別；原本的 `requesterName` 改為共用的 `exportedBy`。
- `page` 超過最後一頁時回空 `items`，`total` 照常。
- 參數不合法回 400 `INVALID_REQUEST`。

## 記錄 Excel 匯出

`POST /api/esign/history/export`。首次匯出與重新下載共用。

```json
{
  "type": "excel",
  "documentId": "123",
  "scope": "狀態：已簽署；部門：全部",
  "count": 120,
  "conditions": { "statuses": ["signed"], "depts": [], "fields": ["name", "employeeNo", "dept", "status", "signedAt"] }
}
```

| 欄位 | 規則 |
|---|---|
| `type` | 只接受 `excel`；其他類型由後端自行記錄 |
| `documentId` | 文件存在、未刪除且已發起，否則 404 `ESIGN_RESOURCE_NOT_FOUND`；不檢查建立人 |
| `scope` | 畫面顯示用範圍說明，trim 後 1–255 字 |
| `count` | 匯出筆數，0 以上整數 |
| `conditions.statuses` | `pending`／`signed`／`rejected` 的子集，空陣列表示全部 |
| `conditions.depts` | 部門鍵陣列，空陣列表示全部；每個鍵 1–255 字，最多 500 個 |
| `conditions.fields` | 至少一個；`name`、`employeeNo`、`dept`、`title`、`email`、`status`、`signedAt`、`rejectedAt`、`rejectReason` 的子集 |

- 成功回 201，內容為新紀錄（與查詢的 item 形狀相同）。
- 匯出人取自 session，不接受前端傳入。
- 未知欄位回 400（全域 `forbidNonWhitelisted`）。

## 單人 PDF 下載

下列 POST 路由取代原本的 GET 下載。成功取得檔案後、送出前寫入一筆 `pdf` 紀錄；寫入失敗回 500，不送出檔案。副本未完成或權限不符時沿用原本的錯誤，且不記錄。

回應：200 `application/pdf`，標頭與原本的 GET 相同（`Content-Disposition: attachment`、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`）。

| 路由 | 身分與權限 | 匯出人 |
|---|---|---|
| `POST /api/esign/documents/{documentId}/signers/{signerPublicId}/completed-file/downloads` | 員工 session，只限建立人（同原本） | 建立人 |
| `POST /api/esign/signing-tasks/{signerPublicId}/completed-file/downloads` | 員工 session，只限已簽的本人（同 016） | 該員工 |
| `POST /api/external-signing-task/completed-file/downloads` | Email OTP 存取 cookie，只限已簽的外部簽署人本人（同 016） | 該外部簽署人；`created_by_user_id` 為 NULL |
| `POST /api/esign/history/export/{id}/downloads` | 員工 session，任何員工 | 目前使用者 |

`POST /api/esign/history/export/{id}/downloads` 的補充規則：
- 只接受 `pdf` 紀錄，其他類型或不存在回 404 `ESIGN_RESOURCE_NOT_FOUND`。
- 回該簽署人目前的已簽副本；新紀錄的文件、簽署人與範圍沿用原紀錄。

## Excel 重新下載資料

`GET /api/esign/history/export/{id}/document`

- 只接受 `excel` 紀錄，其他類型或不存在回 404 `ESIGN_RESOURCE_NOT_FOUND`。
- 唯讀，不新增紀錄。
- 回文件目前的資料，只含產生 Excel 需要的欄位，欄位名稱與文件詳情相同：

```json
{
  "id": "123",
  "title": "…",
  "docNumber": "…",
  "signStartAt": "…",
  "signEndAt": null,
  "originalSignEndAt": null,
  "isReopened": false,
  "createdBy": { "name": "…", "employeeNo": "…" },
  "signers": [
    {
      "type": "user",
      "name": "…", "employeeNo": "…", "department": "…", "title": "…", "email": "…",
      "status": "signed", "signedAt": "…", "rejectedAt": null, "rejectReason": null
    }
  ]
}
```

前端流程：依原紀錄的 `conditions` 篩選 → 呼叫 `POST /api/esign/history/export` 記錄 → 成功後以 `buildExportXlsx` 產生並下載。

## 移除

| 路由 | 取代 |
|---|---|
| `GET /api/esign/exports` | `GET /api/esign/history/export?type=zip&documentId=…&pageSize=1` |
| `GET /api/esign/documents/{documentId}/signers/{signerPublicId}/completed-file` | `POST …/completed-file/downloads` |
| `GET /api/esign/signing-tasks/{signerPublicId}/completed-file` | `POST /api/esign/signing-tasks/{signerPublicId}/completed-file/downloads` |
| `GET /api/external-signing-task/completed-file` | `POST /api/external-signing-task/completed-file/downloads` |

移除後一律 404。

## 前端交接

本 spec 只做後端。後端已完成，前端尚未串接，以下由前端工程師處理；`/export-history` 目前仍是 mock。後端與契約的差異、未明定行為與限制見 [implementation-notes.md](../implementation-notes.md)。

上線時必須跟後端一起部署（後端移除舊路由後，這四處會立刻失效）：
- `ZipExportPanel`：
  - `useGetExportHistoryQuery({ documentId, limit: 1 })` 改為 `GET /api/esign/history/export?type=zip&documentId=…&pageSize=1`（`type` 必填）。
  - 最近一次匯出仍讀 `items[0].id`（即 ZIP 工作 id）。
  - `endpoints.ESIGN_EXPORTS`、`ExportHistoryParams`（`cursor`／`limit`）、`EsignExportHistory`（`nextCursor`、`requesterName`）都要換成新的查詢參數與回應型別。
- `DocumentSignerTable`：`downloadSignerCompletedFile` 改為 `POST …/signers/{signerPublicId}/completed-file/downloads`。它目前用的 `getBlob` 只會發 GET，需要改成以 POST 取得 blob。
- 「我的電子簽」本人副本（`/my-signature/[id]` 的 `SigningTaskView`）：`downloadSigningTaskCompletedFile` 改為 `POST /api/esign/signing-tasks/{signerPublicId}/completed-file/downloads`。
- `ExternalDone`：`downloadExternalCompletedFile` 改為 `POST /api/external-signing-task/completed-file/downloads`；移除不再使用的 `externalCompletedFileUrl`。

這三個下載函式在 016 之後都已經用 API 請求取得 blob。要改的地方：
- 路徑多了 `/downloads`：`client/src/api/endpoints.ts` 的 `ESIGN_SIGNER_COMPLETED_FILE`、`ESIGN_SIGNING_TASK_COMPLETED_FILE`、`EXTERNAL_SIGNING_TASK_COMPLETED_FILE`。
- method 改成 POST。這是寫入請求，缺 `Origin` 會回 403 `CSRF_ORIGIN_REJECTED`；瀏覽器同源 POST 會自動帶上 `Origin`。

不變的地方：
- 回應仍是 PDF 附件，檔名取自 `Content-Disposition` 的 `filename*`。
- 錯誤仍是 JSON，以 blob 接收時需要解析。

新功能：
- `/export-history`：改用 `GET /api/esign/history/export`。
  - 頁籤依 `type`，筆數用 `typeTotals`；ZIP 頁籤是否新增由前端評估。
  - 分頁用 `page`、`pageSize`（1–100，預設 10）；`total` 是目前頁籤的總筆數。
  - 移除 `isAdmin()` 的限制：頁面、`(main)/layout.tsx` 與 SideNav 的 `adminOnly`。
  - 移除 `features/export-history` 的 mock store 與 server actions。`features/forms/actions.ts` 與 `/forms/[id]/export/file` 原型也引用這個 store，要一併處理。
  - 重新下載：
    - PDF 用 `POST …/{id}/downloads` 取得 blob，後端會新增一筆紀錄，匯出人為目前使用者。
    - Excel 依上節流程。`buildExportXlsx` 的參數型別目前是 `EsignDocumentDetail`，它與 `exportRows` 實際用到的欄位都在 `GET …/{id}/document` 的回應中（簽署人沒有 `publicId`），需要把型別放寬。
- `/forms/[id]/export`（`DocumentExportView` 的下載）：Excel 下載前先呼叫 `POST /api/esign/history/export`，成功才以 `buildExportXlsx` 產生並下載。
  - body 對應：
    - `documentId`：文件 id
    - `scope`：畫面上的範圍說明
    - `count`：匯出列數
    - `conditions`：目前的 `statuses`、`depts`、`fields`
  - `scope` trim 後最多 255 字，`depts` 每個鍵最多 255 字。目前的寫法可能超過上限而回 400：
    - `describeScope` 會列出所有選取的部門名稱。
    - 部門鍵是 `d:` 加 `encodeURIComponent(部門名稱)`，一個中文字編碼後是 9 個字元。

    選很多部門或部門名稱超過 28 個中文字時就會超過；處理方式待確認（見 implementation-notes）。
