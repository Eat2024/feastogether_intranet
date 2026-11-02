# API 與前端合約

以下路徑含既有 `/api` prefix。回應沿用全域 `{success,data,timestamp}`，表述欄位均指 data。授權沿用有效員工 session 及 Spec017 同部門規則；內外部本人副本維持既有本人權限，不擴張。不得將目前 dev 的全員可見狀態當作交付契約。

## US1：歷史重新下載

| 端點 | 契約 |
| --- | --- |
| GET `/api/esign/history/export/:id/document` | Excel 原條件所需當前資料，無寫入；前端 build/download，不再呼叫 POST 紀錄 |
| POST `/api/esign/history/export/:id/downloads` | PDF 附件，200 application/pdf；session、OriginGuard、同部門及既有資源檢查；無新增或改寫歷史 |
| POST `/api/esign/history/export` | 保留新 Excel 匯出記錄用途 |

PDF 歷史重下載 file=null 仍回 ESIGN_PERSONAL_COPY_NOT_READY（409）；不存在／未授權維持既有對外錯誤政策；不再有「建立重下載紀錄失敗」路徑。userId 仍保留用於授權。其他 creator/own/external PDF 下載端點的記錄行為不改。

## US2：ZIP

- POST `/api/esign/documents/:documentId/exports`：首次產生依既有規則 202；有固定可用產物 200、reused=true；固定產物不可用回 ESIGN_EXPORT_UNAVAILABLE，不能另建。
- GET `/api/esign/documents/:documentId/exports/:exportId`：保留 status/expectedCount/processedCount/waitingCount/completedAt/files；新或完成轉換的 expiresAt=null。不以舊日期推導 expired。
- POST `.../:exportId/retries`：只重試未曾成功的工作；若文件已有固定成功工作，沿用該工作或回不可用，不建立第二份成果。
- GET `.../:exportId/files/:fileId`：保留串流、Range、ETag、檔案大小及存在檢查；不以時間拒絕下載。
- 舊 expired 未恢復資料仍可在歷史回應保留 expired 供相容，UI 文案為「檔案已不可用」，移除重新產生動作。新工作不再產生 expired。
- 前端保留 pending/waiting/processing 每 3 秒輪詢，completed/failed 停止；不新增輪詢端點。
- 移除「保存至」「七天」「到期重新產生」，明列 ZIP 固定且不含後續新簽署。匯出面板的固定結果選擇須與 server 一致，不能以純最新歷史時間替代。

- GET `/api/esign/documents/:documentId` 的文件管理詳情新增 `exportSummary: EsignExportJob | null`，僅投影既有狀態與檔案資訊，不帶內部快照、object key、不建立工作；沿用詳情／匯出讀取權限。供 ZipExportPanel 初始選取固定工作，後續仍由既有單工作 endpoint 輪詢。已與 Spec017 整合：同部門管理／唯讀詳情皆可取得，跨部門原建立人 canExport=false 時 exportSummary=null，且不查詢匯出工作；其他跨部門詳情仍404。GET 同一路徑的 view=export 預覽同樣回傳 exportSummary，並維持同部門／非草稿條件，供匯出頁載入固定工作。

## US3：搜尋與分頁

GET `/api/esign/history/export?type=pdf&q=關鍵字&page=1&pageSize=10`

- q 可選，trim 後 <=100 字；任一名稱／編號／文件建立人姓名或員編包含即符合。%/_/! 視為文字；只綁定參數，不拼接輸入。
- 查詢以 `授權 AND 文件條件 AND (title OR docNumber OR creator.name OR creator.empid)` 組合。
- response 保留 items/page/pageSize/total/typeTotals；page 為後端導正後頁碼。total=0 時 page=1、items=[]，三種類型筆數仍依 q 與權限計算。
- 正整數且安全範圍內的 page 超頁時導到最後頁；API 非法 page 維持 400。前端網址非法值正規化為 1，送出前避免 offset 溢位；URL 依 response.page 導正。
- SearchField 沿用 300ms debounce 與 IME；historyHref、query params/key 加 q；換頁保留 q/tab，改 q/tab 回第1頁。後端 counts/items 同一次短讀交易，固定排序 createdAt/id。
- GET `/api/esign/signing-tasks` 回應及端點不變。前端完整任務集先搜尋再分頁，每頁10；同排序值以 signerPublicId 等穩定唯一值決定次序。網址保留 q/tab/sort/order/page，非法頁碼規則一致。

## US4：組織圖

GET `/api/esign/signer-candidates/org-chart` 的資料合約不變；上游 GET `/api/v1/hr/org_chart` 的本機共用 Redis TTL 改1800秒。按需更新而非排程，key v2 切換，client 既有10分鐘查詢快取不等於資料定時刷新。

## US5：移除預檢

刪除 POST `/api/esign/documents/:documentId/employee-email-checks` 路由與 OpenAPI schema；有效 session 對已刪路由的呼叫回框架404且不呼叫 HR。未登入行為依全域 guard，不另保證404或提供相容 stub。

發起仍查 POST `/api/v1/hr/staff_emails`；缺有效信箱略過通知但保留指派；來源故障依既有502阻擋發起並保持草稿。外部 Email 格式驗證不變。Spec018 白名單只限制寄信，不因移除預檢而放寬。

## US6：歷程中文標籤

GET `/api/esign/documents/:documentId/history` 的每一筆增加：

```json
{
  "type": "external_invitation.delivered",
  "label": "外部簽署人邀請信已寄送",
  "occurredAt": "2026-11-02T03:00:00.000Z",
  "actor": {"kind": "system", "name": "系統"},
  "reason": null
}
```

所有分支含 label/actor；補簽回應保持原有期限與原因裁切，不因統一格式洩漏資料。前端使用 label，type 仍用於 group/color；未知 type 的 label 為「其他簽署歷程事件」。後端先部署，前端才依賴 label；rollback 時前端先回到舊版本，不能讓新前端對舊後端。
