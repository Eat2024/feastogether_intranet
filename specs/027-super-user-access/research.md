# Phase 0 Research：Super user 登入與輪換

日期：2026-11-04。靜態讀碼及官方文件核對，沒有登入上游、讀取 secret 或執行資料庫變更。以下決策用於設計，不代表目前功能已存在。

## R1 — 延伸既有 session，採可區分操作者

**Decision**：保留 `auth_sessions` 與 `FT_ESIGN_SESSION`，新增 `actor_kind=employee|super_user` 與維護憑證版本。Super user 的 user_id 為 NULL，不建立假員工。request.actor 為 discriminated union；員工仍填既有 request.user 與 CLS_AUDIT_USER_ID，Super user 只填新的 actor context。

**Rationale**：目前 [session repository](../../server/src/features/auth/repositories/auth-session.repository.ts) INNER JOIN users，[AuthGuard](../../server/src/framework/guards/auth.guard.ts) 要求正整數員工 ID；只把 user_id 留空會無法登入。既有部門與簽署人關聯不能用固定員工 ID 冒充。

**Alternatives**：複製 CKS JWT／Redis session 會形成兩套會話；建立 synthetic employee 會污染人事與簽署語意；全站改所有業務 actor FK 超出 027。027 只讓 session read/logout 接受 Super user，未遷移業務路由明確拒絕該身分，028 再逐一接入。

## R2 — 保留員工回應相容，維護身分不帶假 user

**Decision**：session 回應新增 actor；employee 保留 user 與 expiresAt 原欄位；super_user 回 user:null、actor.kind=super_user、顯示名稱。EmbedBridge 明確判斷非 employee 即不匹配，不能讀空 user 或自動視為同人。

**Evidence**：[EmbedBridge](../../client/src/features/embed/EmbedBridge.tsx) 讀 data.user.empId；[proxy](../../client/src/proxy.ts) 只判 session status；[cookie helper](../../server/src/features/auth/helpers/auth-cookie.ts) 正式環境是 SameSite=None+Secure，以支援 iframe，不能誤改成 Lax。

## R3 — 帳密用原生 scrypt，集中啟用版本

**Decision**：新增 server-only `SUPER_USER_ACCOUNT`、`SUPER_USER_PASSWORD_HASH`。以 Node crypto 非同步 scrypt 驗證固定格式雜湊，隨機 salt，constant-time 比較固定長度輸出；不新增套件。DB singleton 保存已啟用設定的 fingerprint 與單調增加 generation。REPL 明確啟用新設定，HTTP／worker 開機不得覆寫。

**Rationale**：只比較程序記憶體 env 無法拒絕其他舊實例；自動 startup sync 可能被舊程序倒退覆寫。每次 Super user 登入與驗 session 都比較「本機設定 fingerprint＝DB active fingerprint」及 session generation。啟用新版本是明確生效點；舊實例失配就拒絕維護身分，但員工不受影響。

**Alternatives**：每次驗證都跑慢雜湊不必要；另加共用密碼資料庫違反 env 管理來源；只重啟不能保證撤銷。

原生 scrypt、randomBytes 與 timingSafeEqual 的使用限制以 [Node 24 crypto 官方文件](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) 為準。成本參數及格式是本計畫選定值，須用部署硬體量測，不宣稱是文件推薦值。

## R4 — DB 為輪換真相，BullMQ 只負責觸發

**Decision**：一列 `super_user_access` 保存入口原值、目前已處理台北週期、有效時間與憑證版本。worker cron `0 4 * * 1`／Asia/Taipei，每次處理及 worker startup catch-up 都鎖同一列，若 latestDuePeriod 不大於 storedPeriod 就 no-op，否則只輪換一次到目前週期。

**Rationale**：[既有 Portal scheduler](../../server/src/worker/users/portal-user-sync.scheduler.ts) 已用 upsertJobScheduler；但是 Redis 排程丟失仍須靠 DB 判斷漏跑。初始化以目前最近一個週一 04:00 當作已處理週期，不等到下週才有入口。

**Alternatives**：每台 env 存網址無法一致；只存 hash 無法 REPL 查回原入口；依啟動時間加七天會漂移。隨機值是非授權入口定位，可原值保存於受控 DB；不新增加密金鑰或把它當登入 token。

