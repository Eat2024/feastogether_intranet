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
| `POST /api/external-signing-task/completed-file/downloads` | Email OTP 存取 cookie，內外部簽署人共用，只限已簽的本人（同原本） | 該簽署人 |
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
| `GET /api/external-signing-task/completed-file` | `POST /api/external-signing-task/completed-file/downloads` |

移除後一律 404。

## 前端交接

本 spec 只做後端，以下由前端工程師在後端完成後處理。

上線時必須跟後端一起部署（後端移除舊路由後，這三處會立刻失效）：
- `ZipExportPanel`：`useGetExportHistoryQuery({ documentId, limit: 1 })` 改為新路由的 `documentId` 加 `pageSize=1`。
- `DocumentSignerTable`：`downloadSignerCompletedFile` 改用 POST 取得 blob。
- `ExternalDone`：「下載已簽署文件」從一般連結改為 POST 取得 blob 後下載；移除 `externalCompletedFileUrl`。

新功能：
- `/export-history`：改用 `GET /api/esign/history/export`。
  - 頁籤依 `type`，筆數用 `typeTotals`；ZIP 頁籤是否新增由前端評估。
  - 移除 `isAdmin()` 在頁面與 SideNav 的限制，以及 `features/export-history` 的 mock store 與 server actions。
  - 重新下載：PDF 用 `POST …/{id}/downloads` 取得 blob；Excel 依上節流程。
- `/forms/[id]/export`：Excel 下載前先呼叫 `POST /api/esign/history/export`，成功才下載。
