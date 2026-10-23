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

電子簽前端位於 `client/`；本 PR 不包含前端串接，畫面仍沿用 server-memory mock 資料，API 串接由前端工程師處理。認證提供員工帳密登入與 WebView SSO，共用 MySQL 員工 session；認證限流與預留的 OAuth 交易使用 Redis。登入模組啟用不代表種子專案的 RBAC 或所有電子簽業務均已完成。

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
docker compose up -d mysql redis
pnpm -C server db:setup
pnpm dev
```

- 前端：<http://localhost:3000>
- 後端 API：<http://localhost:3001/api>
- Health check：<http://localhost:3001/api/health>
- Swagger（非 production）：<http://localhost:3001/swagger>

client 請求 `/api/*` 時，`client/next.config.ts` 會代理到 `API_PROXY_TARGET`（預設 `http://localhost:3001`）。

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

後端提供 `POST /api/auth/login`，以既有 `FEASTOGETHER_BASE_URL`、`FEASTOGETHER_API_KEY` 呼叫饗賓 `/api/v1/staff/login`，核對員編後沿用 `/api/v1/hr/staff_lookup` 的資格檢查與本地帳號停用規則，再建立 MySQL session 並下發 `FT_ESIGN_SESSION` HttpOnly cookie。密碼僅即時轉送，上游 token 不入庫、不回傳瀏覽器，也不記錄登入 request/response body。

依 `server/.env.example` 設定饗賓 API 連線資訊；`AUTH_TRUSTED_ORIGINS` 須包含實際前端 origin。帳密登入不依賴 OAuth，不新增資料表或 migration；既有 WebView SSO 與外部簽署驗證保留。

OAuth 後端入口保留供後續串接，啟用時須完整設定 `OAUTH_*` 並向上游註冊回呼網址。登入頁、OAuth 前端回呼、session 過期導向及電子簽畫面 API 串接均由前端工程師另行實作，本 PR 不包含這些前端變更。

Swagger 的前端用途為串接參考，不代表目前 client 已完成對應功能。

## UAT CI/CD

電子簽 UAT 使用本機 Git hooks 檢查品質，`uat` 更新後由專用 self-hosted runner 建置 GHCR images 並以 root `docker-compose.uat.yml` 部署。首次 runner 設定、既有 volumes 接管、migration 備份與故障處理請見 [UAT CI/CD 操作文件](docs/deployment/uat-cicd.md)。
