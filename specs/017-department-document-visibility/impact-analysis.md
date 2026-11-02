# API 與資料模型影響盤點

**日期**：2026-11-02
**狀態**：盤點已納入 Phase 1 設計，未實作；唯讀權限、UAT 歸屬與匯出範圍均已確認，決策見 [spec.md](spec.md) FR-008～FR-010。

## 現況與目標

本輪 `role=all` 的程式、測試及 Spec 003 修改已依使用者要求撤回。現況是列表固定傳 `role=created`；目標是固定傳 `role=dep`，由後端查登入員工部門，不能由前端決定部門代碼。

已確認的資料來源與缺口：

- `server/src/infrastructure/http-client/feastogether/types/staff-lookup.dto.ts` 有上游 `department_id`（字串、上限 50）及 `department_name`（上限 150），兩者允許缺值。
- `server/src/features/auth/services/auth.service.ts` 的帳密與 WebView 登入共用 `findOrCreateUser()`，目前只保存 `departmentName`，未保存上游代碼。
- `server/src/features/users/entities/user.entity.ts` 的 `departmentId` 是指向 `hr_departments.id` 的本機 bigint 外鍵，不是上游字串代碼；不能直接塞入上游值或以名稱反查當授權依據。
- `server/src/features/auth/services/oauth-identity.service.ts` 目前只取得員編、姓名與 sub，不取得部門；正式 OAuth 入口須補可信 HR 查詢與部門同步。
- `server/src/features/esign/services/esign-draft.service.ts` 建立文件只保存 `createdByUserId`；文件沒有建立部門快照。
- `server/src/features/esign/services/esign-document-query.service.ts` 現有 `created`、`assigned` 與未指定 role 的分支；目前不支援 dep，也不支援全公司 all。

## API：不新增路徑

| 現有 API／流程 | 預計修改 | 不新增的內容 |
|---|---|---|
| `GET /api/esign/documents?role=dep` | `ListDocumentsQueryDto` 增加 dep，Controller 沿用 userId；Service 取得可信部門，Repository 依文件快照查詢；保留 status | 不接受 departmentId／departmentCode 由呼叫者選部門；不新增全公司 all |
| `role=created`／`assigned`／未帶 role | 保留原有本人建立／本人指派／兩者合併範圍；不可回傳無關文件 | 不為此新增另一支列表 API |
| `POST /api/esign/documents` | 建立交易內讀取建立人部門並保存快照；缺代碼拒絕並沿用上傳失敗清理機制 | 不新增前端可寫的部門欄位，不新增部門修改 API |
| 帳密、WebView、OAuth 登入 | 成功驗證員工後同步同一來源的部門代碼／名稱；上游明確缺值時清除舊值，不能殘留舊授權 | 不新增登入入口、環境變數或排程 |
| Session 回應 | 部門授權在後端完成，前端現有 departmentName 可沿用；目前無需公開新增代碼 | 不必為了查 dep 新增「取得目前部門」API |
| 文件列表回應 | 管理已確認限建立人，新增 `isCreator: boolean` 讓列表正確顯示操作；以後端計算為準 | 不回傳整個 User 或簽署人資料 |
| 詳情、來源預覽、編輯、發起、停止、補簽 | 依 FR-008：詳情、來源預覽及必要歷程開放同部門唯讀；寫入及流程管理維持發起人專屬 | 同部門開放詳情、來源預覽與必要歷程，但不開放管理或簽署他人任務 |

建議錯誤契約：

- 未登入：沿用 401。
- 已登入但缺部門代碼，查 dep 或建立文件：新增穩定業務錯誤（建議 409、`ESIGN_DEPARTMENT_UNAVAILABLE`；名稱於 plan 定稿），訊息為「無法取得您的部門資料，請重新登入或聯絡系統管理員」。其他個人任務依原規則使用。
- role 不在 `dep | created | assigned` 或未知查詢參數：沿用 DTO 驗證 400。
- 有部門但沒有文件：200 空陣列。
- 登入所需上游呼叫失敗：沿用現有上游失敗契約，不把錯誤當作無部門或使用假部門。

## DB：建議新增三個欄位，不新增資料表

| Table | 建議欄位／Entity property | 型別與初始空值策略 | 用途 |
|---|---|---|---|
| `users` | `department_code` / `departmentCode` | `varchar(50) NULL` | 保存上游部門代碼；既有帳號及上游缺值可為 NULL，dep 查詢與新建文件不能以 NULL 授權 |
| `esign_documents` | `created_by_department_code` / `createdByDepartmentCode` | `varchar(50) NULL` | 建立時固定的部門歸屬；NULL 只容納待處理舊資料，新建必須有值 |
| `esign_documents` | `created_by_department_name` / `createdByDepartmentName` | `varchar(150) NULL` | 建立時的名稱顯示快照，不用於權限判斷 |

- `users.department_name` 已存在，直接沿用；`users.department_id` 與既有外鍵保持原意，不拿來儲存上游代碼。
- 文件新增部門索引，候選為 `(created_by_department_code, deleted_at, updated_at, id)`，配合等值部門與未刪除查詢、既有排序。已於 data-model.md 定義，實作時以 SQL／EXPLAIN 驗證。
- 代碼需採一致的精確比對規則，避免資料庫預設大小寫不敏感造成兩個代碼被視為相同；不自行截斷或以名稱合併部門。
- 不對字串代碼建立指向本機 bigint 的外鍵，不複製整張人資部門表。
- 新增 forward／down migration，同步 entity、`server/src/infrastructure/database/schema.sql`、schema metadata／migration／constraint 測試。
- 不改寫 signing payload、signature record、manifest 或既有完成檔；部門歸屬不是簽署證據重新簽發的理由。

