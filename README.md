# feastogether_intranet

饗賓內部電子簽署系統。專案已整合為 Next.js 前端與 NestJS 後端的多 package 結構。

## 專案結構

```text
.
├── client/                 # Next.js 16 + React 19 + MUI 電子簽前端
├── server/                 # NestJS 11 + Fastify + TypeORM 後端骨架
├── docker-compose.yml      # client/server/MySQL/Redis 本機環境
├── package.json            # 跨 package 委派指令
├── pnpm-workspace.yaml     # client/server workspace 與共用 pnpm 設定
├── pnpm-lock.yaml          # 全 workspace 唯一 lockfile
└── AGENTS.md               # repository 開發規範
```

電子簽前端位於 `client/`；本 PR 不包含前端串接，畫面仍沿用 server-memory mock 資料，API 串接由前端工程師處理。員工經 OAuth 或主平台 WebView 登入，與 Super user 維護入口共用同一個 MySQL 會話，同一瀏覽器只保留最後一次成功登入的身分；OAuth 交易與認證限流使用 Redis。登入模組啟用不代表種子專案的 RBAC 或所有電子簽業務均已完成。

## 環境需求

- Node.js `>=20.19`
- pnpm `11.9.0`（可使用 `corepack enable`）
- 需要完整後端功能時：MySQL 8.4 與 Redis 7，或 Docker

## 快速開始

```bash
cp server/.env.example server/.env
cp server/.env.test.example server/.env.test
cp client/.env.example client/.env.local

pnpm install
pnpm -s -C server super-user:hash-password   # 輸出填入 server/.env 的 SUPER_USER_PASSWORD_HASH，並設定 SUPER_USER_ACCOUNT
docker compose up -d mysql redis
pnpm -C server db:setup
pnpm dev
```

- 前端：<http://localhost:3000>
- 後端 API：<http://localhost:3001/api>
- Health check：<http://localhost:3001/api/health>
- Swagger（非 production）：<http://localhost:3001/swagger>

`pnpm dev` 使用的 server／worker 開發指令會明確設定 `NODE_ENV=development`；`start:dev` 與 `start:debug` 亦同。其他啟動方式仍須提供合法的 `NODE_ENV`（可依 `server/.env.example` 設定），缺漏或未知值會拒絕啟動。

client 請求 `/api/*` 時，`client/next.config.ts` 會代理到 `API_PROXY_TARGET`（預設 `http://localhost:3001`）。員工頁面（`client/src/app/(main)`）由 `client/src/proxy.ts` 在伺服器端以同一個位址呼叫 `GET /api/auth/session`，沒有有效員工 session 時回 404 頁。

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `pnpm install` | 依 root lockfile 一次安裝 root、server、client 依賴 |
| `pnpm dev` | 同時啟動 server、worker 與 client |
| `pnpm dev:worker` | 單獨啟動 NestJS background worker |
| `pnpm build` | 建置 server 與 client |
| `pnpm lint` | 檢查 server 與 client |
| `pnpm test` | 執行 server unit tests |
| `pnpm -C server test:e2e` | 執行 server e2e（需 `.env.test` 與 DB/Redis） |
| `pnpm -C server db:setup` | 建立 DB 並套用目前已啟用的 migrations（現階段不包含 Auth/RBAC/Audit） |

前後端更詳細的指令與約束請參考 [`client/AGENTS.md`](client/AGENTS.md) 與 [`server/AGENTS.md`](server/AGENTS.md)。

## 電子簽後端登入

員工只能經 OAuth（`POST /api/auth/oauth/start`、`POST /api/auth/oauth/callback`）或主平台 WebView（`POST /api/auth/webview-launches` → `GET /api/auth/webview` → `POST /api/auth/session`）登入。兩者都直接查 Portal 的員工資料做在職資格檢查、沿用本地帳號停用規則，驗證成功後在同一交易撤銷瀏覽器原本的會話並建立新的 MySQL session，再下發 `FT_ESIGN_SESSION` HttpOnly cookie；失敗時不動原本的會話。上游 token 不入庫、不回傳瀏覽器。一般員工帳密登入（原 `POST /api/auth/login`）與開發替代登入已移除，舊路徑回 404。

依 `server/.env.example` 設定 Portal（`PORTAL_MYSQL_*`）、WebView 與 OAuth 連線資訊；`AUTH_TRUSTED_ORIGINS` 須包含實際前端 origin。外部簽署驗證不受影響。

OAuth 後端入口保留供後續串接，啟用時須完整設定 `OAUTH_*` 並向上游註冊回呼網址。登入頁、OAuth 前端回呼、session 過期導向及電子簽畫面 API 串接均由前端工程師另行實作，本 PR 不包含這些前端變更。

Swagger 的前端用途為串接參考，不代表目前 client 已完成對應功能。

### Super user 維護登入（Spec 027）

唯一的 Super user 從隱藏入口 `/ops-access/<入口>` 以 `SUPER_USER_*` 帳密登入。HTTP server 與 worker 都需要這兩項設定，缺漏時拒絕啟動。入口存在 DB、每週一台北 04:00 由 worker 輪換，只能用 REPL 查詢：

```bash
pnpm -C server repl:dev   # 開發；建置後用 pnpm -C server repl，容器內用 node dist/console/repl.js
```

在 REPL 一次輸入一行，等結果出來再輸入下一行，`.exit` 結束：

```js
await auth.initialize()   // 套用 migration 後執行一次，建立入口與第 1 版帳密
await auth.currentEntry() // 取得 path，以前端 origin＋path 在瀏覽器開啟
```

REPL 只載入設定、logging 與 MySQL，不啟動 HTTP 或 queue consumer。入口原值與帳密不寫進 Git、ticket、PR 或 log。

Spec 028 接入業務授權前，Super user 只能讀取目前身分與登出；登入後落在 `/forms` 並顯示「目前身分無法使用此功能」。部署順序、輪換、換帳密與部署阻擋見 [UAT CI/CD 操作文件](docs/deployment/uat-cicd.md)的「Super user 維護登入」。

## UAT CI/CD

電子簽 UAT 使用本機 Git hooks 檢查品質，`uat` 更新後由專用 self-hosted runner 建置 GHCR images 並以 root `docker-compose.uat.yml` 部署。首次 runner 設定、既有 volumes 接管、migration 備份與故障處理請見 [UAT CI/CD 操作文件](docs/deployment/uat-cicd.md)。

發布 UAT 可執行 `bin/staging`（預設將已推送的 `origin/dev` 推進 `origin/uat`）；參數與正式環境尚未就緒的限制見 [發布操作指令](bin/README.md)。
