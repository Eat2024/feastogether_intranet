# Data Model: 部門代碼與文件建立快照

本文件是規劃，尚未修改 schema 或資料。

## 欄位

| Entity／Table | Property／Column | 型別 | 規則 |
|---|---|---|---|
| User／users | departmentCode／department_code | varchar(50), nullable | 可信 HR department_id，當前最近同步值；不能使用本機 departmentId 替代 |
| EsignDocument／esign_documents | createdByDepartmentCode／created_by_department_code | varchar(50), nullable | 建立部門快照；schema 允許舊資料 NULL，新建成功必須非空 |
| EsignDocument／esign_documents | createdByDepartmentName／created_by_department_name | varchar(150), nullable | 建立時名稱，供顯示；不參與授權 |

既有 users.departmentName 沿用；users.departmentId 的本機外鍵不變。文件 createdByUserId 不變，即修改權判斷所用發起人。匯出工作透過 documentId 關聯文件部門，不新增匯出部門欄位、不新增資料表。

代碼保持字串，保留前導零、大小寫；欄位採 MySQL 8.4 支援的 `utf8mb4_0900_bin` 精確比較。既有上游驗證允許英數、底線及連字號、最長 50；空白／空字串不作有效代碼。不得透過 trim／大小寫折疊把不同原值合併；上游明確缺值以 SQL NULL 清除舊值，不用 TypeORM undefined 跳過更新。姓名／名稱缺值不授予或改變部門。

## 索引與查詢

新增文件索引 `idx_esign_documents_department_deleted_updated_id`：

`(created_by_department_code, deleted_at, updated_at, id)`

部門列表以 code 等值且 deleted_at IS NULL，依 updated_at DESC、id DESC 排序。EXPLAIN 在實作測試資料與 UAT 盤點後驗證，不以無證據的效能數值當交付條件。既有建立人與個人指派查詢保留；status 使用既有有效狀態推導，不直接以儲存狀態取代 expired 判斷。

匯出歷史以 job.documentId JOIN 文件快照；列表、page count、typeTotals、單筆查詢必須使用同一部門條件，避免內容擋住但筆數外洩。

## 寫入與生命週期

1. 帳密／WebView 的 AuthService.findOrCreateUser 保存可信上游代碼與名稱；OAuth 沿既有員編 HR 查詢來源補同步，不使用客戶端 profile 欄位當授權。
2. 查 dep／一般匯出前讀當前有效 User，缺部門拒絕。只讀查詢不更新 HR 或補資料。
3. 新建文件交易讀有效建立人部門並固定快照；可沿用使用者鎖，規劃鎖順序以免與登入交易相反。上傳後交易失敗沿既有機制清除檔案。
4. 草稿編輯、發起、補簽、停止、完成都不更新快照。員工調職只更新 User。
5. 既有 session 的後續請求讀目前 DB 部門，不依 session 建立時的顯示名稱或前端 cache 授權。HR 未重新同步前不承諾即時調職生效。
6. schema 不新增文件狀態；簽署證據、manifest、驗證碼與簽名檔保持原樣。

## Migration 與 UAT 回填

通用 migration 只加三個 nullable 欄位與索引；同步 entity、schema.sql、schema tests。禁止在通用 migration 內呼叫 HR、把 IT 設成欄位 default，或讓其他環境也自動歸 IT。

UAT 一次性資料步驟（未執行）：

1. 確認上游代碼 `1029030000` 對應「IT策略本部系統開發部」。指定值由使用者提供，現場核對不符即中止。
2. 開啟維護窗口並停止文件建立／編輯；備份及盤點切換前所有文件 ID 與新增欄位原值，包含軟刪除但仍保留的紀錄。
3. 只對此既有 ID 集合回填指定代碼與名稱；更新不改 users、createdByUserId、原業務 updated_at 或任何簽署證據，不喚起通知／產檔。
4. 核對目標數、實際影響數與空值數。若欄位已有非預期非空值先停止，不覆蓋不明新資料；重跑只接受已相同的值或原盤點空值。
5. 部署相容前後端並恢復寫入；新文件一律按建立人部門，不依 IT 特例。
6. 上線前既有使用者可能沒有代碼；要求正式重新登入以同步，OAuth 亦須完成改造；不把無代碼視為 IT。

## 回滾

- 資料回填回滾：使用回填前 ID 與原值清單，僅還原這些欄位，不影響切換後新文件或證據。備份不得提交到 repository。
- 程式回滾：先停止寫入及下載，切回相容版本；在仍需要保存新文件部門資料時保留新增欄位，不能無條件跑 down 丟掉歸屬。
- schema down：僅在已備份且確認沒有依賴時移除索引及三欄；驗證 up/down/up 與 schema dump 對齊。
- 前版本匯出為全員可見，回滾即會恢復較寬權限；因此未接受此結果前不得恢復對外下載服務，不能以回滾繞過部門隔離。
