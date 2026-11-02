# Department Access Contract

**狀態**：Phase 1 設計，尚未實作。沿用所有既有路徑、session 與 response envelope，不新增 API 路徑。

## 授權矩陣

| 能力 | 發起人 | 同部門非發起人 | 不同部門未參與者 |
|---|---|---|---|
| dep 列表 | 只列目前同部門文件 | 目前同部門文件 | 不可見其他部門文件 |
| 指定文件詳情／來源預覽 | 原建立人可讀，即使調職 | 同部門唯讀 | 404 |
| 修改原文件／名單／欄位／發起／刪除／停止／補簽／備註／通知 | 依原文件狀態規則 | 404 | 404 |
| 補簽邀請連結、通知歷史管理資料 | 原建立人可用 | 404 | 404 |
| 一般 Excel／PDF／ZIP 匯出、歷史、下載 | 仍必須同部門 | 可用，依既有檔案狀態 | 404／不列出 |
| 本人簽署／拒簽／本人副本 | 仍須本人指派 | 仍須本人指派 | 本人已被指派者沿原規則，不因部門阻擋 |

「同部門」只看有效員工目前可信 departmentCode 與未刪除文件 createdByDepartmentCode 精確相等。不能用兩個 NULL 相等授權。原建立人跨部門管理是既有個人權限；不延伸到一般匯出。外部 Email 本人副本及公開驗證維持原獨立契約，不是部門匯出入口。

## 列表

`GET /api/esign/documents?role=dep&status=active`

- role 支援 dep、created、assigned；未帶沿用本人建立與本人被指派合併。all 不支援，回 400。
- dep 部門由後端以 userId 查詢；不接受 departmentId／departmentCode 由呼叫者指定。
- status 沿用 draft／active／expired／finalizing／completed／stopped；未帶不排除任何狀態。deleted_at 不為 NULL 永不列出。
- 回應原列表項目新增 `isCreator: boolean`，由後端計算，僅控制前端呈現，不能拿回來作寫入授權。
- 前端固定 role=dep；建立人姓名／員編、文件名稱、日期、狀態、排序與分頁維持原本 client 邏輯，在部門資料集合內處理。

## 建立與正式登入

`POST /api/esign/documents` request 不新增部門欄位。server 於交易取得建立人可信代碼並保存快照，缺代碼拒絕，回應仍是既有文件 ID。

所有正式登入入口同步 departmentCode／departmentName；不新增 session 回應欄位，不修改 token 格式或信任客戶端部門。OAuth 增加可信 HR 查詢，失敗沿用上游錯誤規則，不能假裝成功或預設 IT。

## 文件唯讀

既有 `GET /api/esign/documents/:documentId`、`.../source-file`、`.../history` 增加同部門唯讀授權，原來源完整性驗證、private/no-store 與嵌入政策保留。

- 詳情回傳明確 `isCreator`。建立人取得既有管理 DTO；非建立人使用唯讀 DTO，前端型別以 isCreator 區分，不能假設管理欄位存在。
- 唯讀提供：文件 ID、標題、編號、狀態、建立人、簽署期間、文件層級停止原因、來源預覽 metadata、簽署人顯示姓名／狀態／完成或拒簽時間、簽署進度。草稿也可唯讀。
- 非建立人不回傳：Email、員編／職稱／部門等非進度必要資料、內部 note、個別拒簽理由、驗證代碼與連結、邀請 URL／token、催簽資格、逐人寄送結果、原始簽名圖、檔案 object key。來源文件本身的內容為使用者授權同部門可瀏覽的文件內容。
- history 同部門只提供文件層級事件，保留既有受裁切 actor 顯示，不能直接得到建立人完整個別稽核視角；指定簽署人的原有本人事件可見規則保留。
- GET reopening-invitations 不放寬，因為它回傳簽署憑證。
- DocumentDetailView、DocumentSignerTable 只讀模式不 mount 寄送歷史／寫入元件；/edit、/signers 直接路由亦檢查 isCreator。後端所有寫入仍保留原建立人檢查。

## 匯出與歷史（取代 Spec 015 全員可見規則）

下列入口都必須以登入 userId 查目前部門，再從所屬 document 取得快照比對；不能以建立人或原匯出人例外繞過。

| 入口 | 修改要求 |
|---|---|
| GET `/api/esign/exportable-documents` | 查詢先按部門限制，再套 q/status/cursor/limit；不讓 cursor 跨部門漏資料 |
| POST `/api/esign/documents/:documentId/exports` | 同部門才可建立或重用 ZIP；權限檢查早於 snapshot、寫 DB、enqueue |
| GET `/api/esign/documents/:documentId/exports/:exportId` | 授權文件且確認工作屬於同一文件後才回狀態／files |
| POST `.../exports/:exportId/retries` | 同部門才可重試；不能變更原文件或快照範圍 |
| GET `.../exports/:exportId/files/:fileId` | 每次請求驗證當下部門，三層 ID 關係一致後才處理檔案／Range／ETag，未授權不送任何檔案位元組 |
| GET `/api/esign/history/export` | 紀錄、total、typeTotals 與分頁先限同部門；documentId filter 不能擴權，跨部門 filter 回空 items／0 counts |
| POST `/api/esign/history/export` | Excel 紀錄建立前檢查該文件部門，不讓 client 以 documentId 跨部門記錄或取資料 |
| GET `/api/esign/history/export/:id/document` | Excel 重下載資料依紀錄對應文件部門，繼承既有可匯出欄位範圍；不同於一般唯讀詳情 DTO |
| POST `/api/esign/history/export/:id/downloads` | PDF 歷史重下載前驗證紀錄／signer／document 關聯與部門，拒絕不得新增下載紀錄 |
| POST `/api/esign/documents/:documentId/signers/:signerPublicId/completed-file/downloads` | 一般文件管理頁的個人完成副本下載改採同部門條件，保留 signer 屬於 document 與檔案 ready 檢查 |

同部門一般匯出沿用原 Excel/PDF/ZIP 內容，包含原契約核准的簽署人資料與已簽 PDF；不以「可下載」授權取得原始簽名 blob 或任意儲存物件。原始預覽、一般匯出、本人副本三者授權明確分開。

歷史歸屬以文件部門判定，無論原匯出者是否為外部簽署人、已刪除或已調職。檔案回應不提供可繞過授權的公開永久 URL。worker 不新增部門選擇；工作入列前與領取結果時都檢查，但 worker 仍處理既有固定快照。

## 錯誤

- 無有效員工 session：401；外部 session 不當員工 session。
- 無部門代碼且操作需要部門：409，新增 `ESIGN_DEPARTMENT_UNAVAILABLE`，訊息「無法取得您的部門資料，請重新登入或聯絡系統管理員」。建立人個人管理及本人任務照原資格，不因此一律禁止。
- 不存在、已刪除、其他部門指定資源、非建立人寫入：沿用 `ESIGN_RESOURCE_NOT_FOUND`／404，不區分原因洩露存在性。
- role 或參數不合法：沿用 400 驗證錯誤。
- 同部門但無文件：200 空列表。檔案未就緒、已過期、Range 錯誤等依原契約，在通過授權後判斷。
- 同部門資格不得取代 PDF readiness、交易狀態、OriginGuard 或 session 驗證。
