# HTTP Contract: 準備自訂名稱的匯出下載

本文件為待實作契約。所有 JSON 成功回應沿用 `{ success: true, data: ... }`；錯誤沿用既有 error envelope，訊息使用繁體中文。

## POST /api/esign/documents/:documentId/export-downloads

**用途**：驗證當次名稱與下載資格並回傳下載資訊；不持久保存、不產檔、不建立匯出紀錄。重複請求不產生業務寫入。

**授權**：有效員工 session cookie、OriginGuard、未刪除且已發起的同部門文件。外部簽署 session 不適用。ZIP 準備階段須檢查 document/export/file 關聯與成果可用性；既有 GET 再次執行相同授權。

**Content-Type**：`application/json`。

Excel body：

```json
{ "type": "excel", "fileName": "年度紀錄" }
```

ZIP body：

```json
{ "type": "zip", "fileName": "年度副本", "exportId": "<既有工作 UUID>", "fileId": "123" }
```

`fileName` 可省略或空白；null／非字串拒絕。Excel 不接受 exportId/fileId；ZIP 兩欄皆必填。未知欄位、錯誤 type／ID 與不合法名稱回 400；其餘命名規則見 [data-model.md](../data-model.md)。

**200 Excel**：

```json
{ "success": true, "data": { "type": "excel", "fileName": "年度紀錄.xlsx" } }
```

未指定名稱時 `fileName: null`。前端必須準備成功後才呼叫既有 Excel 記錄 API；該 API body／回應與歷史儲存均不修改。

**200 ZIP**：

```json
{
  "success": true,
  "data": {
    "type": "zip",
    "fileName": "年度副本.zip",
    "downloadPath": "/api/esign/documents/9/exports/<既有工作 UUID>/files/123?downloadName=client"
  }
}
```

未指定名稱時回傳既有成果檔名與不含旗標的原下載路徑。downloadPath 僅可為服務組合的相對同源路徑，不接受客戶端提供網址；不得含使用者輸入名稱。

| 狀態 | 行為 |
| --- | --- |
| 400 | INVALID_REQUEST：名稱、類型、欄位或識別值格式不合法；不回顯原輸入名稱。文件 ID 沿用既有 ID 錯誤定義。 |
| 401 | 員工 session 缺失或失效，沿用現有登入過期處理。 |
| 403 | CSRF_ORIGIN_REJECTED：Origin 不允許。 |
| 404 | ESIGN_RESOURCE_NOT_FOUND：文件不在可見範圍、草稿、已刪除，或 export/file 不屬於指定資源。 |
| 409 | ZIP 未就緒或員工部門尚未設定，沿用既有錯誤定義。 |
| 503 | ESIGN_EXPORT_UNAVAILABLE：原 ZIP 成果不可用，沿用既有 download service 的錯誤定義。 |

JSON 回應不快取，檔名不寫入 application/access log。

## 既有 GET /api/esign/documents/:documentId/exports/:exportId/files/:fileId

只新增可選 query `downloadName=client`，不接受實際名稱、替代檔案路徑或身分。省略時行為完全相同；不支援的旗標值、重複值須拒絕。

- 省略：沿用原本含 filename* 的 Content-Disposition。
- 值為 client：成功回應僅 `Content-Disposition: attachment`，不包含 filename／filename*；前端同源連結的 `download` 屬性指定 POST 回傳名稱。
- 兩者均沿用原本 session、同部門權限、成果歸屬與可用性驗證。client 模式無須持久票證；本機建議名稱不是授權資料。
- `Content-Type: application/zip`、private/no-store、nosniff、ETag、Accept-Ranges、200／206／416 與 If-Range 規則維持原樣。
- 不回傳自訂名稱到共用 metadata，不新增歷史，不重新打包。準備成功後資格變動仍拒絕實際 GET。

## 前端交付與失敗邊界

準備 API 以既有 api requests／mutation 串接，失敗顯示中文、保留原頁輸入。ZIP 成功準備後直接交付同源瀏覽器下載，不使用 Blob 載入大檔。原頁不得因下載錯誤被取代；不因發出連結就顯示完成。

前端不能觀測原生下載的完整傳輸結果；GET 晚期失敗、網路中斷與使用者取消由瀏覽器下載介面呈現，不能被當作 API 已保證下載成功。此行為須於實際嵌入環境驗收。

## 歷史下載命名擴充（2026-11-04）

歷史頁 Excel／ZIP 重用上述準備 API；Excel 仍由 `GET /api/esign/history/export/:id/document` 取得資料，不呼叫新增匯出紀錄 API。ZIP 仍為同源直接下載，不載入 Blob。

`POST /api/esign/history/export/:id/downloads`（歷史 PDF）新增可選 JSON body：

```json
{ "fileName": "年度已簽文件" }
```

- body 可省略；`fileName` 省略或空白沿用既有名稱，null／非字串／未知欄位回 400。
- 名稱沿用既有匯出驗證（100 Unicode 字元、最終 255 bytes、禁止路徑／控制字元及保留名稱），結尾 `.xlsx`／`.zip`／`.pdf` 不分大小寫替換為目標副檔名。共用命名 helper 的 Excel／ZIP 也接受替換 `.pdf`。
- 成功維持 200 PDF bytes，由 Content-Disposition 的 filename* 回傳正規化名稱，不修改檔案內容或歷史。
- session、OriginGuard、同部門存取與副本完整性檢查沿用原流程；名稱不進 URL。
- 歷史頁下載按鈕開啟共用 Dialog，留白沿用預設；處理中停用重複送出，錯誤保留輸入，重新開啟重設名稱。
