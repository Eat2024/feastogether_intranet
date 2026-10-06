# 電子簽前端

饗賓內部電子簽署系統的 Next.js 前端 package。

## 開發

```bash
cp .env.example .env.local
pnpm --filter feastogether-intranet-client dev
```

依賴請先在 repository root 執行一次 `pnpm install`。開啟 <http://localhost:3000>；也可從 root 使用 `pnpm dev:client`。

`/api/*` 由 `next.config.ts` rewrite 至 `API_PROXY_TARGET`（本機預設 `http://localhost:3001`）。目前電子簽業務還在 `src/features/forms/store.ts` 的 server-memory mock store，這個 rewrite 是後續搬移到 NestJS API 的串接點。

## 驗證

```bash
pnpm lint
pnpm build
```

前端目前沒有獨立 test script。實作規範見 [`AGENTS.md`](AGENTS.md)。
