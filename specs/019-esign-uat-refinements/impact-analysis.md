# 議題 1：歷史重新下載不新增紀錄

| 位置 | 現況與預期影響 |
| --- | --- |
| `client/src/features/export-history/ExportHistoryView.tsx` | Excel 呼叫 `recordAndDownloadExcel` 再建紀錄，需改為不記錄的產檔下載；同步調整刷新與註解。PDF 重下載成功後刷新需求一併確認。 |
| `client/src/features/esign-documents/buildExportXlsx.ts` | 已有 `buildExportXlsx` 可沿用；正常新匯出的 `recordAndDownloadExcel` 保留。 |
| `server/src/features/esign/services/esign-export-history.service.ts` | `excelDocument` 已唯讀；`redownloadPdf` 呼叫 `recordPdf` 新增紀錄，需停止該寫入並保留產物就緒檢查。其他 PDF 下載入口的記錄行為保留。 |
| `server/src/features/esign/controllers/export-history.controller.ts` | 修正 Excel 查詢後須再記錄的舊說明。PDF 使用 `POST :id/downloads`，plan 時確認唯讀下載語意與合約相容安排。 |
| `client/src/api/requests/esignExports.ts` | 配合 PDF 合約決策同步，不能只從前端隱藏新紀錄。 |
| 歷史 ZIP 操作 | 有效 ZIP 直接下載已不新增紀錄；議題 2 取消到期重新產生，失敗重試保留。 |

## 規格與驗證影響

- Spec 015 的 User Story 4、FR-008／FR-010 與實體說明含重下載新增紀錄舊語意，由本 spec 取代該部分。
- 驗證 Excel 重下載不建立紀錄，正常新匯出仍記錄。
- 驗證 PDF 重下載不寫入，未就緒／不存在／未授權仍拒絕。
- 驗證重複與並發下載不增加筆數或改寫原紀錄。
- 整合 Spec 017 時保留同部門授權，回歸非歷史入口的記錄行為。
- 此階段僅文件，未修改 client、server、API 或 DB；無 migration/config 變更。

## 議題 2：取消 ZIP 保存期限

- `server/src/worker/esign/document-export.processor.ts`：移除完成時間加七天的期限設定，以及維護流程的到期狀態轉換、ZIP 刪除分支。保留工作租約逾時恢復與未被引用暫存檔清理；工作租約不是檔案保存期限。
- `server/src/features/esign/repositories/export-job.repository.ts`：`reusable` 不再要求完成工作期限晚於現在；`maintenance` 不再挑選待到期清理工作。須維持併發鎖定及可用產物引用，避免永久成果遭暫存清理誤刪。
- `server/src/features/esign/services/esign-export.service.ts`：移除 view/download 依期限拒絕或隱藏成果的邏輯，保留產物存在與完整性檢查；重複申請沿用完成工作。
- `client/src/features/esign-documents/ZipExportPanel.tsx`、`client/src/features/export-history/ExportHistoryView.tsx`：移除保存期限及到期重新產生操作，將新增簽署提示改為「此 ZIP 不包含產生後新增的簽署，後續沿用原檔」。
- API/DB：不預設新增 API、table 或欄位。plan 檢視既有 `expiresAt` 欄位是否先保留為 null 以兼容，並清查 DTO、型別、文件與測試的 expired 語意。
- 既有資料：盤點已完成、已到期但檔案仍在、已清除及同文件多份 ZIP。plan 定義可用產物驗證、原工作選取與期限/狀態調整；不可只清空期限就把已刪除檔案當成可用。不自動執行 UAT 資料更新。
- 新規則的永久沿用以成功完成的 ZIP 為準；失敗重試與工作租約保留，不增設使用者強制更新或自動重建機制。
- 驗證跨七天/一年、維護後仍可下載、後續新增簽署不改內容、併發申請不重複建工作，以及缺檔不偷偷重建。

## 議題 3：我的電子簽與歷史匯出搜尋

- `client/src/features/signing-tasks/SigningTasksListView.tsx` 與 `taskQuery.ts` 已實作前端搜尋，並非只有 input：目前從完整任務資料比對名稱、編號、建立人姓名及員編，先搜尋再分頁；優先保留並回歸驗證，無須只因本需求搬到 SQL。
- `client/src/features/export-history/ExportHistoryView.tsx` 新增相同搜尋輸入與查詢參數，關鍵字改變時重設分頁。
- `server/src/features/esign/repositories/export-job.repository.ts` 的歷史查詢需要關鍵字條件，並由 document.createdByUser 關聯文件建立人；現有 exporter 是匯出人，不能拿來取代。historyPage 與類型計數共用搜尋及權限條件。
- 該 repository 的 documents 查詢雖已有 q，但只比對 title，不能誤認歷史紀錄查詢已具備三欄搜尋；plan 依實際頁面呼叫確認涵蓋入口。
- API DTO、client request/type/query key 要串接歷史搜尋參數；採綁定參數、明確 LIKE escape，OR 條件加括號後與授權條件 AND。大小寫語意須考量 doc_number 的 ascii_bin 定序。
- 無新增 DB 欄位需求。驗證部分文字、特殊字元、空白、建立人與匯出人不同、跨頁計數與同部門權限。

