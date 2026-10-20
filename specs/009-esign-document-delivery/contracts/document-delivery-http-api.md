# Spec 009 文件交付 API 契約

狀態：設計契約，尚未實作。JSON 沿用 `{success,data}` envelope；所有 session 寫入沿用 OriginGuard。ID 在 API 為 string，後端檢查合法與安全範圍。401 未登入、403 權限類型不足、404 隱藏資源／跨文件、409 狀態衝突、400 輸入非法；錯誤集中 AppErrors。

## 草稿完整設定

`PATCH /api/esign/documents/{documentId}/draft-settings`，僅建立人、draft，200。

```json
{
  "signers": [{"type":"user","userId":"123"},{"type":"email","name":"外部測試者","email":"test@example.com"}],
  "signStartAt": "2026-10-20T00:00:00+08:00",
  "signEndAt": null,
  "watermark": true,
  "allowReject": true
}
```

signers 出現時整批取代、至少一人；未出現保留。日期 omitted 保留、null 清空；日期兩端皆有須 start<end，draft 可部分或過去日期。選項 omitted 保留、只接受boolean。所有欄位同交易全成或全敗；回完整 creator document DTO，包含名單、日期及選項。現有 `PUT .../draftSave` 保留回傳 signers 的相容形狀，委派同一 service，不形成第二套規則。`POST .../initiations` 維持完整驗證與固定 payload，前端不可再固定送 false。

## 人資文件查找

`GET /api/esign/exportable-documents?cursor=...&limit=50&status=...&q=...`。

所有有效員工 session 可查所有未刪除簽署文件；本次不檢查本地人資角色，外部簽署 session 不適用，也不接受 query role 作授權。游標分頁，limit 1–100。回 items（documentId、title、creatorName、status、signedCount、latestExportSummary）、nextCursor。資料庫先排除已刪除文件及套用查詢條件再分頁；後續 role／permission 規格再加入角色條件。

## 申請及重用匯出

`POST /api/esign/documents/{documentId}/exports`，body `{ "type":"signed_copies_zip" }`。

有效員工 session 可操作，不限建立人，本次不另驗人資角色。相同文件在七天有效期內直接重用，不按申請人、新簽人數或名單 hash 另建工作；已有進行中工作也回原工作。新工作／進行中回202，已完成重用回200。無已簽者409 `ESIGN_EXPORT_EMPTY`。

```json
{
  "id":"<export UUID>", "documentId":"123", "reused":false,
  "status":"pending", "snapshotAt":"2026-10-20T07:00:00Z",
  "expectedCount":6000, "processedCount":0, "waitingCount":0,
  "completedAt":null, "expiresAt":null, "files":[]
}
```

completed 時 files 為 `{id,fileName,size,sha256,downloadPath}`；不回 object key、storage credentials 或 signed URL。fileName 為安全名稱，downloadPath 為下面同源路由。七天從完成起算，回應明示快照時間與份數，讓使用者知道新增簽署未納入。

`GET /api/esign/exports?documentId=...&cursor=...&limit=50`：有效員工 session 可看全部匯出紀錄，不限建立人或最初申請人。回分頁與申請者／狀態／快照／期限。

`GET /api/esign/documents/{documentId}/exports/{exportId}`：200 狀態 DTO。GET 只推導 expired，不更新紀錄、不觸發打包。

`POST /api/esign/documents/{documentId}/exports/{exportId}/retries`：failed 且可重試時202，沿用原快照；進行中回原工作，不新增副本。來源損壞回409可理解錯誤。若另一個有效成果已存在，回其 reference，避免並行發布互相競爭的七天成果。

## 下載

`GET /api/esign/documents/{documentId}/exports/{exportId}/files/{fileId}`。

每次確認有效員工 session、資源歸屬、completed、now<expiresAt。到期410 `ESIGN_EXPORT_EXPIRED`；不存在404；尚未完成409；已完成但物件遺失503 `ESIGN_EXPORT_UNAVAILABLE`。不因 GET 偷偷重新生成。

完整檔200；合法單一 Range 206並回 Content-Range／Content-Length／Accept-Ranges: bytes／ETag(sha256)。If-Range 與目前 ETag 不符回完整200；無法滿足的 range回416及 `Content-Range: bytes */size`；多段Range本版不實作，忽略後回完整200。回 application/zip、attachment UTF-8 filename、private/no-store、nosniff。代理與 Next rewrite 必須保留這些標頭、Range 與串流，避免反向代理緩衝整包。

前端原生連結啟動下載，不能 Axios responseType=blob 或 fetch 全包。下載路由無 credential query；過期後的續傳也回410。

## Storage 內部契約

擴充既有 PrivateFileStorage，不替換其 store(bytes) 呼叫：`storeStream({directory,extension:'zip',mimeType:'application/zip',stream,signal,...})` 回 StoredPrivateFile；`openReadStream(reference,{start,end,signal})` 支援 Range；刪除仍接受固定版本 reference。新增 zip MIME／extension 白名單。實際 byte count 與 SHA-256 邊寫邊算，失敗銷毀所有來源與目的流。暫存物與 multipart 清理限定匯出目錄，禁止掃除來源 PDF。
