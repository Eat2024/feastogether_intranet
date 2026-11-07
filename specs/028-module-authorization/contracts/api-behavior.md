# 管理 API 與相容契約

狀態：028實作與HTTP驗收契約。機器契約見 [openapi.json](openapi.json)，能力目錄見 [permissions.md](permissions.md)。所有成功／失敗沿專案 `{success,data,timestamp}`／`{success:false,error:{code,message},timestamp}`。管理API皆SuperUserOnly、no-store；所有寫入Origin防護，不新增帳密或cookie。

## 管理資源

| 方法／路徑 | 行為 |
|---|---|
| GET /api/authorization/modules | compiled子功能目錄 |
| GET /api/authorization/modules/{moduleKey}/permissions | 該module權限目錄，含assignable，不能編輯 |
| GET /api/authorization/modules/{moduleKey}/roles | 角色分頁，含protected／active／version，預設含未刪除的啟用與停用角色 |
| POST 同上 | roleName，後端產生不可變roleCode；201 |
| GET /api/authorization/modules/{moduleKey}/roles/{roleId} | 詳細角色與permissionKeys |
| PATCH 同上 | roleName及／或isActive、expectedVersion；200，非空patch |
| DELETE 同上 | expectedVersion查詢參數；無有效指派才soft-delete，204 |
| PUT /api/authorization/modules/{moduleKey}/roles/{roleId}/permissions | permissionKeys完整集合、expectedVersion；差異更新，200 |
| GET /api/authorization/modules/{moduleKey}/roles/{roleId}/employees | 有效指派者分頁；只回userId／name，不回員編或完整人事資料 |
| GET /api/authorization/modules/{moduleKey}/employees/{userId}/roles | explicit roleIds／implicitRoles；無員工404 |
| POST /api/authorization/modules/{moduleKey}/employee-role-assignments | body empId／roleIds／expectedRoleIds；原子查核、預建員工及覆寫該module一般角色集合，200 |
| GET /api/authorization/events | limit／beforeId cursor，可選moduleKey，查授權audit白名單 |
| GET /api/me/authorization | 任一有效actor的本人能力，見permissions契約 |

路徑只放本地ID或公開目錄代碼，不將員編放URL。employee-role-assignments是建立一次角色配置結果的資源，重送完全相同目標可no-op；不是一次替換所有員工權限。roleIds=[]表示撤掉該module所有一般角色，不能撤同仁。

## 輸入／交易

moduleKey1～50，格式`[a-z][a-z0-9-]*`，須存在compiled catalog；roleId／userId正整數字串，解析需安全範圍。roleName trim後1～100字、同module未刪除名稱唯一；isActive布林；expectedVersion正整數。permissionKeys每項1～100字、最多100、不允許重複或unknown；roleIds／expectedRoleIds各最多50、不重複、只引用同module一般角色。

empId1～32字，保留大小寫與前後字元、不trim或轉數字；Portal exact-match有效員工。輸入不接受actor、isProtected、userId替代empId或任意departmentName。未知欄位400。POST assignment先查上游，再開本地transaction；不沿用上游錯誤回應／個資到log。user本地inactive／deleted不復活。

role變更鎖role並比expectedVersion，成功version+1；no-op不加版也不新增audit。assignment鎖user再role，以expectedRoleIds核對目前explicit集合；目標已一致可冪等成功。role／assignment與audit在同transaction；任何FK、版本或audit失敗不留半套關聯。

平台目錄目前沒有可指派權限，不接受platform一般角色建立；同仁role不得透過任何CRUD／permission／assignment間接改變。自訂角色只能引用assignable權限，禁止platform.authorization.manage。

## 分頁與輸出

列表採limit預設20、最大100；beforeId為正整數字串（倒序id）。roles回 `{items,nextCursor}`；role view含id/moduleKey/roleCode/roleName/isActive/isProtected/version/permissionKeys；employee role view含userId/moduleKey/roleIds/implicitRoles（同仁為 `{roleCode:'colleague',source:'baseline'}`），不把隱含角色ID放入可修改roleIds。

assignment回 `{userId,moduleKey,roleIds,implicitRoles,changed}`，不回Portal整筆資料。audit回固定欄位，before/after僅白名單設定差異；所有ID在管理API序列化為字串，避免bigint不精確。本人actor.userId沿027既有安全整數number相容，既有users ID超安全範圍時依既有fail-closed，不偷偷轉float。

