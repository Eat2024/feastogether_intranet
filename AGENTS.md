# AGENTS.md

本文件適用於整個 repository。修改子專案前，還要讀取較近的 `client/AGENTS.md` 或 `server/AGENTS.md`。

## 專案概觀

- 這是饗賓內部電子簽署系統的 pnpm workspace，包含 `client` 與 `server` 兩個 package。
- `client/`：Next.js 16 + React 19 + MUI 9，由原始前端專案搬入。
- `server/`：NestJS 11 + Fastify + TypeORM + MySQL + Redis，來自 `nest_seed` 的基礎架構，含 HTTP server 與獨立 worker entrypoint。
- 電子簽業務目前仍在 client 的 server-memory mock store，尚未搬到 NestJS/MySQL。不可把骨架存在誤述為業務 API 已完成。
- 文件、註解、UI 與可預期的錯誤訊息使用繁體中文。

## 套件與指令

一律使用 pnpm，不建立 npm/yarn lockfile。所有 package 共用 root `pnpm-lock.yaml`；不在 `client/` 或 `server/` 建立獨立 lockfile。

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test

pnpm -C client dev
pnpm -C client build
pnpm -C client lint

pnpm -C server dev
pnpm -C server worker:dev
pnpm -C server build
pnpm -C server lint:check
pnpm -C server test
pnpm -C server test:e2e
```

- `pnpm dev` 會同時啟動 server `:3001`、background worker 與 client `:3000`。worker 是 `server` package 的第二個 NestJS entrypoint，不是第三個 workspace package。
- client 對 `/api/*` 的同源請求由 Next.js rewrite 代理到 `API_PROXY_TARGET`，本機預設為 `http://localhost:3001`。
- 修改單一 package 時先執行該 package 的驗證；跨前後端或 root 設定變更再執行 root `pnpm build` 與 `pnpm lint`。
- server `lint` 會寫入修正；只要檢查時使用 `lint:check`。

## 通用實作原則

- 新程式放在最接近業務責任的 package/feature，不要從 client 深層直接 import server source；前後端透過 API contract 交互。
- 業務寫入、權限與敏感資料裁切必須最終在 server 驗證，不可只依賴 client。
- 不要提交 `.env`、`.env.local`、組織個資、簽名圖檔、`.next/`、`dist/`、`coverage/` 或 `node_modules/`。
- 新增 dependency 時從 root 使用 `pnpm --filter <package-name> add <dependency>`，並更新 root lockfile。
- 未經明確要求不自行建新 DB table、環境變數、fallback、排程或額外抽象層。
- 只修改任務所需檔案，保留使用者已有變更；不要為了格式化而產生大範圍無關 diff。

## 交付前

1. 確認 client/server boundary 沒有洩漏簽名、cookie、token 或個資。
2. 執行與變更範圍對應的 lint、test 與 build。
3. 根據 `.env.example` 更新文件，但不寫入實際 secret。
4. 交付摘要說明前端、後端、migration/config 各自的變更與未完成限制。
