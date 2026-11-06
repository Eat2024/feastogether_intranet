# CKS Auth、角色、權限與 REPL 移植調查

日期：2026-11-04。範圍：靜態原始碼 survey 與設計建議，尚未實作或修改 schema。

> 後續 grilling 決策已整理為 [027～029 規格與決策索引](2026-11-04-intranet-access-spec-roadmap.md)。本 survey 保留調查當時的建議與待確認事項；初始授權現已確定為有效員工固定具備同仁資格，並新增唯一 Super user 本地登入例外，實作範圍以新規格為準。

來源為本機工作目錄：intranet `44fa459`、CKS `142de1a`、OAuth `46ca66c`。使用者提供的 `~/Doc/CKS_Acceptance_System` 不存在，實際來源為 `~/Documents/CKS_Acceptance_System`。外部專案相對連結假設三個 repository 仍位於同一父目錄。

## 結論

建議選擇性移植 CKS 的角色／權限管理與 REPL 操作模式；沿用 intranet 既有 OAuth、員工與 MySQL session，避免搬回 CKS 的完整 Auth。多子功能授權需要同時處理角色歸屬、權限歸屬、使用者角色指派、管理員邊界與 API 檢查，不能只在角色上增加一個分類欄位。

以下資料模型、API 與模組劃分均為提案，不代表已核定或已建立資料表。

## 1. 現況與可移植範圍

| 項目 | CKS／intranet 現況 | 建議 |
|---|---|---|
| Auth | CKS 的角色與權限也在 AuthModule；intranet 已有 OAuth start/callback、員工配對與本地 session | 保留 intranet 身分驗證，另建授權責任邊界 |
| Role | CKS 使用單一全域角色與 `is_admin` | 改為子功能角色；使用者角色指派獨立建模 |
| Permission | CKS 有權限目錄、角色權限與 API 宣告 | 移植管理流程概念，重新定義子功能邊界與穩定權限碼 |
| REPL | CKS 有獨立入口與專案專用 helpers；intranet 尚無對應指令 | 移植入口模式，依 intranet service/entity 重寫 helpers |
| 前端 | intranet 導覽固定，沒有角色管理、登入或 OAuth callback 頁 | 需補 OAuth 入口、callback、角色指派及依權限呈現導覽 |

來源：[CKS AuthModule](../../../CKS_Acceptance_System/server/src/features/auth/auth.module.ts)、[CKS Role](../../../CKS_Acceptance_System/server/src/features/auth/entities/auth-role.entity.ts)、[CKS AuthGuard](../../../CKS_Acceptance_System/server/src/framework/guards/auth.guard.ts)、[CKS REPL](../../../CKS_Acceptance_System/server/src/console/repl.ts)、[intranet AuthModule](../../server/src/features/auth/auth.module.ts)、[server scripts](../../server/package.json)、[固定導覽](../../client/src/components/SideNav.tsx)、[前端 API 入口](../../client/src/api/endpoints.ts)。

### intranet 已有的 OAuth 能力

- 後端已註冊 OAuth start/callback。start 建立 state、nonce 與瀏覽器交易；callback 換 token、驗證身分、讀 UserInfo，再發 intranet 的 session。
- `employee_number` 對應 `users.empid`，不是把 OAuth 的 `sub` 當作本地 user ID。登入仍向 Portal 查有效員工與可信部門；OAuth 成功不代表可以略過這項資格檢查。
- AuthGuard 驗證 HttpOnly cookie 的 opaque token，DB 儲存其雜湊；每次驗證檢查 session 與本地員工啟用／刪除狀態。OAuth callback 回傳程式中的 `accessToken` 實際是 intranet session token，不是上游 access token。
- 現在登出只撤銷 intranet session，不等於登出 OAuth 平台。
- 前端目前依賴入口網 launch；401 顯示重新從入口網進入。調查未找到登入／OAuth callback 頁，不能稱端到端 OAuth 已完成。

