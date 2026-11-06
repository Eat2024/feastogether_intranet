# 08: 完成部署、回復與三入口整合驗收

**What to build:** 將已完成的登入、員工相容、網址輪換與憑證撤銷整合為可部署交付，讓維護者有明確首次部署、變更帳密及回復操作與實測證據。

**Status:** resolved

**Blocked by:** [05-shared-identity-switching](05-shared-identity-switching.md)、[06-weekly-entry-rotation](06-weekly-entry-rotation.md)、[07-credential-activation](07-credential-activation.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T052、T054、T055。

## Acceptance Criteria

- [x] 設定範例及維運文件說明兩項 server-only 設定、hash／REPL、首次部署停舊版再 migration／初始化／開流量、帳密版本啟用與回復；不寫實際 secret，不因回退重新開放員工密碼入口。
- [x] 文件及必要 agent 指引反映 actor 邊界及 028 前業務 403；修改 agent 文件前使用適用技能，不描述不存在的授權功能。
- [x] 執行適用 server lint:check、unit、build、e2e、security、schema，以及 client lint/build 與 root build/lint；記錄實際結果與未執行原因，不宣稱不存在的 client 自動測試。
- [x] 最終驗收涵蓋八小時 cookie、iframe、無效 HTML／RSC、所有一般 log 遮罩、雙實例撤銷、REPL 副作用及三入口切換；倉庫外代理部署阻擋必須解除或明列未完成，不能誤報可正式交付。
- [x] 實作與 API／維運契約逐項核對，交付摘要分列前端、後端、migration/config、限制與證據；沒有角色表、管理 UI、OAuth 前端、029 選單或提前 028 業務放行。

## Comments & Implementation Results

### 2026-11-05 實作結果（分支 `027-08-integration-handoff`，自 `027-super-user-access` `19633f8`）

**部署阻擋：未解除。** Nginx 8080／ALB 會記錄完整入口 URL，遮罩設定在 repo 外，需主機管理員／SRE 完成並留下驗證證據。解除前 027 **不能宣稱可正式交付**，UAT／正式環境不得執行 `initialize()` 或提供入口。本張只在 `docs/deployment/uat-cicd.md` 與 quickstart 標明狀態，未連 UAT 主機。

**變更摘要（只有文件與 `server/.env.example`，沒有程式、migration 或 schema 變更）**

- T052：
  - `server/.env.example` 新增 `SUPER_USER_ACCOUNT`、`SUPER_USER_PASSWORD_HASH`（空值、說明產生方式與啟用流程）。
  - root `README.md`：快速開始加 hash 步驟；新增「Super user 維護登入」，含 REPL 指令（`repl:dev`／`repl`／容器 `node dist/console/repl.js`）、一次一行、028 前的 403。repo 沒有 `server/README.md`，不另建檔。
  - `client/README.md`：隱藏入口不在 `(main)`、proxy 渲染前驗證、client 不需設定。
  - `docs/deployment/uat-cicd.md` 新增「Super user 維護登入（Spec 027）」：設定與 server.env 跳脫、hash（含 `docker run -it`）、容器內 REPL、首次部署 7 步與 UAT 對應、部署後檢查 `auth.entry_rotation_(failed|uninitialized)`、每週輪換（NTP、重試、不用 `promote()`）、換帳密與回復（commit 生效、混跑 503、完成條件）、身分邊界、回退。log 遮罩一節加「狀態：未解除」。
  - `server/AGENTS.md`（依 writing-for-agents）：guard 改寫為只放行員工、Super user 只進 `@AllowSuperUser()`；補 REPL 入口；log 禁止項加隱藏入口。`client/AGENTS.md` 已有隱藏入口說明，未改。
- T055：
  - `contracts/openapi.json`：刪 GET 429；錯誤碼範例改為實際值（`NOT_FOUND`、`REFUSE_SERVICE`、`INVALID_REQUEST`、`UNAUTHORIZED`、DELETE 503 `AUTH_DB_UNAVAILABLE`）；guard 與框架層錯誤移除 `Cache-Control` 宣告。
  - `contracts/api-behavior.md`、`contracts/operations.md`：同步錯誤碼；補 REPL 回傳值（`{initialized}`、`{activated}`、409 `AUTH_SUPER_USER_GENERATION_CONFLICT`）、單筆 `credentials.activated`、容器指令、NTP／`promote()`、UAT 部署後 initialize、換帳密完成條件、回退不得重開員工帳密登入。
  - `tasks.md`：更新 T032／T033／T040 的過期附註，勾選 T052～T055，狀態列改為已實作並指向阻擋。
  - `quickstart.md` 新增「027-08 整合驗收與交付摘要」：前端、後端、migration／config、契約校正、驗證證據、限制。
  - 範圍核對：沒有角色表、管理 UI、OAuth 前端、029 選單或提前放行的 028 業務 API。

**驗證（實際指令與結果，細節見 quickstart「027-08」）**

- `pnpm -C server lint:check` 0 errors／271 warnings；`test --runInBand` 123 suites／1265 tests；`build` 成功；`test:e2e` 559 passed、1 skipped、1 failed（既有 `api-coverage` history 路由，未修）；`test:e2e:security` 19 suites／157 tests；`test:schema` 6 suites／39 tests。
- `pnpm -C client lint` 0 problems、`build` 成功；root `pnpm build` 成功、`pnpm lint` 0 errors（dry-run，沒有修檔）。client 沒有 test script。
- 手動整合（開發庫 `feastogether_intranet_027a`／Redis DB 9、合成 Portal 庫、server 3011、client 3010）：
  - REPL 副作用：未初始化與初始化後的查詢 helper 前後 checksum 不變，沒有 LISTEN、沒有連 Redis、沒有 history 檔；建置版 `pnpm repl` 與 server image 內 `node dist/console/repl.js` 結果相同。image 沒有 pnpm，hash 工具與 migration 在 image 內可執行。
  - API 契約逐項 curl：狀態、錯誤碼、訊息、`Cache-Control`、`Retry-After` 與 Set-Cookie 屬性都與校正後的契約一致。
  - 八小時：Set-Cookie `Max-Age=28800`、瀏覽器 cookie 剩 8.000 小時、DB 期限 28800 秒，過期後 401／員工頁 404。
  - 無效入口 HTML 與 RSC 都是 404 且沒有表單（curl 與瀏覽器，dev 與 standalone）。
  - 瀏覽器 14 項（iframe WebView、employee↔Super user 雙向切換與重放 401、EmbedBridge mismatch、登出不恢復、過期）：`next dev` 14/14、standalone 14/14。
  - OAuth 切換與雙實例撤銷：`security-session-replacement` 與 `security-super-user-credentials` 單獨重跑 2 suites／20 tests 通過。
  - 一般 log：Nest、`next dev`、Next dev log 檔、standalone 輸出對入口、密碼、hash 與 25 個 cookie／啟動碼／JWT 的命中都是 0。

**未驗證／限制**

- UAT compose 的 `run`／`exec` 需要主機路徑，以本機 `docker run -it` 驗證同一 image 指令。正式 HTTPS 下 `SameSite=None; Secure` 未在瀏覽器實測（本機為 Lax）。
- Super user 在 028 前經 `/` 轉到 `/esign/forms` 看到業務 403、過期對話框是員工文案；OAuth 瀏覽器入口不在 027。
- commit 後回應遺失需重新登入；兩分頁無舊 cookie 並發登入時，另一筆會話留到 8 小時到期。
- 輪換需 NTP；3 次重試後等下次排程、worker 重啟或 REPL 補做。REPL 一次貼多行不等 `await`。
- 員工 e2e 在測試庫累積 `login.succeeded`，該庫的 down 會被拒絕。
- UAT 自動部署無法在 migration 與啟動之間暫停，`initialize()` 改在部署成功後執行（期間維護登入 503、員工不受影響）。使用者決定維持，不改 `deploy-uat.sh`。
- guard 或框架層擋下的錯誤回應不帶 `Cache-Control: no-store`，契約已依實作描述。使用者決定維持（回應不含身分或入口資料）。
- 範圍外觀察：Next 404 頁在 standalone 帶 `s-maxage=31536000`（既有 not-found 行為，未處理）。

### 整合紀錄

已合入整合分支 `027-super-user-access`（2026-11-05，fast-forward）：
- `e1cb4cf docs: 補 Super user 設定、REPL、部署與回復操作文件`
- `258089c docs(specs): 027 契約依實作校正，記錄 027-08 整合驗收與交付摘要`

## 後續：隱藏維護登入的存在（使用者 2026-11-06 要求）

使用者 2026-11-06 要求：不知道入口的人（匿名或已登入的一般員工）不能從公開前端資源或 HTTP 回應看出 Super user／維護登入存在。同日追加：隱藏頁與其 API 只開放公司網路（VPN 與辦公室固定出口 IP）。分支 `027-hide-maintenance-traces`（從 `027-super-user-access` `8f53def`）。

**洩漏與處理**

| 洩漏 | 處理 |
| --- | --- |
| root layout 的 `ReactQueryProvider` 把 `apiError.ts`／`errorCodes.ts` 帶進共用 chunk（`AUTH_SUPER_USER_*`、「維護…」、`isSuperUserCredentialsInvalid`） | 移除；帳密錯誤改用通用 mutation `meta.handlesOwnErrors`，錯誤碼判斷留在 `SuperUserLoginForm` |
| 共用 API chunk 含 `SUPER_USER_ENTRY_SESSIONS`、`createSuperUserSession` | 移到 `features/super-user-login/api.ts`，只由隱藏頁引用 |
| `CurrentActorBanner` 含 `'super_user'` | 改成 `user === null` 就顯示後端給的 `displayName`；型別改為 `EmployeeSession \| OtherActorSession` |
| `_clientMiddlewareManifest.js` 列出 `/ops-access/:entryKey` | matcher 改成只排除靜態資源，路徑判斷寫在 proxy 程式裡 |
| `next.config.ts` 的 `headers()` 讓錯誤入口也帶安全標頭；改寫到 `/_not-found` 多出 `x-middleware-rewrite` 與 `s-maxage` | 移除 `headers()`；`/ops-access/*` 不再有頁面，有效時才改寫到 `app/ops-access-page/[entryKey]` 並由 proxy 加標頭，其餘交給 Next 當不存在的網址 |
| POST guard 順序 Origin → 限流 → 入口（錯誤入口 403／429） | 改為入口 → Origin → 限流 |
| 自訂 8 KiB bodyLimit 的 413 | 移除，沿用 Fastify 預設 1 MiB（不存在的路由也相同） |
| 未初始化回 503「維護登入暫時無法使用」（UAT 部署後到 `initialize()` 前可見） | 改回 404 |
| Swagger 列出隱藏路由（UAT staging 開放） | `@ApiExcludeController()`；auth session 摘要不再提 Super user |

來源網路的做法：
- client `SUPER_USER_ALLOWED_CIDRS` 以 `node:net` 的 `BlockList` 比對 `X-Real-IP`。未設定時停用；格式錯誤時 proxy 載入失敗、所有請求 500（使用者 2026-11-06 決定不另做啟動檢查）。
- 頁面在網路檢查通過後才向後端驗入口。
- `/api`（不分大小寫，與 rewrite 同範圍）不允許時加上 `x-entry-network-denied`，由 `SuperUserEntryGuard` 回後端不存在路由的 404。
- UAT 的 client 讀主機 `client.env`。Nginx 要在所有轉給 client 的 location 覆寫 `X-Real-IP`；只覆寫兩個 location 會被 `/API/...` 繞過。
- review 時發現：Next 16.3.6 standalone 會對 proxy 改寫後的 `/ops-access-page/<入口>` 再執行一次 proxy，原本的程式在第二次執行時回 404，公司網路內的有效入口也打不開。改為實際頁面路徑也檢查來源網路與入口，通過才放行。以真實後端＋standalone 驗證：清單內頁面 200、登入 201 並取得 Super user 會話；清單外頁面與登入都是 404。
- review 時另修既有問題：`getRequestPath` 原本以未解碼的路徑遮罩與判斷，`/api/auth/%73uper-user-entries/<入口>` 會命中路由，但 access log 留下明文入口、`OriginGuard` 不要求 Origin。改為先解碼再比對（格式錯誤的編碼保留原字串）。

**驗證**（細節見 quickstart「027-h」）

- server：
  - `lint:check` 0 errors／271 warnings，改動檔案無 warning；
  - `test` 123 suites／1276 tests（rebase 到 `8f53def` 後）；`build` 成功；
  - `test:e2e:security` 20 suites／172 tests；
  - `test:e2e` 559 passed、1 skipped、1 failed（既有 `api-coverage` history）；
  - `pnpm test:deploy` 通過。
- client：`lint` 0、`test` 5/5、`build` 0 warning、`check:bundle` 通過（另以假檔反向驗證會失敗）。
- 實測比對（standalone）：
  - 隱藏頁：錯誤入口、IP 不在清單、缺 `X-Real-IP`、只偽造 `X-Forwarded-For`、IPv6 不在清單、允許清單未設定，HTML／RSC 都與不存在的網址逐位元組相同。
  - 隱藏 API：上述情況加上 `%73` 編碼與 `/API/` 路徑，14 種請求都與不存在路由相同。
- `next dev`：headers 相同；body 去掉 dev 隨機 key 與路徑後相同。
- 公開頁 headers 與修改前相同（ETag 除外）。
- Playwright 在 standalone 與 dev 各 23/23（子代理回報；review 時以最終程式重新 build，standalone 的有效入口實際是 404，已修，見上方「review 時發現」）。

**無法消除的差異**

- 直接開內部路徑 `/ops-access-page/*` 的 headers 與未登入員工頁相同（rewrite），與不存在的網址不同。
- DB 故障時入口查驗 503／頁面 500。
- 允許網路內錯誤入口多一次 DB 查詢的時間差，未量測。
- 隱藏頁 chunk 知道 hash 檔名即可下載。
- 格式錯誤的允許清單：程序不結束，所有請求 500。

**commits**
- `9aab70b fix(auth): 錯誤入口與不存在路由回應相同，隱藏入口不列在 Swagger`
- `47277c5 fix(client): 公開前端資源不含隱藏維護登入，並限制隱藏頁與 API 只開放公司網路`
- `73cf89b ci(deploy): UAT client 讀取主機 client.env 的維護登入來源網路`
- 文件 commit（spec、契約、quickstart、README、AGENTS、UAT 文件與本節）
- `fix(server)` commit：路徑先解碼再遮罩與判斷（review 時補）
- `fix(client)` commit：有效入口原本回 404（Next 對改寫後的路徑再執行 proxy，被「直接開內部路徑回 404」擋下），實際頁面路徑改做同樣檢查；移除 `instrumentation.ts` 的格式檢查（review 時補）

## 後續：Super user 帳密改為選填（使用者 2026-11-06 要求）

使用者要求不設 Super user 帳密也能開啟 server 與 REPL。分支 `027-optional-super-user-config`（從 `027-super-user-access` `a0d7926`）。

- `SuperUserConfigService`：`SUPER_USER_ACCOUNT`、`SUPER_USER_PASSWORD_HASH` 任一未設定時 `fingerprint` 為 `null`、`verify()` 一律 `false`；hash 有填但格式錯誤仍讓啟動失敗。
  - 原本打算「只設一個仍啟動失敗」，實作時發現使用者本機 `.env` 正是「帳號有填、hash 空白」，會擋住「先開 REPL 產生 hash」，改為任一未設定即停用。
- REPL `initialize()`、`activateCredentials()` 在未設定時拒絕執行，不寫 DB。
- 已初始化後才拿掉設定：與「本機設定不符」相同，維護登入暫停（登入 401；既有 Super user 會話的請求回 503「維護登入暫時無法使用」），恢復原設定後照常。
- 驗證：
  - server unit 123 suites／1280 tests；`test:e2e:security` 20 suites／172 tests；`lint:check` 0 errors。
  - 以「帳號有填、hash 空白」的 `.env` 實際啟動（測試庫 `feastogether_intranet_test_o`、Redis DB 6、Portal 指向本機）：HTTP `/api/health` 200、隱藏入口 404；worker 持續執行；REPL `hashPassword()` 產生 hash，`initialize()`／`activateCredentials()` 回「未設定 SUPER_USER_ACCOUNT／SUPER_USER_PASSWORD_HASH，維護登入停用；設定後重新啟動 REPL 再執行」。

