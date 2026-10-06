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

目前電子簽畫面與業務邏輯已完整移入 `client/`。`server/` 保留種子專案的 OAuth/RBAC/Audit 原始碼，但這些模組、entities、repositories 與 migrations 目前均未註冊；現階段只啟用 MySQL、Redis、logging 與 health check 基礎架構，並提供尚未註冊業務 processor 的獨立 worker process。電子簽資料仍在 client 的 server-memory mock store，尚未串接 NestJS API 或 MySQL。

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