來源：[OAuth controller](../../server/src/features/auth/controllers/oauth.controller.ts)、[登入協調](../../server/src/features/auth/services/oauth-login.service.ts)、[身分配對](../../server/src/features/auth/services/oauth-identity.service.ts)、[員工資格](../../server/src/features/auth/services/eligible-staff.service.ts)、[session 與登出](../../server/src/features/auth/services/auth.service.ts)、[AuthGuard](../../server/src/framework/guards/auth.guard.ts)、[前端 session 過期處理](../../client/src/components/providers/SessionExpiredDialog.tsx)。

### 要達到「只接 OAuth、不提供本地登入」的差距

1. 移除 intranet `POST /api/auth/login` 與帳密驗證依賴。現況是 intranet 接收帳密後交上游驗證，並非本地密碼資料庫，但仍不符合使用者要求的 OAuth-only 登入介面。
2. 補齊前端登入導向與 `/oauth/callback`，沿用同源 API、Origin 防護、交易 cookie 與 no-store。
3. 保留本地 `users` 與 session：前者承接文件、簽署與稽核關聯，後者是登入後的應用程式會話；兩者均不等於提供本地帳密登入。
4. WebView launch 是現有入口網整合，不應在 survey 中默認刪除。若 OAuth 成為唯一登入入口，還要移轉入口網／iframe 流程，再移除其入口與設定依賴。AuthService 建構時目前就讀取 WebView 公鑰，單純刪 route 仍無法解除依賴。
5. OAuth 設定目前允許完全未配置、同時又保留 logout URL／token encryption key 的必填驗證；實際登入不保存上游 token，登出也未呼叫該上游 logout。OAuth-only 實作時需依保留流程清理這些歷史設定，不能直接宣稱六個設定都仍必要。

來源：[帳密與 WebView controllers](../../server/src/features/auth/controllers/auth.controller.ts)、[AuthService](../../server/src/features/auth/services/auth.service.ts)、[OAuth 設定](../../server/src/infrastructure/http-client/oauth/oauth.config.ts)、[OAuth client](../../server/src/infrastructure/http-client/oauth/oauth.client.ts)、[入口網整合契約](../../specs/002-webview-sso-session/contracts/embed-postmessage.md)。

### OAuth 專案契約核對

本機 OAuth 原始碼的 profile claims 包含 `name`、`employee_number`，email scope 提供 email；與 intranet 取用欄位一致。intranet 請求 `openid profile email`，使用 confidential client／`client_secret_post`，目前未使用 PKCE。OAuth provider 對 public client 或 `require_pkce=true` 強制 PKCE，所以不能直接替 intranet 註冊成要求 PKCE 的 client 而不改呼叫端。這是程式契約核對，尚未驗證部署中的 client 註冊、redirect URI 或實際登入。

OAuth 負責可信身分；各子功能角色／權限由 intranet 管理。不能把 OAuth 的 scope（例如 `profile`、`staff`）直接視為 intranet 的文件操作權限。

來源：[intranet OAuth client](../../server/src/infrastructure/http-client/oauth/oauth.client.ts)、[provider claims](../../../feastogether_oauth/src/features/oidc/config/claims.config.ts)、[provider scopes](../../../feastogether_oauth/src/features/oidc/config/scopes.config.ts)、[provider PKCE 規則](../../../feastogether_oauth/src/features/oidc/config/pkce.config.ts)。

## 2. 子功能角色與權限提案

以 `module_key` 表示授權所屬的業務子功能，例如 `esign`；避免與 NestJS Module 類別混淆，也不要用部門代碼作替代。子功能是權限邊界，部門是資料可見範圍，兩者獨立。

| 擬議資料 | 關鍵欄位／約束 | 意義 |
|---|---|---|
| users（既有） | 保留既有 ID 與 empid | 同一位員工跨子功能共用身分 |
| roles | `id, module_key, role_code, role_name, is_active`；唯一 `(module_key, role_code)` | 每個角色只屬於一個子功能 |
| permissions | `id, module_key, permission_code`；唯一 `(module_key, permission_code)` | 每項權限只屬於一個子功能 |
| user_roles | `user_id, role_id`；唯一 `(user_id, role_id)` | 員工可持有不同子功能的角色；同功能多角色時取權限聯集 |
| role_permissions | `role_id, permission_id`；唯一 `(role_id, permission_id)` | 角色只能連到同 module 的權限 |