[BullMQ 官方 Job Schedulers](https://docs.bullmq.io/guide/job-schedulers/) 說明 scheduler 的 upsert 與產生工作機制；本計畫另用 DB 週期鎖補足業務冪等，不假設排程提供 exactly-once。

## R5 — 登入切換要在同一 DB transaction

**Decision**：OAuth callback、WebView activation、Super user 登入都在驗證外部輸入成功後，以共用 SessionService 在交易內鎖定目前瀏覽器傳入的舊 session、撤銷舊列並發新 session。cookie 只在 commit 後設定。WebView launch JWT 驗證仍不動 browser session，直到 activation 才替換。

**Rationale**：現行 [OAuth login](../../server/src/features/auth/services/oauth-login.service.ts) 只 issueSession，不撤舊；現行 [AuthService](../../server/src/features/auth/services/auth.service.ts) 也將 WebView／密碼／session 責任集中。抽出具體 SessionService 是三個已存在入口共用的必要責任，不新增 provider framework。

**Concurrency**：相同仍有效舊 token 的並發替換只能一個成功，另一個回 409 且不送 Set-Cookie；登入失敗不先登出。沒有舊 cookie 時不能識別兩次請求是否來自同一瀏覽器，前端禁止重複送出，不額外建立裝置識別或第二種長期登入 cookie；所有瀏覽器後續只帶一個目前 cookie。網路中斷在 commit 之後不能保證客戶端收到新 cookie，需重新登入，不回復舊會話。

## R6 — REPL 使用窄 context，安全事件獨立保存

**Decision**：建立 AuthSessionModule／SuperUserAccessModule（無 HTTP guard／controller、無啟動寫入）、ConsoleModule 僅組 config、logging、Mysql 及所需 services。`repl(ConsoleModule)` 不 import AppModule／WorkerModule／完整 InfrastructureModule，不載 S3/mail/Portal／queue。只暴露受控 helpers，不暴露 DataSource／任意 SQL；REPL history 關閉。

**Rationale**：CKS REPL 載入 AppModule 有初始化寫入；intranet [InfrastructureModule](../../server/src/infrastructure/infrastructure.module.ts) 亦含 mail/storage。只為查入口不應要求這些外部依賴。必要的 `auth_security_events` append-only 記登入、登出、版本啟用及輪換，成功寫入與 session／入口變更同交易；不恢復文件事件鏈。

## R7 — 隱藏位置不是授權；遮罩必須跨層

**Decision**：UI `/ops-access/[entryKey]`；GET `/api/auth/super-user-entries/{entryKey}` 只驗位置且不回入口；POST 同路徑 `/sessions` 驗位置與帳密。UI server-render 前檢查，提交再次檢查。入口比對與發 session 在同交易重驗，避免輪換競態。維護登入不允許 iframe，成功後 replace 到 `/`。

**Evidence**：[getRequestPath](../../server/src/framework/http/request.context.ts) 只遮外部邀請與驗證；[access interceptor](../../server/src/framework/interceptors/http-access-log.interceptor.ts) 還會記 raw URL/body，需要一起修改。部署層 nginx／Next access log 也須遮罩，不能只改 app log。

**Origin／rate limits**：沿用 [OriginGuard](../../server/src/framework/guards/origin.guard.ts) 的 exact origin／Fetch Metadata 防護，新增路徑須列入 explicit-origin 條件；使用現有 10次/60秒、50次/300秒 Redis 視窗。維護入口不得沿用現 guard 的「無 IP 放行」，缺可信 IP 回 503；計數按 client IP+固定入口類別，不按 entryKey 分桶。所有錯誤身分都執行相同成本密碼驗證，不按帳號分支提早回應。

## 已解決事項與證據界線

已確定身分類型、相容回應、憑證生效、DB 週期、REPL context、遮罩與原子切換；無未決產品問題。真實 OAuth／Portal 上游、部署硬體 scrypt 延遲、瀏覽器 iframe cookie 與代理 log 遮罩尚未實測，列入 quickstart 驗證，不當成已通過。
