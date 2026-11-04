# Contract — 文件列表受理摘要

## GET /api/esign/documents

沿用 role、status 與文件閱讀權限；initiating 篩選由已合併 PR #50 提供。每筆列表 DTO 新增 `initiation`，固定存在且可為 null。

```json
{
  "id": "123",
  "status": "initiating",
  "signedCount": 0,
  "pendingCount": 0,
  "signStartAt": null,
  "signEndAt": null,
  "initiation": {
    "signStartAt": "2026-11-03T16:00:00.000Z",
    "signEndAt": "2026-11-30T15:59:59.999Z",
    "totalCount": 5213
  }
}
```

範例省略其他既有欄位及 success/data envelope；非新增獨立回應格式。台北列表顯示 2026/11/04～2026/11/30，0/5213。「0」為已簽數，5213 為預計人數，不代表已完成 5213 筆建立。

- queued／processing：status initiating，initiation 有值。
- 無有效工作或文件已正式發起：initiation null，既有欄位照舊。
- signedCount／pendingCount 不裝填預計數；既有詳情 DTO 不擴充本摘要。
- 不回傳名單、inputJson、工作錯誤細節、租約或憑證。
- 同一回應的文件、工作與統計保持一致讀取快照；有效任務關聯依既有唯一性。

## POST /api/esign/documents/:id/initiations

維持既有 202（受理）／200（指定 key 重播）與 InitiationJobDto 回應；不改成文件詳情。以既有 jobId、documentId、status、totalCount 等完整合約修正 client 型別，其他欄位及錯誤碼不變。

client 使用本次已提交的期間，以及回傳 queued／processing 的 totalCount 初始化列表摘要；其後 GET 為權威。若快取已是正式狀態或回應為終態，不降回 initiating。未收到成功回應不自行宣告受理成功。

## UI 約定

- initiating：摘要日期、0/N、0% 進度及「預計簽署人數」說明；原有異動／匯出／檢視按鈕依 PR #50 停用。
- 狀態、日期顯示、日期篩選及排序使用同一資料來源，不能顯示新日期卻按舊草稿日期篩選。
- 成功／失敗下一次讀取不再使用摘要，既有 2 秒輪詢在無進行中資料後停止。
- 不新增 endpoint、通知、重試或取消工作入口。

## 相容性

先部署 server 的新增 nullable 欄位，再部署 client。舊 client 忽略新增欄位；新 client 對缺少摘要的舊回應保留既有顯示，不宣稱已具完整摘要。無資料遷移或重建歷史任務。

## 建立時間欄

既有列表 createdAt 為 ISO 時間，合約不變。新增 UI「建立時間」欄於文件編號後，顯示台北時間 YYYY/MM/DD HH:mm，涵蓋所有文件狀態；不與簽署開始時間或發起時間混用，不改原預設排序。