這裡先列邏輯結構，實作時仍須帶入專案共用稽核欄位、FK、索引與軟刪除策略。若採可恢復的軟刪除關聯，重新授予應恢復既有列，不能直接插入而撞唯一鍵。

**關鍵限制：** 單純對 `role_id`／`permission_id` 各建 FK 不會阻止跨子功能配對。至少須由唯一管理寫入入口在同一交易驗證兩側 module；若要 DB 層也保證，可在關聯表帶 `module_key`，透過父表複合唯一鍵與複合 FK 限制。後者增加欄位與索引，應在 schema 設計時明確選定。

`module_key` 初期可由程式內固定清單定義，無需立即增加子功能資料表。只有確定需要管理員動態建立、停用或排序子功能時，再評估獨立目錄表。權限代碼可表達成 `esign.document.create`；不論是否在字串加前綴，伺服器仍要核對權限所屬 module，不能僅相信前端傳入值。

若需求限定「每人每個子功能只能一個角色」，替代方案是 `user_module_roles(user_id, module_key, role_id)` 並唯一 `(user_id, module_key)`；這比多角色聯集更簡單，但會限制兼任角色。建議先採多對多，作為待確認設計，不沿用 `users.role_id`。

### 管理員與授權管理

- 不移植 CKS `is_admin` 的全域放行語意。電子簽管理員只管理 `esign`；驗收管理員只管理其所屬子功能。
- 功能角色管理權、角色指派權與業務操作權要分開。擁有文件操作權不代表可以替自己加角色。
- 每個管理 API 都以 URL 的 module 與實際角色／權限歸屬交叉驗證；只在前端篩選是不夠的。
- 若需要平台層管理員，單獨定義其可管理的子功能與授權管理能力；不要預設可讀所有文件或代簽。
- 第一個管理員可經明確的初始化／REPL service 操作建立並留稽核；不要讓第一位 OAuth 登入者自動成為管理員。

## 3. 授權執行方式

建議責任劃分：`AuthModule` 處理 OAuth/session，`AuthorizationModule` 處理角色、權限、指派及授權查詢。不必為每一張表各建立一個 NestJS module。

```text
OAuth 登入 → 本地員工與 session
API request → AuthGuard（身分）
            → 功能權限檢查（module + permission）
            → 業務 service（建立人／部門／簽署資格／文件狀態）
```

RBAC 不能取代電子簽既有資料授權。例如有 `esign.document.read`，仍不代表能讀別部門文件；有簽署功能權限，仍必須是該文件指定簽署人。外部 Email 簽署繼續使用獨立憑證，不建立假員工或套用內部角色。現有 `@Public()` 端點仍須保留各自 pre-session 防護。

CKS 目前 guard 直接讀 `@RegisterApi` 的 permissions；多權限為 OR，空陣列代表只要求登入，缺 metadata 則拒絕。不能只看 API permission entity 註解就認為 DB 綁定決定執行期授權。移植時要明定每支端點是公開、登入即可、或需要功能權限；OR／AND 若都需要，應明確區分，不暗中改變原語意。原 intranet API 不能因尚未補 metadata 就在上線後全部 403，也不能永久默認漏標就放行；新規格應包含完整 route 分類與檢查。

來源：[CKS guard](../../../CKS_Acceptance_System/server/src/framework/guards/auth.guard.ts)、[CKS API permission entity](../../../CKS_Acceptance_System/server/src/features/auth/entities/auth-api-permission.entity.ts)、[intranet 資料授權](../../server/src/features/esign/services/esign-access-policy.service.ts)。

初期建議直接讀 DB 取得有效角色權限，不急著移植 CKS 授權快取。若效能證據支持快取，必須同時設計角色修改、角色停用、員工角色變更的失效機制與多實例一致性；不可要求員工重新登入才撤權。既有 session 不必承載完整 permissions，也不必改回 JWT。

### API 與前端影響（介面草案）

