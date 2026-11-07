# Implementation Plan: 側邊選單設定化與權限連動

**Branch**: `dev`（讀取時實際分支，未由本流程切換） | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: `specs/029-permission-navigation/spec.md`；setup-plan的029標識由feature推導，非實際checkout。使用顯式SPECIFY_FEATURE_DIRECTORY與NO_PERSIST，未改共用feature.json。

## Summary

保留現有 permanent Sidebar、展開／收合模式與三個既有路徑，把路徑／名稱、選單結構及權限需求集中設定。從028的`auth/me`取得目前session view與module permissions，經單一純函式過濾群組／獨立項目；只在有效且完成重新驗證的快照下顯示業務連結。沿既有 API/TanStack Query 層實作目前登入者查詢與失效處理，不新增後端endpoint、資料表或管理頁。

027的隱藏登入不列入設定；Super user由028回傳全部能力，不使用前端wildcard。後端仍是權限真相，前端隱藏不取代028的授權。

## Technical Context

**Language/Version**: TypeScript strict、Next.js16／React19；pnpm workspace。

**Primary Dependencies**: 現有MUI9、Axios、TanStack Query5（本機5.104.2）；不新增dependency或UI套件。

**Storage**: 只有程序內query快照及程式設定；無DB、migration、localStorage、sessionStorage或新cookie。

**Testing**: 沿用 client 的 Node 內建 test runner 增加純函式測試；另執行lint、build、bundle檢查與實際瀏覽器驗收，後端越權用028既有Jest/e2e責任驗證。對query取消、401／403及身分切換記錄實際網路結果，不以靜態mock宣稱完成。

**Target Platform**: 現有瀏覽器與Next client、同源API rewrite；維持iframe嵌入隱藏側欄。

**Project Type**: 既有web application前端功能。

**Performance Goals**: 只有能力query在mount、路徑變更、focus與明確失效時重驗；同時403合併重驗，不定時輪詢。延遲期間顯示載入而不以舊全權限快照掩飾；不宣稱未量測延遲指標。

**Constraints**: 僅側邊導覽及必要能力／身分快取銜接，不修改全頁button、業務路由授權、OAuth頁、角色管理頁或未完成原型。

**Scale/Scope**: 初始3個獨立項目；資料型別支援一層分組，空群組過濾；維持現行 permanent Drawer 的展開／mini模式。

## Constitution Check

| 原則 | Phase 0 | Phase 1設計後 |
|---|---|---|
| I KISS/YAGNI | 只移設定及可見性概念 | 通過：3項設定、1個能力query與純過濾；無通用條件引擎、動態選單後台或新provider框架 |
| II Server權威 | 選單不能授權 | 通過：028逐次保護API；直接URL／前端改值仍不能拿資料 |
| III 最小揭露 | 不載完整角色／員工資料 | 通過：消費最小actor與permissions，不含hidden entry/token；未知或失敗fail-closed |
| IV 邊界 | 前端只透過契約 | 通過：既有API層呼叫028，無server source import；前端data-model不是DB |
| V 相稱驗證 | 權限與身分切換有風險 | 通過設計：quickstart有角色矩陣、延遲回應、失效、直接請求與iframe；未聲稱已執行 |
| 工程限制 | 不擴張前端交付範圍 | 通過：只修改必要client檔案，無環境／schema／worker新增 |

無未解決憲章違反。spec提到收合／展開一致不解讀為新增不存在UI：任何呈現方式只能吃同一可見結果；本期驗收既有permanent模式與純filter輸出。

## Project Structure

### Documentation (this feature)

```text
specs/029-permission-navigation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── authorization-consumer.md
│   └── navigation.md
└── checklists/requirements.md
```

本階段不建立tasks.md，後續由speckit-tasks產生。

### Source Code (implementation target，未建立)

