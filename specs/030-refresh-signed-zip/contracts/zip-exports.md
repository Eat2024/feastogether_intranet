# API 與 UI 契約：ZIP 按需更新

以下為設計目標，尚未實作。沿用 `/api`、現有 envelope 與同部門員工授權；API client 仍攤開 data。POST 沿用 Origin 驗證，所有識別均重新檢查文件歸屬。

## 1. 讀取匯出狀態

沿用 `GET /api/esign/documents/:id?view=export`，新增 `exportState`，其餘文件資訊維持原契約：

```text
exportState: {
  current: ExportJobView | null,
  work: ExportJobView | null,
  currentNewSignatureCount: number,
  workNewSignatureCount: number
}
```

- current 為最新 status=completed 的成功版本；work 為進行中或最新待重試工作，選取規則見 data-model.md。
- 對應值為 null 時新增數回 0；首次可產生份數取文件 signedCount。
- 新增數由後端對紀錄 ID 做差集，前端不得用 signedCount 減 expectedCount 作權威判斷。
- 保留原 exportSummary 作 `work ?? current`；文件詳情及 exportable-documents 的 latestExportSummary 亦使用相同選取優先序。匯出操作頁用完整 exportState；非匯出列表不為每個歷史工作計算差集。
- work 與 current 均沿用現有窄 ExportJobView，不揭露 snapshotJson、resolvedFilesJson、objectKey、個人簽名或全體名單。
- GET 只讀，不自動建工作、重試、停用或刪檔。輪詢進度仍使用指定工作 GET；終態時重新讀 preview 取得最新差集。

## 2. 明確產生／更新

`POST /api/esign/documents/:id/exports`

Body 不變：`{ "type": "signed_copies_zip" }`，不新增 force、客戶端人數、名單或時間欄位。

| 後端受理時狀態 | 結果 | HTTP |
| --- | --- | --- |
| 有 pending/waiting/processing | 回傳同工作，reused=true，不排下一版 | 202 |
| 無進行中但有最新 failed | 回該失敗工作，reused=true，供明確重試 | 200 |
| 有有效成果且無新增 | 回該 completed 工作，reused=true | 200 |
| 首次且有簽署，或有新增且無待處理工作 | 建立當下全體快照，reused=false | 202 |
| 無任何簽署 | ESIGN_EXPORT_EMPTY，沿既有錯誤映射 | 既有狀態碼 |
| 無新增且原成果遺失／不可用 | ESIGN_EXPORT_UNAVAILABLE | 503 |

回應維持 `ExportJobView & { reused: boolean }`。200 failed 不是成功產檔，UI 依 status 顯示失敗，不顯示可下載 toast。`reused` 指重用工作，不保證該工作已完成。

若有新增且原 current 缺檔，可以建立新版本；不能因舊版 assertAvailable 先失敗阻止使用者明確更新。

## 3. 進度與重試

- `GET /api/esign/documents/:id/exports/:exportId`：只查指定工作；完成後即使有更多簽署，仍回該次完成成果。
- `POST /api/esign/documents/:id/exports/:exportId/retries`：只重試最新適用 failed，沿用快照。存在進行中工作則回該工作；不被舊 completed 攔截。
- 過時 failed、superseded 或完整性失敗：沿用 ESIGN_EXPORT_RETRY_INVALID；不能讓舊工作復活並覆蓋新成功版。
- 重試後 pending／進行中沿用 202；所有重試都在 document 鎖下重新確認。
- ZIP 的 ExportJobView.status 使用 pending／waiting／processing／completed／failed／superseded；共用的前端 EsignExportStatus 與歷史頁仍保留其他匯出類型的 expired，相容移除只限 ZIP 專用流程。該狀態保留份數／時點／completedAt，但 `files=[]`，無重試入口。

## 4. 指定成果下載

- `POST /api/esign/documents/:id/export-downloads`：沿用 type、exportId、fileId、fileName，驗證指定成果、首次名稱保存及回傳下載路徑；不打包。
- `GET /api/esign/documents/:id/exports/:exportId/files/:fileId`：沿用串流、Range、ETag、檔名及 private/no-store；每次重新驗權與版本／檔案狀態。
- 增加穩定錯誤 `ESIGN_EXPORT_SUPERSEDED`（409）：「此 ZIP 已被新版取代，請重新取得最新匯出資訊。」同步 server errors、OpenAPI 與 client errorCodes。
- 未就緒仍用 ESIGN_EXPORT_NOT_READY；原成果缺檔仍用 ESIGN_EXPORT_UNAVAILABLE；無權限／錯文件沿既有非揭露規則，不透過 superseded 錯誤洩漏其他文件存在。
- 授權判斷與狀態查核通過的下載視為已開始；不持有長交易等待傳輸。切換後進來的新請求／Range 請求須拒絕舊版。切換與 stream 開啟間可能因刪檔失敗回不可用，符合 spec 的舊傳輸中斷界線。
- 不重新導向新版冒充舊版，也不在下載前為新增簽署重新產製。

## 5. 歷史

沿用既有歷史路徑與分頁計數。新工作為獨立歷史列，重複下載不新增列。superseded 列仍可列出匯出人、日期、份數與名稱，顯示「已被新版取代」且沒有下載／重試按鈕。不能把檔案刪除失敗重新當作可下載。

## 6. UI 狀態與快取

| 情況 | 主要操作 | 其他呈現 |
| --- | --- | --- |
| 無成果、有簽署 | 產生 ZIP（N 份） | 無簽署則說明無檔可匯出 |
| current 最新、無 work | 下載 ZIP | 不呼叫申請 |
| current 過時、無 work | 更新並下載 ZIP | 顯示已含／新增份數，可明確下載舊版 |
| work 進行中 | 進度與固定份數 | 禁止再次申請，可下載標示份數的 current |
| work 失敗 | 適用的重試 | 原 current 仍可下載；完整性錯誤無重試 |
| 本次 requestedId 完成 | 下載本次成果 | 若仍有新增，另列更新並下載，不自動呼叫 |
| 指定工作被其他使用者新版取代 | 已被新版取代 | 刷新摘要，清除舊下載操作，不自動建工作 |

- requestedId 只來自使用者申請／重試或重開頁時的 work，不因 currentNewSignatureCount 增加而切換／重啟。
- 進行中每 3 秒沿現有 hook 查該工作；完成／失敗／被取代停止輪詢，invalidate preview、文件詳情與歷史快取，再顯示對應狀態。
- 重開頁從 exportState 恢復進度；完成後不自動下載。畫面資訊過時可重新整理，所有 mutation 均由後端再驗狀態。
- 自訂名稱沿原 prepareDownload 規則，只作用於指定版本當次下載；新工作不複製／覆寫舊工作名稱。
