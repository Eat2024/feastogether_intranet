# Phase 0 Research: WebView SSO 與員工 Session

## 1. 主平台憑證格式與金鑰邊界

**Decision**: 使用 compact JWS JWT，固定 RS256。主平台持私鑰簽發，電子簽只持預先設定的公鑰驗章；JWT 由主平台後端透過 HTTPS POST `Authorization: Bearer` 傳送。

**Rationale**: JWT 在此是簽章資料，不是加密資料。電子簽用公鑰驗證來源與完整性，不需要解密金鑰，也不能用公鑰冒充主平台簽發。雙方不交換 access token。

**Alternatives considered**: 舊 Portal 雙層 MD5 無簽發者驗證且可能需全表掃描；HS256 讓驗章方同時可簽發；JWE、雙向加密與完整 OAuth/OIDC 在第一版皆屬過度設計。

## 2. JWT claims 與姓名

**Decision**: 必填 `iss`、`aud`、`sub`、`jti`、`iat`、`nbf`、`exp`；JOSE header 必填 `alg=RS256` 與 `typ=FT-ESIGN-LAUNCH+JWT`。`sub` 直接承載 `empid`，不再加重複 `empid` claim。`name` 可選填，只驗證型別／長度後丟棄，不做對應、授權或 User 寫入。

**Rationale**: `sub` 是標準主體識別，可直接用唯一索引查 User。姓名與員編同由單一主平台簽發，不是第二認證因素；FGAPI 才是 profile 權威來源。

**Alternatives considered**: 同時必填 `sub`／`empid` 會產生衝突來源；姓名可重複或變更；`auth_time`／`amr`／`acr` 目前無 MFA 政策或消費者，留待簽署前重新驗證規格。

## 3. 驗章設定與金鑰管理

**Decision**: issuer、audience 與 base64 編碼 PEM 公鑰由受控環境設定提供；演算法與 `typ` 為程式常數。啟動時驗證必要設定與公鑰格式。第一版無 `kid`、JWKS、discovery 或多金鑰輪替。

**Rationale**: 單 issuer／單鑰下的最小可審查邊界，不依未驗證 JWT 選擇公鑰或 URL。

**Alternatives considered**: 公鑰寫入 repository 不利環境隔離；動態 JWKS 在單鑰需求下多出網路與信任邊界。

## 4. 兩段式 WebView launch

**Decision**: 主平台後端呼叫 `POST /api/auth/webview-launches` 建立 launch。電子簽完成 JWT、FGAPI 與 User 查驗後，產生至少 256-bit 隨機 `code`，只保存摘要，回傳最長 60 秒的固定 origin `launchUrl`。主平台用該 URL 開啟 WebView；`GET /api/auth/webview?code=...` 只回傳 no-store、無第三方資源的同源 bridge，不讀寫 launch 狀態。Bridge 自動以 form POST code 至 `/api/auth/session`，POST 才原子消耗 code、設定 session cookie，並以 `303` 導向固定 `/`。

**Rationale**: WebView 導航天然使用 GET，但 Constitution 禁止 GET 產生業務寫入。Bridge 讓主平台仍只需開啟 URL，實際狀態轉換則遵守 POST semantics。短效、一次性、無身分內容的 opaque code 類似 redirect flow 的授權碼，但完全由電子簽產生及消耗；它不是拿去主平台交換 access token 的 OAuth authorization code。POST 後立即導向乾淨 URL，可縮短 code 留在 location 的時間。

**Alternatives considered**: 由主平台操控 WebView 直接 POST／fetch 需處理 CORS、credentialed request 與 cookie store 差異；GET 直接消耗 code 違反 safe method 約束；JWT 直接放 query 會暴露 claims並增加 browser history、proxy log 與 referrer 洩漏面；完整 OAuth authorization-code/token endpoint 需要主平台成為 authorization server，超出目前單一可信平台需求。

Bridge 使用標準 `application/x-www-form-urlencoded` form；Fastify 以官方 `@fastify/formbody` plugin 解析，並透過既有共用 bootstrap 同時套用正式與 e2e app。這是支援無 JavaScript 手動提交 fallback 的必要依賴。

## 5. JWT 與 launch code 防重放

**Decision**: JWT 完整驗證後，對 `SHA-256(issuer + NUL + jti)` 建立 MySQL 唯一紀錄，unique conflict 即拒絕重放。查驗成功後寫入 `SHA-256(launch_code)` 與 60 秒到期時間。GET 使用具條件的原子更新，只允許一個請求把未到期的 pending launch 轉為 active；後續失敗不釋放 `jti` 或 code。

**Rationale**: MySQL 唯一約束與條件更新是跨 instance 的最終仲裁，且不受 Redis 故障影響。保留摘要可查證重放與 session lifecycle，又不保存 bearer secret 原值。

