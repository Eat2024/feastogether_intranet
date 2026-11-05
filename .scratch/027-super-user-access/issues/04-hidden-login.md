# 04: 完成受保護的隱藏登入、身分顯示與登出

**What to build:** 在員工登入上游不可用時，維護者仍可用 REPL 取得的有效隱藏網址完成登入，看到 Super user 身分並登出；非法入口不顯示表單，錯誤登入不影響原身分。

**Status:** resolved

**Blocked by:** [03-narrow-repl-entry](03-narrow-repl-entry.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T003、T017、T018、T019、T020、T021、T022、T023、T024、T025、T026、T028、T050、T051。

## Acceptance Criteria

- [x] 入口位置 GET 有效回 200、無效回 404，無 DB 寫入、無 Set-Cookie；提交在 KDF 前檢查位置並在交易 commit 前重驗位置與有效設定。
- [x] 帳號 1～128 字元、密碼 1～1024 UTF-8 bytes、body 上限 8 KiB、不接受額外欄位；正確登入回 201，錯帳號與錯密碼統一 401，不透露帳號存在性。
- [x] explicit Origin 與可信 IP 限流實際生效：10 次／60 秒及 50 次／300 秒，依 IP＋固定登入類別計數；429 有 Retry-After，缺可信 IP／Redis／DB 時拒絕而不放行。
- [x] 成功登入與原會話替換及安全事件原子完成，commit 後才 Set-Cookie；失敗不清原 cookie。session 讀取及登出真正經過共用會話服務，兩類 actor 都能使用。
- [x] cookie 沿用 HttpOnly、host-only、根路徑及固定八小時；正式環境 SameSite=None＋Secure，本機 Lax；未明確允許的業務路由對 Super user 仍回 403。
- [x] 隱藏頁在 HTML／RSC 渲染前驗位置；未知／舊／格式錯誤入口均無表單；有效頁 no-store、no-referrer、noindex 且禁止 iframe，此限制不影響一般 WebView。
- [x] MUI 表單防重送，錯帳密只在表單顯示，不觸發全站 session-expired 對話框；409 重查身分、429 等待人工重試。成功清輸入、replace 到根頁並清舊身分快取。
- [x] 內部 layout 能辨識 Super user、持續顯示身分並提供登出；不產生 OAuth 前端、角色管理頁或選單改造。
- [x] Nest、Next、SSR 與部署代理在成功、404、guard、429、exception 情境不記錄完整入口、raw URL/query/body/Referer、密碼或 cookie。倉庫外代理尚未套用時明列部署阻擋，不聲稱全鏈已驗收。
- [x] 真正 REPL 到瀏覽器登入／錯密碼／無效 RSC／身分標示／登出的完整旅程有實際驗證紀錄；只有隔離展示資格，尚不能視為完整 027 正式交付。

## Comments & Implementation Results

### 2026-11-05 實作結果（分支 `027-04-hidden-login`）

**變更摘要**

server：

- `GET /api/auth/super-user-entries/:entryKey` 只驗位置，回 `{available:true}`（no-store，不寫 DB、不設 cookie）。`POST …/:entryKey/sessions` 接 `{account,password}`，回 201 Super user 身分。兩者都在 `controllers/super-user-access.controller.ts`。
- 檢查順序：
  - POST 的 guard 依序是 `OriginGuard` → `SuperUserThrottlerGuard` → `SuperUserEntryGuard`。
  - 入口無效時，在 DTO 驗證與 KDF 前就回 404。Nest 先跑 guard 再跑 pipe，所以入口預檢做成 guard。
  - 接著 DTO 驗證，再由 `SuperUserLoginService` 跑 KDF。
  - 最後 `SessionService.replace` 在鎖定 singleton 後重驗入口、fingerprint 與 generation，替換會話並寫事件；commit 後才 Set-Cookie。
- 入口比對集中在 `helpers/super-user-entry.ts`：43 字元 base64url，再做 `timingSafeEqual`。`SessionTarget` 的 super_user 分支帶 `entryKey`，讓交易內可以重驗。
- `dto/super-user-login.dto.ts`：帳號 1～128 字元；密碼 1～1024 UTF-8 bytes，以 `Buffer.byteLength` 計算，因為 `IsByteLength` 遇孤立 surrogate 會丟例外。不 trim，多餘欄位回 400。
- body 上限 8 KiB：`@RouteConfig({ bodyLimit })` 加 `app.bootstrap.ts` 的 Fastify onRoute hook。Nest 不轉交 route bodyLimit，所以需要這個 hook。
- 錯帳密：統一回 401 `AUTH_SUPER_USER_CREDENTIALS_INVALID`，寫 `login.rejected`（anonymous）事件，不替換也不清除原 cookie。
- `SuperUserThrottlerGuard` 繼承 `AuthThrottlerGuard`：10 次／60 秒與 50 次／300 秒，桶依 IP＋固定 handler，不含 entryKey。取不到 client IP 或 Redis 失敗時回 503，安全 log 只記原因類別。
- `OriginGuard` 對維護路徑要求明確 Origin；跨站的 `Sec-Fetch-Site` 照舊拒絕。
- `AuthGuard` 改用 `SessionService.authenticate`，並在 request 掛 `authSession`：
  - 員工照舊掛 `request.user` 與 CLS 稽核 ID。
  - Super user 只能進 `@AllowSuperUser()` 端點，其他端點回 403 `AUTH_ACTOR_NOT_ALLOWED`，不是登入過期。
- `GET /auth/session` 加上 `@AllowSuperUser()`，回 `SessionView` union。`DELETE /auth/session` 直接呼叫 `SessionService.revoke`。
- 已移除 `AuthService.getMe`／`logout`／`verifySessionToken`、`AuthSessionRepository.revoke` 與 `AUTH_SESSION_INVALID`。
- log：
  - `getRequestPath` 把維護路徑遮成 `/api/auth/super-user-entries/:entryKey[/sessions]`，所以 access log、throttler log 與 500 handler 都只有路由模板。
  - access log 對這兩組路徑不記 query 與 body。
  - 入口無效的安全 log（`auth.super_user_entry_rejected`）不含路徑。

client：

- `src/app/ops-access/[entryKey]/page.tsx` 與 `features/super-user-login/SuperUserLoginForm.tsx`：
  - 頁面不放在 `(main)` 下，以 `connection()` 每次請求渲染。
  - 表單用 MUI，送出中與成功後都停用，避免重送。錯誤就地顯示。
  - 409 會重查身分，已是 Super user 就直接進入；429 依 Retry-After 顯示秒數，由使用者自行重試。
  - 成功後清空輸入並 `location.replace('/')`，整頁重建，舊 query 快取一併清掉。
- `src/proxy.ts` 在渲染前以 no-store 呼叫後端 GET 驗證入口，無效時改寫成 404，HTML 與 RSC 都不含表單。錯誤訊息只含 HTTP 狀態。
- `next.config.ts`：
  - 只有 `/ops-access/:entryKey` 帶 `Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex, nofollow`、`frame-ancestors 'none'`。
  - 開發模式的 request log 略過兩組維護路徑。
- 401 `AUTH_SUPER_USER_CREDENTIALS_INVALID` 不開全站 SessionExpiredDialog：`lib/apiError.ts` 的 `isSuperUserCredentialsInvalid`，由 `ReactQueryProvider` 排除。
- `components/CurrentActorBanner.tsx` 放在 `(main)/layout.tsx`，只在 Super user 時顯示「目前身分：Super user」與登出，員工畫面不變。
- `EmbedBridge.tsx` 不需修改：Super user 會話沒有 empId，被判為 mismatch，會登出並要求重新 launch。
- API 型別、request、query：`api/types|requests|queries/auth.ts`。

文件：

- `docs/deployment/uat-cicd.md`：新增「Super user 隱藏入口的 log 遮罩」，列為部署阻擋。
- `client/AGENTS.md`：補上登入例外說明。
- `specs/027-super-user-access/tasks.md`：勾選本張任務並註明偏差。
- `specs/027-super-user-access/quickstart.md`：新增「027-04」小節，含 T003 盤點。

**驗證（實際指令與結果）**

- 新增／改寫的測試：`security-super-user-access.e2e-spec.ts` 26 tests、`super-user-login.service.spec.ts` 11 tests、`auth.guard.spec.ts` 16 tests、`super-user-throttler.guard.spec.ts` 1 test、`session-view.dto.spec.ts` 2 tests，全數通過。
- Mutation 檢查：拿掉交易內的入口重驗後，`session.service.spec.ts` 與 e2e「KDF 期間入口輪換」各 1 test 失敗；已還原。
- `pnpm -C server lint:check`：0 errors、276 warnings。逐檔與本張前（HEAD）比對相同，新檔 0 warning。
- `pnpm -C server test`：126 suites／1270 tests 通過。
- `pnpm -C server build`：成功。
- `pnpm -C server test:e2e:security`：16 suites／117 tests 通過。
- `pnpm -C server test:e2e`：51/52 suites 執行，552 passed、1 skipped、1 failed。唯一失敗是 027-02 已記錄的既有 `api-coverage`「GET /api/esign/documents/1/history」（期望 401、實得 404），與本張無關。
- `pnpm -C client lint`、`pnpm -C client build`：成功，`/ops-access/[entryKey]` 為 ƒ（動態）。
- 真實旅程：詳見 quickstart「027-04」小節。
  - 環境：開發庫 `feastogether_intranet_027a`、`REDIS_DB=9`，server 3011，client 3010。
  - 順序：REPL `initialize()`／`credentialStatus()`／`currentEntry()` → Playwright Chromium，開發模式與正式 build 各一次。
  - 無效入口：顯示 404 頁，沒有密碼欄位。
  - 錯密碼：表單內顯示「帳號或密碼錯誤」，不開「登入已過期」，沒有 cookie。
  - 正確登入：進入 `/forms`，持續顯示「目前身分：Super user」；cookie 為 HttpOnly／Lax／Path=/／host-only。POST 帶 Origin、`Sec-Fetch-Site: same-origin`，沒有 Referer。
  - 有效入口沒有留在瀏覽紀錄。
  - 登出：回根路徑顯示 404，`GET /api/auth/session` 回 401。
  - 無效入口的 RSC 請求回 404，不含表單。
- 回應 header：
  - 正式 build 的有效入口回 `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`。
  - `/embed`、`/external-signatures/<id>` 不帶維護頁的三個 header。
- log 檢查：
  - Nest log、Next 開發／正式 log 中，入口、密碼、cookie 值與兩個測試用無效入口都是 0 筆命中。
  - Nest access log 只有路由模板。
  - singleton soft-delete 時頁面 500，Next log 只有「維護入口檢查失敗：HTTP 503」。

**未驗證／限制**

- **部署阻擋**：倉庫外的 Nginx 8080／ALB 尚未設定。它們的 access／error log 會記完整入口 URL，設定前不得在 UAT／正式環境初始化或提供入口。全鏈 log 遮罩尚未驗收。
- 正式環境的 SameSite=None＋Secure 只由既有 `auth-cookie.spec.ts` 驗證，沒有在 HTTPS 瀏覽器實測。
- 沒有實際用瀏覽器驗證以下項目，它們只有程式碼與後端 e2e 依據：
  - 409 重查身分。
  - 429 的秒數提示。
  - Super user 進入 WebView／iframe 時 `EmbedBridge` 判為 mismatch。
- 正式 build 用 `next start` 驗證；部署 image 用 standalone `server.js`，兩者都不記 request log，但沒有用 standalone 實測。
- 50 次／300 秒視窗與員工登入共用設定，e2e 只驗 10 次／60 秒。缺可信 IP 只有單元測試。
- 未執行 `test:schema`（本張無 migration／entity 變更），也未執行 root `pnpm build`／`pnpm lint`。
- `next dev` 的 `.next/dev/trace` 會記含入口的 request URL。這只發生在本機開發，驗證後已刪除。
- 以上只是隔離展示；週輪換、帳密啟用與身分切換完成前，不能視為完整 027 交付。

**待決（規格未定，未自行決定）**

1. GET 入口沒有限流。這個請求由 Next 伺服器端發出，後端只看到 Next 主機 IP；若按 IP 限流，所有訪客會共用一個桶，任何人送 10 次無效入口就能讓入口頁對所有人 429。openapi 卻列了 GET 429。建議二選一：刪掉 openapi 的 GET 429；或改由 Next 轉送可信的 client IP，並調整 trustProxy。
2. openapi 範例錯誤碼與實作不一致。
   - 404：openapi 寫 `HTTP_NOT_FOUND`（這是定義名稱），實際回 `NOT_FOUND`。
   - 429：openapi 寫 `AUTH_RATE_LIMITED`，實際沿用員工登入的 `REFUSE_SERVICE`，訊息為「系統拒絕服務，請聯絡IT人員」。
   - 413：實際回 `INVALID_REQUEST`。
   - 建議以實作為準修正 openapi，或決定新增專用錯誤碼。
3. Super user 會話過期時，SessionExpiredDialog 仍顯示員工版文案（請從入口網重新進入）。需要決定 Super user 的提示文案。
4. Super user 登入後落在 `/forms`，列表顯示 403「目前身分無法使用此功能」。028 前這是預期行為，但可能需要決定 Super user 的預設落點。
5. 原 `AuthService.verifySessionToken` 的 `auth.session_rejected` info log 已隨該方法移除，目前 session 驗證失敗不另記 log。需要的話由 05 補回。

**給後續 ticket 的備註**

- 05（身分切換）：
  - OAuth／WebView 登入也應改走 `SessionService.replace(currentToken, { kind: 'employee', … })`。`AuthService.issueSession` 仍在用。
  - `DELETE /auth/session` 目前先清 cookie 再撤銷（T035）。
  - 可用的介面：`AuthenticatedRequest.authSession`、`@AllowSuperUser()`、`toSessionView`；client 有 `useGetSessionQuery`、`AuthSession` union。
- 06（週輪換）：
  - 輪換交易要對 singleton `FOR UPDATE`，才能和登入交易內的重驗（`SessionService.lockSuperUserGeneration`）序列化。
  - 入口比對沿用 `isCurrentSuperUserEntry`。
  - Next proxy 每次請求都重查入口，不需要清快取。
- 07（帳密啟用）：本機 fingerprint 與 DB 啟用版本不符時，登入與既有 Super user 會話的請求都回 503 `AUTH_SUPER_USER_UNAVAILABLE`；DB generation 前進後，舊 generation 的會話不再通過驗證。這兩段由 027-02 的 `SessionService` 處理，已有測試，本張沒有改動。
- 08（交付）：
  - Nginx／ALB log 遮罩依 `uat-cicd.md` 新節落實後，補上實測證據。
  - 本機另加的 `AUTH_TRUSTED_ORIGINS=…,http://localhost:3010` 只屬於本機；正式環境沿用既有 HTTPS origin。
  - T052 的 README／`.env.example` 尚未更新。
- 展示後已刪除開發庫 `feastogether_intranet_027a` 的 singleton、安全事件與 Super user 會話，也刪除了暫存的合成密碼與入口。`server/.env` 仍留著合成 hash，但對應的密碼已不存在；之後要展示，需先用 `super-user:hash-password` 重新產生 hash，再以 REPL `initialize()`。

### 整合紀錄

已合入整合分支 `027-super-user-access`（2026-11-05，fast-forward）：
- `415b3c9 feat(auth): Super user 隱藏入口登入，session 讀取與登出改走共用會話`
- `7b8e7d0 feat(client): Super user 隱藏維護登入頁、身分標示與登出`
- `68cfc21 docs(tickets): 記錄 027-04 實作結果、驗證與部署阻擋`
