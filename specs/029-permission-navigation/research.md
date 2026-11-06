# Phase 0 Research：權限連動側邊選單

日期：2026-11-04。只讀現有程式、規格及官方文件；沒有修改應用程式或呼叫實際授權 API。

## R1 — 保留現行側欄，只移植設定與過濾責任

**Decision**：新增集中 `client/src/constants/routes.ts`／`menu.ts`，既有 SideNav 消費過濾後結果。初版仍呈現三個現有獨立入口，不強制增加群組、抽屜收合或手機選單。

**Rationale**：[intranet SideNav](../../client/src/components/SideNav.tsx) 現在是 permanent Drawer，沒有 CKS 的開關狀態與 mini navigation。Spec 中「展開／收合一致」解讀為任何呈現模式共用同一可見結果，不為不存在的 UI 增加功能。

**Alternatives**：整包複製 CKS Sidebar／PermissionProvider 會帶入不同 theme、單角色 jobKey 與不必要 UI；繼續把 NAV_ITEMS 寫在元件內則不能形成集中路徑與設定。

來源：[CKS menu](../../../CKS_Acceptance_System/client/src/constants/menu.ts)、[CKS useVisibleMenuItems](../../../CKS_Acceptance_System/client/src/hooks/useVisibleMenuItems.ts)。其中無 children 直接顯示的行為不沿用。

## R2 — 028 是本人能力的唯一契約來源

**Decision**：只呼叫 `GET /api/me/authorization`，不新增 029 後端 endpoint。使用既有 envelope 與 027 actor 聯集。028 提供的 `modules[].permissions` 是完整字串權限碼，選單以 moduleKey＋精確能力對應，不解析 role name，不使用 OAuth scope，也不讓 super_user 直接略過錯誤選單設定。

**Rationale**：已與 Spec 028 plan 協調：`/forms`→`esign.document.read`、`/my-signature`→`esign.signing.read`、`/export-history`→`esign.export.read`。Super user 的回應已包含全部登錄能力，無需前端 wildcard 或第二份角色推導邏輯。

**Alternatives**：讀管理角色清單後自行推算會暴露多餘資料；使用 session 建立時的固定 permissions 無法反映即時撤權；為選單新增 API 會重複 028 的本人能力契約。

## R3 — 同源 API 層與專用短生命查詢

**Decision**：沿用 endpoints→types→requests→queries，Axios 自動攤開 data。能力 query 單獨設 staleTime=0、gcTime=0、refetchOnWindowFocus=true、refetchOnMount='always'、retry=0；query key 含 pathname，路徑切換取得新結果。不加 placeholderData／initialData，不落 localStorage／sessionStorage。

**Rationale**：[ReactQueryProvider](../../client/src/components/providers/ReactQueryProvider.tsx) 預設 staleTime 五分鐘、focus refetch false，無法直接沿用；不能為單一導覽需求改變所有業務 query 的預設。前端能力只是呈現快照，實際 API 每次授權由 028 保證。

**Alternatives**：定時輪詢／推播不在需求；整站調成 focus refetch 可能增加無關流量；完全不快取而自行維護平行 fetch 狀態則重複既有資料層。

TanStack 支援逐 query 控制 focus refetch，見 [官方 window focus 文件](https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching)。目前本機版本由 `client/node_modules/@tanstack/react-query/package.json` 確認為 5.104.2；設計只使用現有 v5 能力。

## R4 — 重新驗證期間也不沿用舊選單

**Decision**：只有目前路徑 query 成功、未 fetching／paused／error 時才產生業務連結；重新驗證中呈現載入狀態，失敗呈現重試而非舊選單。Axios request 接受 TanStack queryFn 的 AbortSignal，切身分先 cancelQueries 再移除身份相關快照，避免舊請求延遲回來覆蓋。

**Rationale**：TanStack 在 background refetch 仍可保留既有 data，只判斷 data 存在會在撤權查詢失敗時繼續顯示舊全權限選單。query key 不能放 token，也不能依不可信 user input 決定。

**Alternatives**：單純 invalidate 不保證清除舊畫面；用前端讀 HttpOnly cookie 作為 key 不可行。使用取消訊號與回應驗證即可，無需新增裝置 cookie、BroadcastChannel 或持久 session fingerprint。

[官方 Query Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) 說明 queryFn 可取得 AbortSignal 並交給 Axios，取消可恢復 query 狀態；本計畫仍另外規定 UI 必須在取消／重新驗證期間隱藏舊項目。

## R5 — 401 與 403 沿既有錯誤層，但避免循環

**Decision**：能力 query 自己顯示非401錯誤／重試，使用 suppressGlobalErrorToast 避免雙重 Snackbar；401 仍沿 027／現有 session 失效處理。內部業務 query／mutation 得到 `403 AUTHORIZATION_DENIED` 時，顯示既有權限訊息並使目前能力失效一次；排除本人能力 query 自身、外部簽署、登入、公開驗證與 CSRF 403，不自動重送業務寫入。

**Rationale**：[現有 provider](../../client/src/components/providers/ReactQueryProvider.tsx) 的 suppressGlobalErrorToast 不會抑制401對話框。027 的密碼錯誤401例外必須維持，不可藉本次改造又套回全域 session 過期。能力 endpoint 自己若403只顯示錯誤，不能引發 invalidate→403 無限重試。

**Alternatives**：所有403導登入會誤導；任何403都重抓會把CSRF或外部憑證問題當作角色變更；自動重送寫入可能產生重複副作用。

## R6 — iframe 與 mock 範圍保持

**Decision**：保留 root layout 的 data-embedded 設定與 `.hide-when-embedded`；SideNav 在 iframe 仍隱藏，不改入口網選單協定。現有 export-history 頁仍是原型，權限控制入口不等於完成其資料串接。

**Evidence**：[globals.css](../../client/src/app/globals.css)、[root layout](../../client/src/app/layout.tsx)、[EmbedBridge](../../client/src/features/embed/EmbedBridge.tsx)、[client AGENTS](../../client/AGENTS.md)。029 不修改主頁 pre-render proxy 的401→404規則，亦不新增 OAuth 前端。

## 未實測事項

實際 028 endpoint、027 身分切換、瀏覽器聚焦／競態與 iframe 尚未執行。設計需求已解決；執行證據需依 quickstart 在前置功能實作後補齊。計畫研究由本代理在父代理分派下完成，未再建立子代理。