### 議題 3 補充：分頁是明確交付需求

- 兩個列表均須支援搜尋＋頁碼分頁，每頁沿用 `PAGE_SIZE = 10`，不是只有搜尋輸入。
- 現況：我的電子簽取得完整任務後在前端搜尋與切頁；歷史匯出已透過 `page/pageSize` 由後端分頁。不得把現有前端分頁描述為後端分頁。
- 歷史匯出的 `historyHref`、request/query key 與 total/counts 必須納入搜尋條件，換頁保留關鍵字，變更條件重設頁碼。
- plan 明確檢查兩種列表的頁碼合法性、超出範圍導正、穩定排序及重新整理行為；是否將我的電子簽移到後端分頁屬實作設計決策，目前不將未提出的 API 改造當成已確認需求。
- 驗證兩個列表的 23 筆資料切為 10/10/3、無搜尋也分頁、跨頁搜尋命中、切頁保留條件與空結果。

## 議題 4：組織圖快取改為 30 分鐘

- 上游為 `/api/v1/hr/org_chart`；本系統 `EsignSignerCandidateService.getOrgChart()` 使用 Redis 快取，不是定時排程。
- `server/src/features/esign/services/esign-signer-candidate.service.ts`：`redis.set` TTL 從 `7_200` 秒改為 `1_800` 秒；成功取得後起算，讀取不續期。
- `server/src/features/esign/services/esign-signer-candidate.service.spec.ts` 及 `server/test/org-chart.e2e-spec.ts`：更新 TTL、到期邊界與共用快取驗證，保留錯誤、隔離及不續期案例。
- Spec 006 與 Spec 010 的相關合約／操作文件含兩小時舊敘述，實作時同步適用文件；歷史測試證據不改寫為新測試成果。
- 既有 Redis key 可能仍有兩小時 TTL；plan 必須明列切換方式，僅針對組織圖 namespace 處理，不能清空整個 Redis，也不能宣稱只改常數會立即縮短舊 key 的期限。
- 無新增 API、DB 欄位、環境變數或排程；尚未修改程式或操作快取。

## 議題 5：移除未使用的員工信箱預檢 API

- 移除 `DocumentsController` 的 `POST /api/esign/documents/:documentId/employee-email-checks`、專用注入／import 與 OpenAPI 描述。
- 移除 `EsignEmployeeEmailService.checkDraft`，以及只供此方法使用的依賴；保留 `resolveUsers`、`lookupEmails`，因 `EsignInitiationService.prepareEmployeeEmails` 仍使用它們。
- 清理 `employee-email-check.dto.ts` 與 `employee-directory-response.dto.ts` 中只供預檢使用的 DTO，先核對其他共用回應類別的引用再刪除。
- 保留 `FeastogetherHrService.getStaffEmails` 及上游 `POST /api/v1/hr/staff_emails`：它仍為發起取得地址所需，也與 Spec 018 的通知白名單設計相關。
- 調整 `esign-employee-email.service.spec.ts`、`server/test/esign-employee-email-checks.e2e-spec.ts`、`internal-email-capacity.e2e-spec.ts` 與測試清單；容量／分批／來源失敗的有效測試移至仍存在的發起或共用查詢入口，不隨刪除端點丟失覆蓋。
- 核對並更新 Spec 010 等合約中的預檢說明。前端目前找不到該端點呼叫，僅需確認無殘留引用，不重新新增預檢 UI。
- 回歸無有效信箱仍保留指派、通知略過、有信箱正常寄件及來源失敗保持草稿。無新增 DB、API、環境變數；本階段僅更新文件。

## 議題 6：簽署歷程事件中文化

完整 27 種事件與 4 種缺漏見 [盤點表](history-event-inventory.md)。修改位置為後端 history mapping、歷程 DTO/OpenAPI、client history type 與 DocumentHistory 顯示；新增 label 並保留 type，不修改 audit entity 或歷史資料。補簽特殊分支必須同時處理。驗證全部已知事件、未知事件、授權與前端分組顏色；不新增 API 或 DB 欄位。

## Plan 決策索引

本文件記錄初始盤點；最終決策以 plan/research/data-model/contracts 為準。PDF 保留既有 POST；ZIP 固定最新曾完成工作，文件詳情新增 exportSummary 投影解決初始面板選取一致性；舊缺檔不重建；快取使用 v2 key；我的電子簽保留前端分頁；歷程補簽 actor 一致化但不新增資訊揭露。
