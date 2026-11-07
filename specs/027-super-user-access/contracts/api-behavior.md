# API 與前端行為契約

本文件與 [openapi.json](openapi.json) 是 027 的行為契約，027-08 已依實作校正。現有 ResponseInterceptor 使用 `{success:true,data,timestamp}`，錯誤使用 `{success:false,error:{code,message},timestamp}`，沿用原格式，不重複包裝。

## 新入口

| 方法／路徑 | 認證與結果 |
|---|---|
| GET /api/auth/super-user-entries/{entryKey} | 公開位置驗證；有效回 200 data={available:true}，無效／過期／尚未初始化回與不存在路由相同的 404；不列出目前值、不寫 DB、不設 cookie。不限流：由 Next server 代理，所有請求同一來源 IP |
| POST /api/auth/super-user-entries/{entryKey}/sessions | 公開；先驗有效位置，再驗 Origin、限流及帳密；201 回 session view＋HttpOnly Set-Cookie；成功與原會話撤銷同交易 |

兩支都不列在 Swagger（`@ApiExcludeController()`），本文件與 openapi.json 是唯一契約。（使用者 2026-11-06 要求：不得從公開資源看出維護登入存在）
| GET /api/auth/session | 原路徑；接受 employee／super_user，回相容 session union |
| DELETE /api/auth/session | 原路徑；Origin 防護，冪等撤銷與清 cookie，回原 localLogout=completed |

`entryKey` 必須是43字元 base64url；不接受 query token。帳號1～128字元、密碼1～1024 UTF-8 bytes，不 trim／normalize，禁止多餘欄位。body 沿用 Fastify 預設上限 1 MiB（不另設 8 KiB：超過自訂上限的 413 會讓錯誤入口與不存在的路由不同；欄位長度由 DTO 限制，KDF 只在 DTO 通過後執行）。有效入口才執行 DTO credential 驗證。頁面只收帳密，不回顯密碼。

來源網路不允許（見「來源網路」）、無效位置或尚未初始化時，GET／POST 都回與不存在路由相同的 404（狀態、body、標頭），不論 Origin、限流狀態或 body 內容。guard 依序為 SuperUserEntryGuard → OriginGuard → SuperUserThrottlerGuard，所以 403、429 與限流相關的 503 只出現在有效入口；錯誤入口不計入限流。Fastify 在路由比對前產生的錯誤（JSON 格式錯誤 400、超過 1 MiB 的 413）對不存在的路由也相同。（使用者 2026-11-06 要求：不得從公開資源看出維護登入存在）

已知入口且錯誤帳密用同一401 AUTH_SUPER_USER_CREDENTIALS_INVALID；沒有 trusted IP／限流儲存不可用回503，不放行。限流按IP與固定登入類別，不隨entryKey變動。

登入前依序做位置預檢、Origin、限流及輸入驗證，再非同步 KDF；commit 前鎖 singleton 重驗位置／本機設定版本，再替換 session。輪換已先 commit 則回404；登入先 commit 則該會話有效，不因隨後網址輪換撤銷。

## 回應與相容

Employee data：`{actor:{kind:'employee',userId:123},user:{id:123,empId:'...',name:'...',departmentName:null,titleName:null,lastLoginAt:null},expiresAt:'ISO UTC'}`。user 欄位沿既有形狀，不新增 permissions。

Super data：`{actor:{kind:'super_user',displayName:'Super user'},user:null,expiresAt:'ISO UTC'}`。不回部署帳號、fake empId、entryKey、fingerprint、generation 或 token。

OAuth start/callback、WebView launch/bridge/activation 路徑及輸入不改；callback session 使用上述 employee additive shape。OAuth／WebView 成功時傳入目前 cookie 給 SessionService 原子替換，WebView POST 仍303導向 `/`，不把 token 回 JSON。GET session／logout 不需知道隱藏入口。

OAuth callback 與 WebView launch 在上游身分已驗證後被本系統規則拒絕（缺員編、Portal 判定不可登入、本機帳號停用或已刪除）時，回應狀態與錯誤碼不變，另寫匿名 `login.rejected`／`employee_ineligible`；事件寫不進去時改回 503 AUTH_DB_UNAVAILABLE。兩者都不設 cookie、不撤原會話。未通過信任關卡的失敗（無效啟動碼、JWT 無效或重放、OAuth 取消、state／交易無效、token 驗證失敗）與系統故障不寫事件，分類見 [data-model §3](../data-model.md)。