- 沿用 OAuth start/callback、session 讀取與登出端點，移除帳密入口。
- 可新增 `GET /api/me/authorization` 回傳依子功能整理的能力；避免前端自行從角色名稱推導權限。
- 角色列表／編輯／權限設定可在 `/api/modules/:moduleKey/roles` 下；員工角色指派獨立處理，且限定可管理的 module。路徑與 DTO 尚未定案。
- 前端管理頁需有子功能篩選，角色選項及權限樹只能顯示該子功能；導航和按鈕依能力呈現，server 每次仍重驗。
- 401 代表未登入／session 無效；403 代表已登入但功能權限不足。不能把所有 403 都導去重新 OAuth 登入。

## 4. CKS 移植清單與 REPL 細節

### 後端與前端不可漏掉的依賴

CKS 的 `auth_users.role_id` 是單一角色 FK；權限目錄則是 group → job → permission。group 目前只是目錄分類，不能當成已實作的子功能隔離。可評估將原有 group 調整為子功能目錄，避免無需要地增加第四層；核心仍是 role、permission 與指派關聯須有一致的範圍。

CKS 權限同時有數字 ID 與字串 `permissionKey`：管理／關聯使用 ID，執行期比對如 `roleManagement.view` 的鍵。角色服務的名稱查重與排序目前涵蓋全站，移植時要一併改為該子功能，不能只改列表查詢。

角色修改 commit 後會 `refreshRoleUsers`；帳號改角色／狀態會 `refreshUser`，停用帳號另撤銷所有 session。多子功能情境必須區分「停用整個員工帳號」和「撤銷某子功能角色」，後者不應登出其他功能。管理流程亦依賴 `audit_logs`／`audit_log_targets`，因此需要決定 intranet 的授權異動稽核落點，不能只複製 role service 而遺漏依賴。若搬授權快取，原 `authz:user:<userId>` 是單角色形狀，必須處理 namespace／資料版本，不能直接用新結構讀舊快取。

來源：[CKS User](../../../CKS_Acceptance_System/server/src/features/auth/entities/auth-user.entity.ts)、[權限字典](../../../CKS_Acceptance_System/server/src/features/auth/seeds/permission-dictionary.ts)、[角色服務](../../../CKS_Acceptance_System/server/src/features/auth/services/role.service.ts)、[帳號服務](../../../CKS_Acceptance_System/server/src/features/auth/services/user-account.service.ts)、[授權服務](../../../CKS_Acceptance_System/server/src/features/auth/services/api-authorization.service.ts)、[授權快取](../../../CKS_Acceptance_System/server/src/features/auth/services/authorization-cache.service.ts)。

前端可參考 CKS 的角色列表、權限矩陣與帳號角色指派，但不能直接搬 provider/types：其 AuthProvider 讀單一 role，PermissionProvider 以 jobKey 找項目，`actions.every` 是 AND，與後端多權限 OR 不同。新的查詢 query key 必須包含 module，避免切換子功能後沿用另一功能的角色／矩陣。元件需適配 intranet 的 theme、API envelope 與目錄規範。

來源：[CKS AuthProvider](../../../CKS_Acceptance_System/client/src/providers/AuthProvider.tsx)、[PermissionProvider](../../../CKS_Acceptance_System/client/src/providers/PermissionProvider.tsx)、[API types](../../../CKS_Acceptance_System/client/src/api/types/auth.ts)、[角色管理頁](../../../CKS_Acceptance_System/client/src/app/%28dashboard%29/permissionManagement/roleManagement/)、[帳號管理頁](../../../CKS_Acceptance_System/client/src/app/%28dashboard%29/permissionManagement/accountManagement/)、[角色元件](../../../CKS_Acceptance_System/client/src/components/features/roleManagement/)。

### REPL 具體取捨

- 可移植：獨立 console entrypoint、`repl`／`repl:dev` 指令模式，以及查詢員工有效權限、角色權限與稽核的操作介面。
- 需改寫：`allEntities.ts` 硬列的 entity／repository 清單，改為 intranet 現有 entities；`userPerms` 應直接重用新授權服務，確保停用角色與撤權結果和 API 一致。
- 不移植：CKS 驗收／SAP／物料 entities、專用 helpers、饗賓帳密登入 helper、本地超管密碼 seed。
- 啟動副作用：CKS 透過 `repl(AppModule)` 建立應用 context；API registry 的 `onApplicationBootstrap` 會同步寫入 API registry。即使沒有 listen HTTP，也不能當成唯讀啟動。移植時檢查實際載入的初始化 hooks，維持 intranet HTTP／worker 邊界，不載入 worker 消費與排程。
- 寫入邊界：`sqlQuery`／DataSource／repository 均可直接寫 DB，會繞過 service 的業務檢查、顯式稽核與快取更新。授權異動 helper 應走相同 service，並設置明確操作者；不要把 HTTP RBAC 當作 REPL 的保護，REPL 本身沒有該 request guard。