## 部門資料時效與建立交易

- 最少方案：在各正式登入成功時同步部門。查 dep 與建立文件時從後端讀取 User 的最新已同步部門，不從前端或舊 session 顯示資料取值。
- 上游人資異動在重新登入同步後才反映；不承諾即時 HR 同步。本機 User 一旦更新，既有 session 的後續查詢也使用新值。
- OAuth 要補查既有 HR 員編查詢來源，不假設 OIDC profile 已提供部門。測試用 dev-login 不應給全公司權限；測試資料需明確安排合成部門。
- 建立文件時保存部門與建立人資料須在同一交易中完成；如需鎖定使用者列避免同時登入更新造成不一致，可沿用既有 repository 模式，由 plan 確認鎖順序。
- 沒有任何前端欄位可覆寫建立部門；草稿編輯及流程變更不得重抓建立人目前部門覆蓋快照。

## 必須決定的相鄰入口

Spec 015 明文允許全體員工查詢歷史匯出、Excel 重下載資料與個人副本重下載。不能默默把這項既有規則當成已受建立人權限保護。

| 檔案／入口 | 已見現況 | 已確認採同部門限制 |
|---|---|---|
| `controllers/exports.controller.ts` 的 `GET esign/exportable-documents` | 沒有傳 userId；`ExportJobRepository.documents()` 查所有未刪除文件 | 傳入登入者，按文件快照限部門 |
| 同 controller 的 ZIP request／detail／retry／download | 有些方法不接收 userId；request 有接收但目前未檢查建立人／部門 | 逐一在服務層加入已定義的授權，避免只限制入口列表 |
| `controllers/export-history.controller.ts` 與 `esign-export-history.service.ts` | 歷史列表、Excel 重下載等具有跨建立人可見規則 | 歷史資料以所屬文件的部門限制；總筆數、各類型筆數、直接紀錄 ID 存取同樣限制 |
| `specs/015-export-history/spec.md` 及 contracts | 明文全員可見 | 必須記錄需求覆寫並更新驗收，不只修改程式 |

使用者已確認本次包含上述匯出入口，必須同步限制部門並取代 Spec 015 的全員存取規則。本人跨部門簽署與外部簽署流程，仍以既有指派資格判定，不能一律以部門阻擋。

## 預計修改位置

| 區域 | 修改位置與責任 |
|---|---|
| 員工資料 | `users/entities/user.entity.ts`；既有 `UserRepository` 僅在需要新讀取方式時修改 |
| 登入同步 | `auth/services/auth.service.ts`、`oauth-identity.service.ts` 與各自測試；上游 `StaffLookupDto` 已有欄位，原則上不用新增上游 API |
| 文件快照 | `esign/entities/esign-document.entity.ts`、`services/esign-draft.service.ts`、建立流程測試 |
| 列表授權 | `dto/document-query.dto.ts`、`controllers/documents.controller.ts`、`services/esign-document-query.service.ts`、`repositories/document.repository.ts` |
| 列表摘要／操作 | `dto/esign-common.dto.ts`／mapper 或 query 組裝、client `api/types/esignDocuments.ts`、`DocumentsListView.tsx` 改 dep；`DocumentsTable.tsx`／`DocumentRowActions.tsx` 與詳情頁區分同部門唯讀、發起人管理 |
| 錯誤 | `server/src/common/errors/app-error-code.ts`、`app-errors.ts`、`client/src/api/errorCodes.ts` |
| 契約與既有 spec | Spec 003 文件列表及建立契約，Spec 002／014 登入資料敘述；Spec 015 依已確認 FR-010 同部門限制 |
| Schema | migration、schema.sql、schema metadata／migration／constraint 測試 |

現有 client `listQuery.ts` 的建立人／名稱、狀態、日期交集篩選可沿用，無需搬到後端或新增搜尋 API。

## UAT 遷移與驗證清單

1. 唯讀盤點有／無部門代碼員工、不同登入入口的員工、舊文件總數與其建立人是否仍存在；本輪尚未連線 UAT 盤點。
2. 欄位 migration 不自動推斷歷史部門，不在 migration 中呼叫外部人資 API。
3. FR-009 已確認：切換前既有 UAT 文件統一歸 IT策略本部系統開發部，使用指定代碼 `1029030000` 並核對該部門名稱，按盤點清單一次性回填；明確記錄這是指定的遷移歸屬，不是已證明的歷史事實。不要新增排程、通用後台或額外資料表。
4. 定義無法回填文件的數量與處理結果，不能把未知歸屬設成共用部門。回填不更動簽署內容與證據。
5. 分別驗證同／跨部門、同名不同代碼、調職、缺代碼、已刪除、舊 session、每種登入入口；驗證前端搜尋與日期篩選只縮小已授權集合。
6. 驗證 `dep`、`created`、`assigned`、未帶 role 的範圍；未支援的 `all`、偽造部門參數與直接存取他人資源的拒絕行為。
7. 依已確認 FR-008／010 驗證詳情與每個匯出入口，包含列表筆數及直接下載；簽署人跨部門本人任務不應退化。
8. 完成新建快照原子性、失敗清理、migration up/down/schema，以及前後端 lint/test/build。前次本機 E2E 因 MySQL 驗證失敗，後續實作需先確認測試環境可用。

## 現在不做

本輪不改功能、不新增 DB 欄位、不執行回填、不部署；不新增部門管理 API、選部門下拉、上下層繼承、代理人、多部門權限或全公司管理員角色。