**Alternatives considered**: Redis `SET NX EX` 使認證依賴 Redis；先查後寫存在競態；失敗刪除紀錄會重開重放窗口。

## 6. MySQL 本地 session

**Decision**: 新增 `auth_sessions` 表統一保存 validating、pending launch、active、revoked／failed 狀態。Session cookie 使用 32-byte CSPRNG base64url token，DB 只存 SHA-256 摘要；有效期固定 8 小時且不滑動。Guard 以摘要索引查有效 session，再確認 User 存在、未 soft-delete 且 active。登出以條件更新設定 `revoked_at`。

**Rationale**: MySQL 已是 User 與業務資料的必要依賴；把 session 放在同一權威儲存可避免 Redis 長期故障造成整個系統的 session 失效，也避免 Redis／DB fallback 的 split-brain、雙寫與撤銷不一致。

**Alternatives considered**: Redis-only opaque session 讓 Redis 成為認證單點；Redis 掛掉才 fallback DB 會產生兩套權威；stateless JWT cookie 無法立即登出或個別撤銷；另建 launch/replay 表會增加第一版 schema 數量。

## 7. Session 紀錄保留

**Decision**: 第一版不加清理排程；`auth_sessions` 保留過期、撤銷與失敗紀錄作安全稽核，查詢必須使用摘要、狀態與時間索引。正式上線前由資料治理決定保留期限，後續再以獨立規格加入封存或清理。

**Rationale**: 使用者明確需要 DB 紀錄可查，而未定保留政策前直接刪除可能破壞稽核。第一版不因容量推測新增排程。

**Alternatives considered**: 立即刪除失去稽核；未經需求自行加入排程違反 YAGNI；永久保留被列為暫時限制而非長期政策。

## 8. FGAPI 與 User 映射

**Decision**: `sub` 限 ASCII alphanumeric／最長 32，只接受恰好一筆正規化後完全相符、DTO 合法的試用／正式員工。姓名來自 FGAPI。寫入 `empid`、`name`、`personStatus`、`departmentName`、`titleName`、`lastLoginAt`，不以 JWT `name` 寫入。

FGAPI `department_id` 是字串上游代碼，本地 `users.department_id` 是 `hr_departments.id` BIGINT FK；本版只驗證代碼格式，不直接落入 FK，並保留既有外鍵。

**Rationale**: FGAPI 是 profile 權威來源；但上游代碼不等於本地流水號。組織主檔同步不是 Spec 2 需求。

**Alternatives considered**: 姓名／Email 補找會放寬身分邊界；FGAPI 失敗後用本地舊資料不能完成當次查驗；同時建部門同步會擴大範圍。

## 9. User 並發與停用

**Decision**: MySQL transaction 內以 `empid` `FOR UPDATE` 查包含 soft-deleted User；無資料才建立，unique conflict 整筆重試一次。soft-deleted 或本地 inactive 一律拒絕，登入不自動 restore／啟用。

**Rationale**: unique constraint 是並發首登最終仲裁；本地停用是額外安全門。

**Alternatives considered**: 無 unique 仲裁會重複建帳；登入自動復活會繞過本地安全狀態。

## 10. 跨步驟失敗邊界

**Decision**: JWT verify → MySQL `jti` claim → FGAPI → User transaction → pending launch → WebView GET bridge（唯讀）→ bridge POST 原子消耗 code並啟用 session → Set-Cookie／303。任一步驟失敗都不發 cookie。`jti` claim 後的失敗狀態保留；code 一旦由 POST 消耗，即使回應丟失也不能重用。

**Rationale**: 無效憑證不觸碰個資；唯一約束和狀態轉換讓每個重放點可被 DB 仲裁。回應不確定時要求重新簽發，比重新開放 bearer credential 安全。

**Alternatives considered**: 在外部 FGAPI call 上維持長交易會長時間占用連線與鎖；刪除失敗紀錄會失去重放保護；先發 session 再查 FGAPI 會產生未驗證 session。

## 11. 日誌與 URL 裁切

**Decision**: Launch POST 不記 Authorization header；WebView GET 的 access log 只記 path、不記 query，bridge POST 不記 body；事件只記 result category、request ID 與必要本地 session／User ID，不記 JWT、cookie、原始／摘要後的 `jti`、code、session token、員編、姓名或 FGAPI 內容。GET 與 POST 回應帶 `Cache-Control: no-store` 與 `Referrer-Policy: no-referrer`。Bridge 設定嚴格 CSP，只允許同源 form action，不載入第三方資源。FGAPI staff lookup 使用去敏感 log path。

**Rationale**: code 雖短效且一次性，仍是 bearer secret；必須避免 query 被 proxy／application log 或 referrer 保存。未認證入口的錯誤差異也可被用來探測員工。

**Alternatives considered**: 完整 URL、token 或員編 log 的洩漏風險高；對外回 FGAPI 原錯誤會洩漏上游與員工存在性。