來源：[REPL 入口](../../../CKS_Acceptance_System/server/src/console/repl.ts)、[context 與 entities](../../../CKS_Acceptance_System/server/src/console/scripts/allEntities.ts)、[userPerms helper](../../../CKS_Acceptance_System/server/src/console/scripts/getPermsByUser.ts)、[API registry 啟動 hook](../../../CKS_Acceptance_System/server/src/features/auth/services/api-registry.service.ts)、[CKS scripts](../../../CKS_Acceptance_System/server/package.json)、[RBAC seed](../../../CKS_Acceptance_System/server/src/infrastructure/database/seeds/rbac.seed.ts)。

## 5. 既有規格衝突與導入順序

Spec 001 的 FR-001～008、FR-031 明確移除 RBAC／API registry 與員工角色關聯，並要求一般 API 只驗 session。這是當時電子簽 Stage 1 的邊界。本次多功能 intranet 需求應另立新規格，明確取代相關限制；不要回頭改舊 migration 或宣稱原規格本就包含此需求。目前 Auth runtime 也已超過 Spec 001 當時的無登入端點狀態，應以現行程式及後續規格一併判讀。

來源：[Spec 001](../../specs/001-auth-cleanup-schema/spec.md)、[現行 FeatureModule](../../server/src/features/feature.module.ts)。

建議順序：

1. 確定登入入口（獨立 OAuth 與既有 WebView 的過渡方式）、角色基數、管理員邊界與現有員工的初始授權。
2. 新規格與 API contract 定案，再建立增量 migration、entity、schema dump 與稽核設計；保留既有 users ID／文件關聯。
3. OAuth 前端閉環與帳密入口移除；若移除 WebView，連同入口網整合與設定依賴一起完成。
4. 子功能角色／權限／指派與 guard、管理 API、前端管理畫面；先列齊現有電子簽 route，再切換授權。
5. 移植 REPL 的最小入口與必要維運 helpers，不帶入 CKS/SAP 功能。
6. 驗證跨子功能隔離、即時撤權與電子簽既有資料邊界，再上線。

現有員工的初始授權必須有明確決策：全部給電子簽一般使用者角色，或僅授予指定名單。沒有這一步，改成 default-deny 會讓既有員工突然失去功能；也不可用全域 ADMIN 作過渡。

## 6. 後續驗收案例與待確認事項

實作後至少驗證：

- 同員工可在電子簽為管理者、另一子功能為唯讀；跨 module 的 role／permission ID 注入遭拒。
- 子功能管理員不能提升自己為平台管理員，也不能修改其他子功能角色。
- 角色停用、撤銷指派與修改權限後，既有 session 的下一次授權按設計生效；如使用快取，驗證其失效與故障行為。
- OAuth state／nonce／重放防護、callback 後身分映射、帳密 endpoint 不再可用；無本地密碼功能。
- 文件建立人寫入限制、同部門讀取／匯出、指定人簽署與外部 Email 憑證流程不被角色放寬。
- 啟動 REPL 不啟動 worker 消費、排程或非預期初始化；寫入操作走既有 service 與稽核。

尚待設計確認：每個子功能允許單角色或多角色；是否需要平台授權管理員；WebView 是否保留；既有員工初始角色；登出是否只登出 intranet 或要求全站登出。

本次僅讀取原始碼與文件，未呼叫正式 API、未連線資料庫、未變更其他專案、未執行 migration 或部署，也未讀取實際 `.env`／secret。沒有程式變更，因此未跑 lint、build、單元或整合測試；已做文件來源與差異檢查。部署中的 OAuth 設定、真實登入、REPL 啟動副作用仍須於實作驗證階段確認。