## 錯誤

| 狀態 | code | 行為 |
|---|---|---|
| 400 | REQUEST_FORMAT_INVALID | 格式、未知欄位或invalid module／permission |
| 401 | UNAUTHORIZED（027 AUTH_TOKEN_MISSING／AUTH_TOKEN_INVALID 的HTTP code） | 無有效actor；不洩漏細節 |
| 403 | AUTHORIZATION_DENIED | 有身分但缺功能或非Super user管理操作 |
| 403 | AUTHORIZATION_PROTECTED_ROLE | 企圖修改同仁、指派維護專用能力 |
| 404 | AUTHORIZATION_RESOURCE_NOT_FOUND | 目標不存在、已刪除或module路徑與實體不符 |
| 409 | AUTHORIZATION_VERSION_CONFLICT | expectedVersion／expectedRoleIds不符；重新讀取後決定，不能自動覆寫 |
| 409 | AUTHORIZATION_ROLE_NAME_CONFLICT／AUTHORIZATION_ROLE_IN_USE | 名稱衝突／尚有有效指派 |
| 403 | ACCOUNT_DISABLED（沿既有碼） | 本地員工停用／刪除不自動恢復 |
| 503 | AUTHORIZATION_UNAVAILABLE | DB或catalog不可用，不fallback |
| 422 | AUTHORIZATION_EMPLOYEE_INELIGIBLE | 指派目標不存在、失效或非唯一有效員工；assignment服務將資格查核的AUTH_EXCHANGE_FAILED映射至此，不能令有效Super user被誤判登出 |
| 502 | STAFF_LOOKUP_FAILED | Portal故障，沿既有安全裁切；不修改登入流程原錯誤語意 |

既有資料不可見仍可回ESIGN_RESOURCE_NOT_FOUND(404)，不把它改成透露文件存在的403。業務狀態／文件完整性錯誤保留既有碼。

## 電子簽既有契約增量

1. multipart create fields DTO增加departmentCode；僅super必填且由Portal有效部門驗證；employee不接受覆寫。檔案／title／fields不變。
2. actor-aware document／job／history mappers增加createdBy/exportedBy.kind；employee原欄位不變，Super user對employeeNo回null且name='Super user'。client既有types及顯示只作nullable相容，不新增管理頁。下載檔名中的建立人不得以null變成undefined字串。
3. 所有controller以CurrentActor取管理操作者；本人簽署仍要求employee且使用其真實userId。不能把document.createdByUserId當成當前管理者傳入service。
4. document列表的`role`既有查詢值是資料範圍，不是RBAC角色。新增明確`role=all`僅read-all可用；其他role保持原義。super預設無employee本人範圍，未帶role時使用all；普通員工預設行為保留。不得由任意departmentCode query繞過部門。既有DocumentsListView明確傳role=dep，須作最小caller相容：由027 actor判別Super user傳all，員工保留dep；不新增篩選UI或業務畫面。
5. 已受理job保存真正actor；worker以job actor執行已受理工作，不重新假裝creator，也不因管理者無員工身分進入本人簽署分支。後續poll/retry/download以目前actor重新授權。
6. 既有departmentFile及pdf歷史個人副本下載收緊為本人指派；合法一般ZIP／Excel／整份文件匯出沿另一能力與資源政策，不可讓histories成為旁路。

7. 文件詳情新增 `canManage` 作管理／唯讀 DTO 的 discriminator。`isCreator` 保留原員工建立人判斷，管理他人文件不改成 true；建立人失去 manage 時仍 `isCreator=true`、`canManage=false`。欄位及管理簽署資訊依 canManage 裁切，既有詳情／編輯／簽署人設定 caller 以 canManage 判斷管理能力，所有寫入仍重新授權。
8. Super 建立的 departmentCode 保留原碼，不 trim／轉大小寫；只能匹配一筆未停用且有名稱的 Portal 部門。格式或無效部門回既有 400 `INVALID_REQUEST`，Portal 查核不可用回 503 `ESIGN_DEPARTMENT_LOOKUP_UNAVAILABLE`。

## 安全紀錄

管理request body及員工指派資料不進一般access log；query僅限module／cursor等非個資，before/after只入授權audit白名單。不得把隱藏登入位置、cookie、Portal raw error或完整員工物件放入契約例子。