移除 POST /api/auth/login；dev-login、forgot/reset/change-password 不新增替代路徑。舊帳密路徑404，不 redirect 到隱藏入口。

## 錯誤碼（新碼於 app-errors.ts 集中建立）

| HTTP | code | 含義／呼叫端行為 |
|---|---|---|
| 400 | INVALID_REQUEST（沿用） | 已知入口的輸入不合法，message 為欄位驗證訊息；修正，不自動重送 |
| 401 | AUTH_SUPER_USER_CREDENTIALS_INVALID | 帳密錯誤，訊息「帳號或密碼錯誤」 |
| 401 | UNAUTHORIZED（沿用） | 沒有 cookie「請先登入」；會話不存在、過期、已撤銷、已被替換或帳密版本已非啟用版本「登入已失效，請重新登入」 |
| 403 | CSRF_ORIGIN_REJECTED（沿用） | 來源不符（隱藏入口只在入口有效時檢查）；不重試 |
| 403 | AUTH_ACTOR_NOT_ALLOWED | Super user 存取尚未接入的員工業務；不是登入過期 |
| 404 | NOT_FOUND（沿用，「找不到請求的資源」） | 入口不存在／舊入口／尚未初始化／來源網路不允許／移除的登入路徑；與不存在的路由相同 |
| 409 | AUTH_SESSION_REPLACED | 同一舊會話已被另一登入取代；不覆寫 cookie，重新整理目前身分 |
| 409 | AUTH_SUPER_USER_GENERATION_CONFLICT | 只用於 REPL `activateCredentials`：expectedGeneration 不是目前版本，見 [operations.md](operations.md) |
| 413 | INVALID_REQUEST（沿用，「請求內容超過大小限制」） | body 超過 1 MiB（Fastify 預設，不存在的路由也相同） |
| 429 | REFUSE_SERVICE（沿用，「系統拒絕服務，請聯絡IT人員」） | 只有有效入口的 POST；Retry-After秒數，等待後人工重試 |
| 503 | AUTH_SUPER_USER_UNAVAILABLE | 有效入口上 local fingerprint不符active、無法取得client IP或限流儲存不可用；Super user 會話驗證時本機設定不符；不揭露設定差異。HTTP 的尚未初始化改回 404 |
| 503 | AUTH_DB_UNAVAILABLE（沿用，「登入服務暫時無法使用」） | DB 不可用；DELETE 撤銷失敗時不清 cookie，會話仍有效可重試 |

成功回應與 handler 內的錯誤帶 `Cache-Control: no-store`；guard 與框架層提前拒絕的回應（Origin、限流、入口、會話驗證、body 上限）不帶 Cache-Control，這些回應不含身分或入口資料。前端用每次操作明確錯誤，不能把帳密401套用全站「員工登入過期」對話框。

## Cookie 與瀏覽器

使用 FT_ESIGN_SESSION、HttpOnly、host-only、Path=/、maxAge=28800。staging／production Secure+SameSite=None，本機Lax。只在commit成功後Set-Cookie；登入失敗不清原cookie。DELETE 同屬性清除，OAuth transaction cookie 亦按原規則清理。跨站POST拒絕，不因iframe origin列在信任清單而允許跨站管理登入。

UI 公開網址 `/ops-access/<入口>` 本身沒有頁面，實際頁面在 `app/ops-access-page/[entryKey]`，不放 `(main)`。proxy 在 RSC／HTML 渲染前先驗來源網路、再以 no-store fetch 向後端驗位置；都有效才 rewrite 到實際頁面並加 Referrer-Policy:no-referrer、X-Robots-Tag:noindex,nofollow、frame-ancestors 'none'（只套維護頁，不影響 WebView 與可嵌入頁）。其餘情況不 rewrite，由 Next 當作不存在的網址回 404：HTML／RSC 與不存在的網址逐位元組相同、不含表單（rewrite 到 `/_not-found` 會多出 `x-middleware-rewrite` 與 `s-maxage` Cache-Control，可被分辨）。頁面以 `connection()` 每次請求渲染，回應 no-store；失效後提交仍由後端拒絕。直接開啟 `/ops-access-page/*` 回 404（rewrite 到 `/_not-found`，標頭與未登入的員工頁相同）。proxy matcher 只排除靜態資源、不列路徑；安全標頭不放 `next.config.ts` 的 `headers()`。錯誤不含上游URL。（使用者 2026-11-06 要求：不得從公開資源看出維護登入存在）

