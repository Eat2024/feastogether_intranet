# AGENTS.md

本文件適用於 `client/` 內的前端程式；repository 通用規範請同時參考 `../AGENTS.md`。

## 專案概觀

- 這是饗賓內部電子簽署系統的前端原型，主要功能包含文件建立、簽署人設定、簽署／拒絕、進度追蹤與 Excel 匯出。
- 技術棧：Next.js 16 App Router、React 19、TypeScript strict、MUI 9、pnpm。
- 頁面文案、錯誤訊息與程式註解以繁體中文為主。
- repository 已有 NestJS 後端骨架，但電子簽業務尚未串接 API；表單資料仍以 `src/features/forms/store.ts` 的 Next.js server-memory mock store 保存，重啟 client server 會重置。

## 常用指令

一律使用 `pnpm`，不要建立 npm 或 yarn lockfile。
依賴由 root pnpm workspace 與唯一 lockfile 管理。以下指令可在 `client/` 內執行；也可從 root 使用 `pnpm --filter feastogether-intranet-client <script>`。

```bash
pnpm dev
pnpm lint
pnpm build
pnpm start
```

- 專案目前沒有 test script 或測試框架，不要宣稱已執行自動測試。
- 一般程式修改至少執行 `pnpm lint`；路由、Server Action、型別、建置設定或相依套件有變更時，再執行 `pnpm build`。
- 若無法完成驗證，交付時要明確說明未執行的項目與原因。

## 目錄與責任

- `src/app/`：App Router layouts、pages 與 route handlers。頁面預設保持為 Server Component。
- `src/features/forms/`：文件建立、簽署人、狀態、排序、匯出、mock store 與 Server Actions。
- `src/features/my-signature/`：目前使用者的待簽／已簽流程與簽名處理。
- `src/components/`：跨 feature 共用的 UI 元件。
- `src/lib/`：無 feature 歸屬的純工具函式。
- `src/theme/tokens.ts`：唯一的 design token 來源。
- `src/theme/theme.ts`：唯一的 MUI theme 與全域 component overrides。

新增程式碼時，優先放在最接近業務責任的 feature；只有確實跨 feature 共用時才移到 `components` 或 `lib`。

## Next.js 與 React 慣例

- 只有需要 state、effect、browser API 或事件處理的元件才加 `'use client'`；不要把整個 page 或 layout 無故改成 Client Component。
- 資料讀取、權限判斷與敏感資料裁切留在 server 端。Client Component 的 props 必須可序列化。
- 寫入操作使用標有 `'use server'` 的 Server Action。所有輸入都要在 action 內重新驗證，不可信任 client 端驗證。
- action 成功後依既有模式呼叫 `revalidatePath`，需要導頁時使用 `redirect`；可預期的驗證失敗回傳 `{ error: string }`，畫面文案使用繁體中文。
- App Router 的 `searchParams`／`params` 依 Next.js 16 型別與現有頁面模式處理；優先使用產生的 `PageProps<'/route'>`、`LayoutProps<'/route'>`。
- 內部導頁優先使用 MUI 元件的 `href`；theme 已將 `MuiButtonBase.LinkComponent` 接到 `next/link`。
- import 優先使用 `@/` alias，feature 內緊密相鄰檔案可使用相對路徑。
- 不要為了順手而大範圍改格式、引號或 import 排序；維持所在檔案的既有風格。

## 資料與業務不變量

- `EFormDoc.status` 實際儲存值只有 `draft | active | stopped`；`completed` 必須透過 `deriveStatus()` 推導，不可直接寫入 store。
- 簽署完成數使用 `signedCount()`，不要在各頁重複實作狀態邏輯。
- 日期使用 `YYYY/MM/DD`，時間使用 `YYYY/MM/DD HH:mm`；現有排序依賴此格式可直接做字串比較。若要改格式，必須同步檢查排序、期限與匯出邏輯。
- 員工簽署人 ID 來自組織資料；外部 Email 簽署人 ID 使用 `emailSignerId()` 產生。Email 寫入前須 normalize 並驗證。
- 文件已有簽署紀錄或已停止時，不得再修改受保護的文件／簽署設定，除非需求明確改變這項規則。
- mutation 後要重新驗證 `/forms` 與 `/my-signature` 的相關畫面，避免列表與詳情狀態不同步。
- mock store 會原地修改物件。新增排序／篩選時回傳新陣列，不要意外重排 `getForms()` 的原始陣列。

## 簽名與隱私

- 手寫簽名是敏感資料。把 form 傳給一般 client 畫面前使用 `toClientForm()`；簽署人視角使用 `toSignerView()`，不可直接把完整 store 物件傳給 Client Component。
- 不得把其他簽署人的 `signatures`、`signatureIds`、`consent` 或不必要的身分資訊暴露到 client、query string、log 或錯誤訊息。
- 簽署 action 必須保留身分、資格、期限、條款版本、PNG data URL 大小／格式，以及 signature ID 唯一性的 server-side 驗證。
- 不要降低 `next.config.ts` 的 Server Action body limit，除非同步確認所有簽名 payload 的大小需求。
- 新增下載或匯出功能時，先在 server 端決定可揭露欄位，不要直接序列化完整 `EFormDoc`。

## UI 與設計系統

- 優先使用 MUI 元件及 `sx`；避免新增另一套元件庫或零散 CSS。
- 色彩、字級、字重、間距與圓角應取自 theme。不得在頁面元件中新增任意 hex 色碼、任意字級或任意字重。
- 新 design token 先加到 `src/theme/tokens.ts`，全站性的 MUI 行為放在 `src/theme/theme.ts`，不要在多個頁面重複相同 override。
- 文字樣式優先使用專案自訂 variants：`pageTitle`、`sectionTitle`、`subheading`、`body`、`description`、`content`、`secondary`、`label`、`helper`、`kpi`。
- 延用 `PageHeader`、`ConfirmDialog`、`SearchField`、`SortableHeaderCell`、`LinkPagination` 等既有共用元件，不重造近似版本。
- 保留語意化 HTML、keyboard 操作、可見 focus、表單 label、`aria-*` 與 disabled／pending 狀態。非原生互動元素必須補齊可及性行為。
- 新畫面需考慮窄螢幕；專案的主要斷點定義在 `tokens.ts`，其中 `sm` 為 768px。

## 實作原則

- 修改前先讀取相鄰 page、component、types、actions 與 domain helper，沿用現有資料流，不建立平行實作。
- 業務規則放在可重用的純函式或 feature helper；page 只負責取得參數、組合資料與 render。
- 型別要精確，避免 `any`、不必要的 type assertion 與非空斷言。輸入邊界先驗證再縮窄型別。
- 不要把 prototype 行為描述成已串接正式 API。遇到現有 `TODO`（通知、刪除、停止簽署、稽核、QR 驗證頁）時，除非任務明確要求，保留其未實作狀態。
- 未經需求不要引入新 dependency；若確有必要，需更新 `package.json` 與 `pnpm-lock.yaml`，並在交付摘要說明理由。
- 不要修改 `.next/`、`node_modules/` 或其他 generated artifacts。

## 交付前檢查

1. 確認只修改任務需要的檔案，且沒有覆蓋使用者既有變更。
2. 檢查 Server／Client boundary，以及傳到 client 的資料是否含簽名或個資。
3. 檢查狀態推導、日期格式、revalidation 與 redirect 是否仍符合既有流程。
4. 執行適用的 `pnpm lint` 與 `pnpm build`。
5. 最終回覆簡要列出修改內容、驗證結果，以及仍存在的限制或未執行項目。
