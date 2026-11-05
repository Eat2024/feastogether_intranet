# 電子簽前端

饗賓內部電子簽署系統的 Next.js 前端 package。

## 開發

```bash
cp .env.example .env.local
pnpm --filter feastogether-intranet-client dev
```

依賴請先在 repository root 執行一次 `pnpm install`。開啟 <http://localhost:3000>；也可從 root 使用 `pnpm dev:client`。

`/api/*` 由 `next.config.ts` rewrite 至 `API_PROXY_TARGET`（本機預設 `http://localhost:3001`）。`src/proxy.ts` 在進入 `(main)` 員工頁面前以同一個位址確認員工 session，未登入或失效時顯示 `app/not-found.tsx` 的 404 頁。Super user 隱藏維護入口 `/ops-access/<入口>`（Spec 027）不在 `(main)` 內，proxy 同樣在渲染前向後端驗證入口，無效或已輪換時顯示同一個 404 頁；入口值只能由後端 REPL 查詢，見 root README「Super user 維護登入」。client 不需要 Super user 設定。目前電子簽業務還在 `src/features/forms/store.ts` 的 server-memory mock store，這個 rewrite 是後續搬移到 NestJS API 的串接點。

## 驗證

```bash
pnpm lint
pnpm build
```

前端目前沒有獨立 test script。實作規範見 [`AGENTS.md`](AGENTS.md)。