```text
client/src/components/sidebar/services.ts      # 集中路徑、link/group設定與已知導覽能力
client/src/features/navigation/
  filter-visible-menu.ts                      # 純過濾／設定驗證，無HTTP
  useVisibleMenuItems.ts                      # pathname、能力query與呈現狀態
  authorization-cache.ts                      # 精確cancel/remove/invalidate helpers
client/src/api/
  endpoints.ts + query-keys.ts + query-options.ts
  types/auth.ts + types/index.ts
  requests/auth.ts + requests/index.ts
  queries/auth.ts + queries/index.ts
client/src/components/sidebar/                 # 保留現有展開/收合、MUI/theme/embedded class，改吃可見資料
client/src/components/providers/ReactQueryProvider.tsx # 業務403單次能力失效，保留027登入401例外
client/src/features/super-user-login/           # 僅027成功／登出快取銜接，不改登入契約
```

實作時以027最後實際檔案位置接入其身分清理，不能另建立第二份login或session provider。root layout、proxy、EmbedBridge與globals.css原則上只回歸驗證；若需快取銜接，僅最小修改，不變更其認證／訊息契約。

**Structure Decision**: 既有 sidebar services 為前端共用設定；navigation持有可見性純邏輯與hook；API層維持既有責任。用Sidebar自身取得能力，不新增全站PermissionProvider來複製後端角色模型。

## Phase 0 結論

[research.md](research.md)已核對CKS選單與intranet實際SideNav、QueryClient預設、Axios envelope、EmbedBridge、iframe CSS及原型狀態。本人能力契約已與028同步，見[消費契約](contracts/authorization-consumer.md)。已解決並發查詢／舊快照、未知權限與403循環問題。

## Phase 1 設計與切片

1. **契約與設定**（US4）：宣告目前能力DTO、三路徑與明確permission mapping；以link/group union避免空children被無條件顯示。設定鍵缺漏／未知／跨module不放行。
2. **能力與純過濾**（US1）：GET auth/me，沿用session actor/user/expiresAt並轉精確module permission集合；不接收roles，多需求採AND，空群組隱藏，super與employee使用同filter。
3. **Sidebar呈現**（US1、US2）：保持現有項目順序、圖示、theme與selected行為，增加載入／重試／空狀態；所有iframe隱藏規則保留。
4. **快取與錯誤**（US2、US3）：專用query設定、pathname key、AbortSignal、切身分cancel/remove，失敗不回用舊data；只對內部業務AUTHORIZATION_DENIED失效一次，排除本人能力query避免循環。
5. **整合驗收**：028實際後端、027身分切換、直接越權、聚焦／跨路徑、iframe及隱藏網址不出現在資料；無後端實作時標示未驗證，不用mock宣稱通過。

## 契約與遷移

- 唯一消費endpoint為028的GET /api/auth/me；不複製一份OpenAPI，引用[028正式契約](../028-module-authorization/contracts/openapi.json)。三個mapping見navigation契約。
- 不改session cookie或既有`auth/session`基礎流程。`auth/me`前端type沿用027的actor／user／expiresAt並加入modules，不包含任何role資料。
- 初始化能力不從原NAV_ITEMS或角色名稱fallback；部署029前028必須可用。後端更新但前端尚未上029時，原選單可能仍顯示，API照樣拒絕；不能因此暫停後端檢查。
- 029回退只還原導覽呈現，不回退028的後端權限；若能力契約故障顯示錯誤／重試，不全域放行。

## Complexity Tracking

無憲章違反。`auth/me`專用query覆寫是因現行五分鐘快取與不focus刷新不能滿足規格；窄cache helper只處理實際登入切換與403，不新增跨分頁同步／推播／permission provider framework。

## 驗證狀態

目前只產出計畫與文件；無程式、schema、config修改。文件引用／placeholder／跨spec鍵值已做靜態檢查；lint/build、瀏覽器與實際API測試留待implementation。extensions.yml不存在，無前後置hooks。可進入speckit-tasks，實作依賴027／028先完成。
