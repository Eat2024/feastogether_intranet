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

電子簽前端位於 `client/`；目前工作區的文件與簽署流程已部分串接 NestJS API，仍保留簽到表等 server-memory mock 資料。認證提供員工帳密登入與 WebView SSO，共用 MySQL 員工 session；認證限流與預留的 OAuth 交易使用 Redis。登入模組啟用不代表種子專案的 RBAC 或所有電子簽業務均已完成。

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

## 電子簽登入與 session 過期

員工頁面使用 `FT_ESIGN_SESSION` HttpOnly cookie。未登入或後端 API 回覆 401 時導向 `/login?expired=1`；重新登入後返回原本的站內頁面。403、網路故障及 5xx 不視為登入過期。尚未送出的編輯與簽名不會自動儲存或重送。

`/login` 目前使用員工編號與密碼，呼叫 `POST /api/auth/login`。後端以既有 `FEASTOGETHER_BASE_URL`、`FEASTOGETHER_API_KEY` 代呼叫饗賓 `/api/v1/staff/login`，核對回傳員編後，沿用 `/api/v1/hr/staff_lookup` 的員工資格檢查與本地帳號停用規則，再建立 MySQL session。密碼僅即時轉送，上游 token 不入庫、不回傳瀏覽器，也不記錄登入 request/response body。錯誤帳密留在登入表單顯示訊息，不觸發過期重導。

依 `server/.env.example` 設定既有饗賓 API 連線資訊；`AUTH_TRUSTED_ORIGINS` 須包含電子簽前端 origin。此登入不依賴 OAuth 設定，不新增資料表、migration 或開發者登入。原有入口網 WebView SSO 與外部簽署驗證保留；iframe 也可使用帳密登入頁。

OAuth controller 與 `/oauth/callback` 保留供未來串接，登入頁暫不顯示 OAuth 按鈕。啟用時才需完整設定 `OAUTH_*` 並向上游註冊回呼網址；全部未設定時不影響帳密登入。
