# 05: OAuth／WebView 共用單一身分並移除員工帳密入口

**What to build:** 員工保留 OAuth 與舊系統 WebView 入口，與 Super user 在同瀏覽器成功切換時只保留新身分；錯誤切換不把原使用者登出。

**Status:** resolved

**Blocked by:** [04-hidden-login](04-hidden-login.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T029、T030、T031、T032、T033、T034、T035、T036。

## Acceptance Criteria

- [X] OAuth／WebView 對同員編仍對應同一本地員工，保留資格、可信部門、state／nonce／一次性 code／jti 重放防護。
- [X] OAuth callback 與 WebView activation 用目前 cookie 進行共用原子替換；WebView launch 不先改瀏覽器身分，activation 成功仍 303 回根頁。
- [X] employee→super_user→employee 雙向切換後舊 cookie 重放失敗；相同舊 token 並發只有一成功，另一回 409 且無 Set-Cookie；上游／KDF／DB 失敗保留原身分。
- [X] 登出只撤目前會話、不恢復舊身分、不影響另一瀏覽器；無 cookie 冪等成功，適用的 OAuth 交易 cookie 與主 cookie 用相同屬性清除。
- [X] 一般員工帳密與開發替代入口移除並回 404，沒有 reset／forgot／change-password 新旁路；仍被其他功能使用的上游 client 保留。
- [X] EmbedBridge 遇 Super user 視為員工 mismatch，沿既有撤銷／launch-required 流程，不以全權限冒充員工、不因 user:null 例外；正式 iframe cookie 行為維持。
- [X] 完成兩入口、替換競態、舊路徑移除與 iframe 瀏覽器回歸；紀錄 commit 後網路丟失需重新登入，以及無舊 cookie 無法辨識同瀏覽器並發的限制，不新增裝置 cookie。

## Comments & Implementation Results

### 變更摘要

- 共用替換：`SessionTarget` 新增 `webview_launch`。`SessionService.replace` 鎖舊會話後鎖 pending 列並就地轉 active，鎖序為 singleton（僅 Super user）→ 舊會話 → 新列或 pending 列。OAuth callback 以 `{kind:'employee', source:'oauth'}`、WebView activation 以 `webview_launch` 呼叫，都帶目前 cookie；commit 後才設 cookie。WebView launch／bridge 不碰瀏覽器會話。
- activation 失敗頁：409 顯示「登入身分已更新，請重新整理」，401／503 沿用原文案。
- 登出：先撤銷再以寫入時屬性清 `FT_ESIGN_SESSION` 與 `FT_ESIGN_OAUTH_TX`；撤銷失敗回 503 不清。`clearOauthTxCookie` 改用 `baseCookieOptions`（OAuth callback 也用它清交易 cookie）。
- 移除：`POST auth/login`、`LoginDto`、`DevLoginService`、`framework/auth-mode.ts`、`FeastogetherAuthService`；`AuthService.login`／`activateWebviewSession`／`issueSession`／`buildSession`；只供帳密的錯誤碼 `INVALID_CREDENTIALS`、`LOGIN_UNAVAILABLE`、`PASSWORD_REQUIRED`、`EMPLOYEE_ID_INVALID`、`ACCOUNT_DISABLED_CONTACT_IT`（client 對照一併移除）；`DEVMOD`（`.env.example`、`.env.test.example`、`docker-compose.uat.yml`、OAuth config 測試）；`AUTH_LOGIN_OPTIONS`／`AUTH_DEV_LOGIN` 路徑常數；OriginGuard 的 login 路徑；`FeastogetherClient` 只為 staff/login 存在的 `post`、`timeoutMs` 與 body 遮罩。`AuthModule` 不再 import `FeastogetherModule`、不 export `AuthService`。README 與 `.env.example` 說明改為 OAuth／WebView。
- client：`EmbedBridge` 先判 `actor.kind === 'employee'` 再比員編，Super user 為 mismatch。
- 測試：新增 `security-session-replacement.e2e-spec.ts`；`password-login.e2e-spec.ts` 改成舊路徑 404 與 `/api/auth` 路由清單；原帳密檔的 Portal U+FFFD、Portal 不回應案例移到 `webview-session.e2e-spec.ts`。約 20 個業務 e2e 的員工 cookie 改用新的 `test/employee-session.helper.ts`（直接建立 active 列，不寫安全事件）。`core-esign-flow*` 三個 suite 清理時先刪安全事件。

### 驗證

細節見 [quickstart 027-05](../../../specs/027-super-user-access/quickstart.md)。

- `pnpm -C server lint:check`：0 errors、271 warnings，新檔與改動行 0 warning。
- `pnpm -C server test`：123 suites／1246 tests 通過。
- `pnpm -C server build`：成功。
- `pnpm -C server test:e2e:security`：17 suites／131 tests 通過（含新檔 14 tests）。
- `pnpm -C server test:e2e`：542 passed、1 skipped、1 failed；唯一失敗是既有 `api-coverage` 的 history 路由。
- `pnpm -C client lint`、`pnpm -C client build`：成功。
- 瀏覽器（Playwright＋合成 Portal 庫、臨時 WebView 金鑰、合成 Super user）：iframe WebView、employee↔super 切換、Super user 在 EmbedBridge 為 mismatch、同 cookie 並發 activation 一成一敗、登出不恢復舊身分、舊路徑 404，共 18 項通過。

### 未驗證與限制

- OAuth 只有 e2e（openid-client 替身＋合成 Portal）；瀏覽器沒有走 OAuth（本機無合成 OIDC 提供者，且不得連真實 OAuth）。
- commit 後回應遺失：新會話已生效、舊會話已撤，瀏覽器下次請求 401，需重新登入。
- 沒有舊 cookie 時同一瀏覽器的並發登入無法辨識，兩筆都成功，瀏覽器留最後寫入的 cookie，另一筆會話留到八小時到期。不新增裝置 cookie。
- 失敗的 OAuth／WebView 登入沒有寫 `login.rejected` 安全事件，只有原本的 app log；原 `auth.launch_code_rejected`、`auth.session_created` info log 已隨舊 activation 移除，無效啟動碼目前沒有任何紀錄。spec 沒寫員工入口失敗要不要記事件，待決。
- `FeastogetherModule` 已沒有任何 runtime import。brand／department／hr service 在本張前就沒有呼叫者，所以沒有刪；是否整組移除（含 `FEASTOGETHER_*` env 與幾個 e2e 裡已失效的 `FeastogetherClient` override）待決。

### 給後續 ticket 的備註

- e2e 只要經過真實 OAuth callback、WebView activation、Super user 登入或登出，就會寫 `auth_security_events`（FK RESTRICT 到會話與員工）。清理順序：先刪事件（員工可用 `actor_user_id`），有替換時再把 `replacement_session_id` 設 NULL，最後刪會話與員工。
- 業務 e2e 只需要員工 cookie 時用 `employeeSessionCookie(ctx.app, userId)`（`test/employee-session.helper.ts`），不寫事件，清理不受影響。
- `security-session-replacement.e2e-spec.ts` 直接 INSERT `super_user_access` 的 singleton（欄位同 `security-super-user-access`），06／07 若改 singleton 欄位要一併調整。
- 本機以 iframe 驗證時，合成入口網要用真的 loopback HTTP server；Playwright `route.fulfill` 的頁面會被 Chrome Local Network Access 擋下。

### 後續（使用者決定）

決定：（1）員工入口登入失敗要寫安全事件；（2）`FeastogetherModule` 整組刪除。

員工登入拒絕紀錄（commit `2d70ce2`）：

- 寫 `login.rejected`（`anonymous`／`employee_ineligible`，無 `session_id`）：上游身分已驗證、被本系統規則拒絕。OAuth 是 token 交換與 UserInfo 成功後缺員編、Portal 判定不可登入、本機帳號停用或已刪除，在 `OauthIdentityService.resolve` 外層（員工列交易 rollback 後）記；WebView launch 是 JWT 與 jti 都通過後 Portal 判定不可登入、本機帳號停用或已刪除，在 `failClaim` 之後記。兩者都用 `recordRejection` 獨立短交易，寫入失敗回 503 `AUTH_DB_UNAVAILABLE`；以 4xx `AppException` 判定為規則拒絕。
- 不寫事件：Portal 查詢失敗（502）、DB 故障與 OAuth 上游故障維持原行為。`AuthSecurityOutcome` 新增 `employee_ineligible`；`outcome_code` 沒有 DB CHECK，不需 migration。
- 只記 log：activation 啟動碼無效、過期或已用過恢復 `auth.launch_code_rejected`（info，不含啟動碼、cookie、token、員編）；launch 的 `auth.webview_launch_rejected`／`auth.webview_launch_replayed` 不變；OAuth token／UserInfo 驗證失敗沿用 `oauth.code_exchange_failed`／`oauth.userinfo_failed`；OAuth 取消、缺 code、state 或交易無效沒有語意 log，只有 http_access。
- 測試：新增 `security-employee-login-rejection.e2e-spec.ts`（20 tests：A 類 7 種各一筆事件、事件寫入失敗 503 兩入口各一、B 類與系統故障 8 種不寫事件、啟動碼三種只記 log），都驗證不發 cookie、不撤原會話。`oauth-login`、`webview-session` 清理會留下的匿名拒絕事件。data-model §3 與 api-behavior 補結果碼白名單與分類。

移除 FeastogetherModule（本 commit）：

- 刪 `server/src/infrastructure/http-client/feastogether/` 整個目錄（client、config、error util、brand／department／hr service、型別與 4 個 spec）、錯誤定義 `FEASTOGETHER_CONFIG_MISSING`／`FEASTOGETHER_UNAUTHORIZED`／`FEASTOGETHER_UNAVAILABLE`，以及只供它們使用的 `EXTERNAL_AUTH_UNAVAILABLE`、`EATOGETHER_API_SERVICE_UNAVAILABLE`（client 對照一併移除）。
- 刪 `FEASTOGETHER_*`：`.env.example`、`.env.test.example`、`docs/deployment/uat-cicd.md`。config 驗證與 docker-compose 原本就沒有這組設定。
- 只有本模組 import `HttpModule`，一併移除 `@nestjs/axios` dependency（lockfile 只少這個套件）。
- e2e：移除 `mail-whitelist-runtime`、`mail-whitelist-otp`、`esign-candidate-resolution`、`org-chart` 的 `FeastogetherClient` 替身，以及 8 個 `internal-*` e2e 已不生效的 `HttpService` 替身與「未呼叫」斷言；`esign-candidate-resolution` 刪掉只在變換來源資料的案例（剩下的斷言已由「缺帳號不建帳」涵蓋）；`org-chart` 舊快取命名空間改用合成網址，不再讀已移除的設定。
- `portal.config.ts` 只刪掉引用 `FeastogetherConfig` 的註解；`client/src/app/not-found.tsx` 的 Feastogether 是品牌文字，保留。`specs/` 內的歷史規格仍提到這個模組，屬歷史紀錄，不改。
- UAT `server.env` 若還有 `FEASTOGETHER_*`：`validateAppEnvironment` 只驗指定欄位並原樣保留其他值，沒有程式讀它們，不會讓開機失敗；由 ticket 08 清掉。

驗證：

- `pnpm -C server lint:check`：0 errors、271 warnings（兩個 commit 都沒有新增）。
- `pnpm -C server test`：第一個 commit 127 suites／1275 tests；本 commit 123 suites／1265 tests（刪掉 4 個 spec 檔）。
- `pnpm -C server build`：成功。
- `pnpm -C server test:e2e:security`：兩個 commit 都是 19 suites／157 tests 通過（含新檔 20 tests）。
- `pnpm -C server test:e2e`：第一個 commit 562 tests 中 560 passed、1 skipped、1 failed（跑完後才補 `oauth-login`、`webview-session` 的清理語句，兩檔重跑 22 tests 通過）；本 commit 561 tests 中 559 passed、1 skipped、1 failed（刪掉 1 個案例）；唯一失敗是既有 `api-coverage` 的 history 路由。
- `pnpm -C client lint`、`pnpm -C client build`：成功。