成功後清除輸入、replace('/')、清理舊session相關query cache並重新取身分；共用layout沿驗收系統慣例讓employee與沒有員工資料（`user:null`）的身分使用同一個UserProfile，後者顯示後端給的 `displayName`，兩者從相同選單登出，不建立Super user專用Banner。Super user 專用的請求、路徑、型別、錯誤碼與訊息只在隱藏頁的 chunk（`features/super-user-login`），共用模組不含 `super_user` 等字面值；帳密錯誤以通用的 mutation `meta.handlesOwnErrors` 避開全站「登入已過期」。（使用者 2026-11-06 要求：不得從公開資源看出維護登入存在）027不擅自展示可用業務權限。EmbedBridge遇super actor為mismatch，遵循既有撤銷／要求launch流程，不偽造empId。

## 來源網路（使用者 2026-11-06 確認）

隱藏頁與其 API 只允許公司網路（VPN 與辦公室的固定出口 IP）。判斷只在 client 的 `src/proxy.ts`，後端不重複：

- 允許清單：client server-only `SUPER_USER_ALLOWED_CIDRS`，逗號分隔的 IPv4／IPv6 CIDR，以 `node:net` 的 `BlockList` 比對。未設定或空白時一律不允許（維護登入停用），員工與公開頁不受影響。任一項不是合法 CIDR 時 `BlockList` 丟錯，proxy 載入失敗，每個請求（含 `/api/health`）回 500、不轉給後端，部署 smoke 失敗。不另做格式檢查。
- client IP 只看 `X-Real-IP`，由主機 Nginx 以連線來源覆寫（見 [UAT CI/CD](../../../docs/deployment/uat-cicd.md)）；不採用可偽造的 `X-Forwarded-For`。缺少、不是 IP 或不在清單都視為不允許。
- 頁面 `/ops-access/<入口>`：先驗來源網路，允許時才向後端驗入口；不允許時不呼叫後端，回應與不存在的網址相同。Next 會對改寫後的實際頁面路徑再執行一次 proxy，該路徑做同樣檢查，通過才放行（有效入口一次頁面查驗兩次），直接開啟且未通過時回 404。
- `/api/*`（與 `next.config.ts` rewrite 同範圍，不分大小寫）：來源網路不允許時，proxy 在 request 加 `x-entry-network-denied` 照常轉給後端，`SuperUserEntryGuard` 看到就回 404，回應即是後端不存在路由的 404。proxy 不比對隱藏 API 的路徑：後端會解碼百分比編碼（如 `%73uper-user-entries`），只比對路徑會被繞過。client 自帶這個 header 只會讓自己 404。其他 API 只多這個 header，不查 session、不多呼叫後端。
- 被擋時不寫 log（不記允許清單與 client IP）。

## Logging contract

將前端 /ops-access/* 與後端 /api/auth/super-user-entries/* 正規化為路由模板；同時禁止原始url、query、body、Referer、Set-Cookie被一般log記錄。覆蓋正常、404、guard、429、exception及SSR錯誤。Fastify 比對路由前會解碼百分比編碼，Nest 的路徑正規化與各處路徑判斷（Origin、query／body 不記錄）也先解碼再比對，`/api/auth/%73uper-user-entries/…` 與明文路徑同樣遮罩、同樣要求 Origin。反向代理須使用遮罩後URI或為此路徑關閉raw access log；Next production及開發request log亦需檢查／關閉此類raw記錄，不僅修改Nest masker。

WebView activation 啟動碼無效、過期或已用過只記 `auth.launch_code_rejected`（不含啟動碼、cookie、token 或員編），不寫安全事件；此端點沒有限流。

REPL只在明確currentEntry呼叫回原路徑，不記history、不經application logger；不新增公開查當前入口的API。
