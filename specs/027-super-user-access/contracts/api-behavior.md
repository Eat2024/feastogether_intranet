# API 與前端行為契約

本文件與 [openapi.json](openapi.json) 是 027 的行為契約，027-08 已依實作校正。現有 ResponseInterceptor 使用 `{success:true,data,timestamp}`，錯誤使用 `{success:false,error:{code,message},timestamp}`，沿用原格式，不重複包裝。

## 新入口

| 方法／路徑 | 認證與結果 |
|---|---|
| GET /api/auth/super-user-entries/{entryKey} | 公開位置驗證；有效回 200 data={available:true}，無效／過期回 404；不列出目前值、不寫 DB、不設 cookie。不限流：由 Next server 代理，所有請求同一來源 IP |
| POST /api/auth/super-user-entries/{entryKey}/sessions | 公開但須 Origin、限流、有效位置及帳密；201 回 session view＋HttpOnly Set-Cookie；成功與原會話撤銷同交易 |
| GET /api/auth/session | 原路徑；接受 employee／super_user，回相容 session union |
| DELETE /api/auth/session | 原路徑；Origin 防護，冪等撤銷與清 cookie，回原 localLogout=completed |

`entryKey` 必須是43字元 base64url；不接受 query token。帳號1～128字元、密碼1～1024 UTF-8 bytes，不 trim／normalize，禁止多餘欄位。整體 body 限制8KiB；有效入口才執行 DTO credential 驗證。頁面只收帳密，不回顯密碼。

無效位置在通過傳輸層限制後回統一404；POST 的 429／413／503 可早於位置檢查，但不得揭露入口是否存在。已知入口且錯誤帳密用同一401 AUTH_SUPER_USER_CREDENTIALS_INVALID；沒有 trusted IP／限流儲存不可用回503，不放行。限流按IP與固定登入類別，不隨entryKey變動。

登入前先做 cheap 限制、Origin、限流、位置預檢及輸入驗證，再非同步 KDF；commit 前鎖 singleton 重驗位置／本機設定版本，再替換 session。輪換已先 commit 則回404；登入先 commit 則該會話有效，不因隨後網址輪換撤銷。

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
| 403 | CSRF_ORIGIN_REJECTED（沿用） | 來源不符；不重試 |
| 403 | AUTH_ACTOR_NOT_ALLOWED | Super user 存取尚未接入的員工業務；不是登入過期 |
| 404 | NOT_FOUND（沿用，「找不到請求的資源」） | 入口不存在／舊入口／移除的登入路徑 |
| 409 | AUTH_SESSION_REPLACED | 同一舊會話已被另一登入取代；不覆寫 cookie，重新整理目前身分 |
| 409 | AUTH_SUPER_USER_GENERATION_CONFLICT | 只用於 REPL `activateCredentials`：expectedGeneration 不是目前版本，見 [operations.md](operations.md) |
| 413 | INVALID_REQUEST（沿用，「請求內容超過大小限制」） | body超過8KiB |
| 429 | REFUSE_SERVICE（沿用，「系統拒絕服務，請聯絡IT人員」） | 只有 POST；Retry-After秒數，等待後人工重試 |
| 503 | AUTH_SUPER_USER_UNAVAILABLE | 尚未初始化、local fingerprint不符active、入口已停用、無法取得client IP或限流儲存不可用；不揭露設定差異 |
| 503 | AUTH_DB_UNAVAILABLE（沿用，「登入服務暫時無法使用」） | DB 不可用；DELETE 撤銷失敗時不清 cookie，會話仍有效可重試 |

成功回應與 handler 內的錯誤帶 `Cache-Control: no-store`；guard 與框架層提前拒絕的回應（Origin、限流、入口、會話驗證、body 上限）不帶 Cache-Control，這些回應不含身分或入口資料。前端用每次操作明確錯誤，不能把帳密401套用全站「員工登入過期」對話框。

## Cookie 與瀏覽器

使用 FT_ESIGN_SESSION、HttpOnly、host-only、Path=/、maxAge=28800。staging／production Secure+SameSite=None，本機Lax。只在commit成功後Set-Cookie；登入失敗不清原cookie。DELETE 同屬性清除，OAuth transaction cookie 亦按原規則清理。跨站POST拒絕，不因iframe origin列在信任清單而允許跨站管理登入。

UI `/ops-access/[entryKey]` 不放 `(main)`；proxy 在RSC／HTML渲染前驗證位置，無效rewrite既有404、不得包含表單。合法頁no-store、Referrer-Policy:no-referrer、X-Robots-Tag:noindex,nofollow、frame-ancestors 'none'（只套維護頁，不影響WebView）。頁面server fetch再次no-store確認；失效後提交仍由後端拒絕。錯誤不含上游URL。

成功後清除輸入、replace('/')、清理舊session相關query cache並重新取身分；共用layout顯示Super user與登出。027不擅自展示可用業務權限。EmbedBridge遇super actor為mismatch，遵循既有撤銷／要求launch流程，不偽造empId。

## Logging contract

將前端 /ops-access/* 與後端 /api/auth/super-user-entries/* 正規化為路由模板；同時禁止原始url、query、body、Referer、Set-Cookie被一般log記錄。覆蓋正常、404、guard、429、exception及SSR錯誤。反向代理須使用遮罩後URI或為此路徑關閉raw access log；Next production及開發request log亦需檢查／關閉此類raw記錄，不僅修改Nest masker。

WebView activation 啟動碼無效、過期或已用過只記 `auth.launch_code_rejected`（不含啟動碼、cookie、token 或員編），不寫安全事件；此端點沒有限流。

REPL只在明確currentEntry呼叫回原路徑，不記history、不經application logger；不新增公開查當前入口的API。
