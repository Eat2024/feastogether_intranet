# Tasks: 側邊選單設定化與權限連動

**Input**: [spec.md](spec.md)、[plan.md](plan.md)、[data-model.md](data-model.md)、[research.md](research.md)、[contracts/](contracts/)、[quickstart.md](quickstart.md)。

**Prerequisites**: 027 的 actor/session 與成功切換清理流程；028 的本人能力契約及真實 API 授權。純設定重構可先行，實際授權驗收必須等前置能力完成。

**Tests**: 規格明確要求側欄、競態與直接後端請求驗收。client 沒有 test script，本次不新增測試框架；使用受控開發 fixture、實際瀏覽器與既有後端授權測試證據。未實測不可勾完成。

**Organization**: 依 user story 分組；US4 設定重構是 US1 的前置，可依依賴先執行，文件順序不表示必須按優先級逐行實作。

## Format

`- [ ] Txxx [P?] [USn?] 說明與檔案路徑`；[P] 只代表前置完成後可與不同檔案工作並行，不代表跨階段任意執行。

## Phase 1: Setup

- [ ] T001 核對 `client/src/components/SideNav.tsx`、`client/src/components/providers/ReactQueryProvider.tsx`、`client/src/api/query-options.ts` 與 027 實作後的身分清理位置，在 `specs/029-permission-navigation/quickstart.md` 記錄現況、驗收資料準備與不含真實憑證的測試步驟；不改全域 query 預設。
- [ ] T002 [P] 核對 `specs/028-module-authorization/contracts/openapi.json` 與 `specs/029-permission-navigation/contracts/authorization-consumer.md` 的 actor/modules、401/403、no-store 契約，記錄前置 API 的可用性及尚未可執行項，不另建 OpenAPI 或後端 endpoint。

## Phase 2: Foundational

**Purpose**: 定義集中設定型別與消費邊界；T003/T004 阻擋 US4，T005 只阻擋 US1，可與 US4 並行。

- [ ] T003 建立 `client/src/constants/routes.ts`，固定 documents、signingTasks、exportHistory 的 routeId、現有 href 與繁體中文名稱；「不從 path 最後一節產生 key」，選取條件採 `pathname === href || pathname.startsWith(href + '/')`，不納入隱藏入口或不存在頁面。
- [ ] T004 建立 `client/src/constants/menu.ts` 的 link/group 聯集及現有三項順序、MUI 圖示、moduleKey/requiredPermissions mapping；遵守「requiredPermissions 必須至少1項」、「children只能是link，不含href；初期最多一層分組，禁止空群組」，圖示設定不跨 Server Component 序列化。
- [ ] T005 [P] 建立 `client/src/api/types/authorization.ts` 並於 `client/src/api/types/index.ts` 匯出消費 DTO；actor 為 employee 的正整數 userId 或 super_user 的 displayName，不偽造員工 ID；modules 為 moduleKey 與完整 permission 字串陣列，不帶 role、人員清單、部門、入口、帳密或 session 資料。

**Checkpoint**: routes/menu 與 DTO 無後端來源碼 import，未增加 DB、環境變數、dependency、Provider 或動態選單管理。

## Phase 3: US1 員工只看到可使用的業務導覽（P1）

**Goal**: 用真實本人能力過濾現有三個入口。

**Independent Test**: 同仁顯示列表與我的電子簽、具匯出能力者增加歷史匯出；未知 module、缺權限獨立項與空群組不可見。先完成 US4 的設定重構。

- [ ] T006 [US1] 在 `specs/029-permission-navigation/quickstart.md` 準備同仁、文件建立者、管理員及其他 module 隔離 fixture 矩陣與實際 API 證據欄，包含不修改原 menu/response、多能力 AND 與同尾名不跨 module 放行；fixture 不加入正式業務選單。
- [ ] T007 [US1] 在 `client/src/api/endpoints.ts`、`client/src/api/requests/authorization.ts`、`client/src/api/requests/index.ts` 登記並實作 getCurrentAuthorization，沿既有同源 Axios 攤開回應、傳入 AbortSignal；驗證 actor discriminant/必要欄位/陣列字串，遵守「同 module 重複或格式不合法整份拒絕為能力讀取錯誤」，合法未知能力只忽略、不授權。
- [ ] T008 [US1] 在 `client/src/api/query-keys.ts`、`client/src/api/query-options.ts`、`client/src/api/queries/authorization.ts` 與 `client/src/api/queries/index.ts` 新增本人能力 query；key 固定 `[CURRENT_AUTHORIZATION, pathname]`，專用 staleTime=0、gcTime=0、retry=0、focus=true、mount='always'，必要時最小擴充 options 型別；不使用 placeholderData/initialData，不改其他 query 預設。
- [ ] T009 [US1] 在 `client/src/features/navigation/filter-visible-menu.ts` 擴充 US4 設定驗證，依同 module 的完整精確能力採 AND 過濾 link、子項與空群組；回新陣列且保持順序，不用角色名稱、OAuth scope 或 actor.kind 略過驗證。
- [ ] T010 [US1] 建立 `client/src/features/navigation/useVisibleMenuItems.ts`，僅目前路徑查詢 success 且 idle 時輸出可見項；首次、fetching、paused、error、undefined data 均無業務 links，提供 loading/ready/empty/error/unauthorized 與人工重試結果，不在登入、外部或公開頁全域啟動查詢。
- [ ] T011 [US1] 將 `client/src/components/SideNav.tsx` 接上單一可見結果，呈現載入、可重試失敗與「目前沒有可使用的功能」；保留固定寬 permanent Drawer、theme、圖示、語意 nav/aria-current、鍵盤焦點與 hide-when-embedded，不新增收合 UI。
- [ ] T012 [US1] 執行 `specs/029-permission-navigation/quickstart.md` A 的真實員工矩陣及受控群組 fixture 驗收，確認獨立項也受限且缺可信部門不會被錯解為缺功能能力；記錄 client lint/build 與網路結果，不以 mock 歷史匯出宣稱完成後端授權。

## Phase 4: US2 Super user 導覽與身分隔離（P1）

**Goal**: Super user 看到三個真實入口，切回員工不保留前任能力與內部資料。

**Independent Test**: 真實登入切換與延遲舊請求重放；沒有隱藏入口或虛構管理選單。

- [ ] T013 [US2] 在 `specs/029-permission-navigation/quickstart.md` B 補全 Super user→員工、登出、登入失敗保留身分、延遲舊回應及跨分頁聚焦測試腳本；驗收前置為 027 真實登入與單會話切換，而非前端偽造 actor。
- [ ] T014 [US2] 建立 `client/src/features/navigation/authorization-cache.ts` 精確清理 helper，先 cancel 再 remove CURRENT_AUTHORIZATION、內部 session 與適用 ESIGN_* 白名單 queries；取消完成後才導航/接新身分，不清外部簽署憑證、公開資料或建立持久 session fingerprint。
- [ ] T015 [US2] 在 `client/src/features/super-user-login/SuperUserLoginForm.tsx` 與 `client/src/api/queries/auth.ts` 所承接的 027 成功登入/登出清理點加入 T014（以 027 最終實際位置為準，先核對不建立第二份流程）；失敗不清原身分，成功不恢復舊 session，不改 027 密碼錯誤401局部處理。
- [ ] T016 [US2] 在 `client/src/features/navigation/useVisibleMenuItems.ts` 比較記憶體內前後 actor identity，發現其他分頁切換後先清舊內部資料再採整份新快照，避免新 permissions 配舊 actor；只用 focus/route/refresh 發現變化，不新增 BroadcastChannel、輪詢或裝置 cookie。
- [ ] T017 [US2] 在 `specs/029-permission-navigation/quickstart.md` 記錄實際 Super user 三項可見、員工切回兩項、舊請求取消不覆蓋與外部流程不受清理影響的結果；檢查 menu/browser payload 不含入口原值、部署帳密、token、其他人資料或不存在管理頁。

## Phase 5: US3 權限變更與查詢失敗的導覽行為（P1）

**Goal**: 不重新登入即可反映撤權；401、403、離線與故障有正確狀態，沒有循環重抓或舊能力 fallback。

**Independent Test**: 撤權後 refresh/focus/route 取得新快照；實際內部業務403觸發合併重驗，能力 query 自己403不循環。

- [ ] T018 [US3] 在 `specs/029-permission-navigation/quickstart.md` C 準備延遲、503、離線 paused、格式錯誤、401、內部 AUTHORIZATION_DENIED 與非目標403案例，記錄請求次數與被拒 mutation 不重送的驗收欄位。
- [ ] T019 [US3] 在 `client/src/features/navigation/authorization-cache.ts` 加入內部業務 AUTHORIZATION_DENIED 的取消/失效/單次重驗合併，合併同時 in-flight 觸發並在完成後釋放；重驗只讀能力，不自動 retry 被拒業務寫入。
- [ ] T020 [US3] 在 `client/src/components/providers/ReactQueryProvider.tsx` 的 query/mutation 錯誤邊界識別內部業務403且 code=AUTHORIZATION_DENIED 後呼叫 T019；排除本人能力 query、登入、外部、公開與 CSRF 403，保留既有提示與 027 登入401例外，不把403判成過期。
- [ ] T021 [US3] 在 `client/src/features/navigation/useVisibleMenuItems.ts` 與 `client/src/api/queries/authorization.ts` 補齊401清能力及既有過期流程、非401 inline錯誤/人工重試與 paused離線提示；以 suppressGlobalErrorToast 防止雙重提示但不假設它會抑制401，不回用舊 snapshot。
- [ ] T022 [US3] 執行 `specs/029-permission-navigation/quickstart.md` C，透過028撤權確認 refresh/focus/route 完成後立即移除項目、重驗中不顯示舊 links、多個403只一輪重驗、能力403不循環及登入錯密碼不跳員工過期對話框，記錄真實請求結果。

## Phase 6: US4 維護者集中調整選單（P2，可於 US1 前先完成）

**Goal**: 用集中設定維護現有導覽；錯誤配置可定位且不默認放行，既有視覺及嵌入保持。

**Independent Test**: 修改設定 label/順序即可改變 SideNav；錯誤或重複 key 被拒，/forms-other 不誤選，iframe 仍隱藏。

- [ ] T023 [US4] 在 `client/src/features/navigation/filter-visible-menu.ts` 建立設定驗證，逐項檢查 routeId、唯一 key、非空需求、已知且同 module 的能力、link/group 形狀與單層 children；開發階段定位錯誤 key、runtime 隱藏錯項，Super user 也不略過檢查。
- [ ] T024 [US4] 在 `client/src/components/SideNav.tsx` 先將硬編 NAV_ITEMS 改為集中 routes/menu 的有效設定呈現，統一精確路徑選取及無 href 群組；此重構保持既有合法三項行為，僅作 US1 前置，不宣稱已具權限過濾或增加 fallback。
- [ ] T025 [US4] 在 `specs/029-permission-navigation/quickstart.md` A/D 執行設定名稱/順序調整、空/錯誤/跨 module/重複 key 與分組 fixture、路徑邊界、鍵盤焦點及 iframe 驗收；正式設定只保留原三項，`client/src/app/globals.css`、`client/src/app/layout.tsx`、`client/src/features/embed/EmbedBridge.tsx` 的既有隱藏與 origin/parent 規則只回歸不改契約。

## Phase 7: Polish 與跨故事驗證

- [ ] T026 執行 `specs/029-permission-navigation/quickstart.md` 的完整角色/競態/401/403/iframe 矩陣，並連同028真實 API 做手動輸入隱藏頁面與直接越權請求；成功數須為0，不以 mock 原型作後端授權證據，記錄未完成前置或未能執行的限制。
- [ ] T027 在 `client/package.json` 既有腳本範圍執行 `pnpm -C client lint`、`pnpm -C client build`，結果記錄 `specs/029-permission-navigation/quickstart.md`；本期無client test script，不宣稱自動前端測試；如實際跨package/root修改才追加對應server與root檢查。
- [ ] T028 在 `specs/029-permission-navigation/quickstart.md` 補交付與回退紀錄：028先可用、029只回退呈現不回退後端授權；確認不增加DB/env/dependency/管理頁/OAuth頁、不正式化歷史匯出或其他原型，遮蔽驗證紀錄中的憑證與個資。

## Dependencies & Execution Order

```text
T001 + T002 → T003 → T004
              T005 可平行
T003 + T004 → US4（T023 → T024 → T025）
T005 + US4 + 028本人能力 API → US1（T006 → T007 → T008 → T009 → T010 → T011 → T012）
US1 + 027登入/切換 → US2（T013 → T014 → T015 → T016 → T017）
US2 → US3（T018 → T019 → T020 → T021 → T022）
US1 + US2 + US3 + US4 + 028真實授權 → T026 → T027 → T028
```

US3 使用 US2 的 cache helper，因此不宣稱兩者可並行修改同檔。US4 是小型前置重構，驗證既有行為後接 US1；此編排不是新增功能或延期權限防護。跨 spec 的具體 ticket 依最終拆分圖決定，不能只以文件存在當作能力已完成。

## Parallel Examples

- Setup：T002 的契約核對可與 T001 現況盤點並行。
- Foundation：T005 DTO 可與 T003/T004 routes/menu 同時進行；各自完成後再接故事。
- US1：團隊可並行準備受控 fixture 與後端測試身分；T007/T008/T010 有串接依賴，不標 [P]；T006 文件與其他 quickstart 編輯須序列化。
- US2：可獨立準備延遲網路/跨分頁場景，程式 T014→T015→T016 依序完成，不並改 helper/hook。
- US3：不同操作者可準備401/403/離線場景，統一由 T022 記錄；共享 provider/cache 的程式不得平行改。
- US4：圖示/鍵盤及 iframe 可由兩個瀏覽器場景平行驗證，僅一人寫 T025 紀錄；設定型別→驗證→元件依序實作。

## Implementation Strategy

1. 先完成集中設定重構 US4，維持既有合法選單，沒有新管理介面。
2. US1 是最小可示範範圍：真實028能力→過濾→側欄，但未含完整切換/錯誤驗收，不能視為完整上線交付。
3. 接 US2 保證同會話身分隔離，再接 US3 保證撤權/錯誤重驗，最後完成全部整合驗收。
4. 無法取得027/028實際功能時可準備程式與fixture，但相關實測保持未完成。

## Requirements Coverage

| 需求 | Tasks |
|---|---|
| FR-001 | T003、T004、T023–T025 |
| FR-002、FR-003 | T005–T012 |
| FR-004 | T004、T009、T023、T025 |
| FR-005、FR-006 | T003–T005、T013–T017 |
| FR-007 | T010、T011、T018、T021、T022 |
| FR-008 | T008、T013–T017、T019–T022 |
| FR-009 | T018–T022 |
| FR-010 | T003、T011、T024–T026 |
| FR-011 | T001、T002、T028 |
| FR-012 | T012、T026 |
| SC-001–SC-005 | T012、T017、T022、T025–T027 |

## Generation Status

目前只產出任務，全部未勾選。setup-tasks 使用顯式 SPECIFY_FEATURE_DIRECTORY 與 SPECIFY_FEATURE_NO_PERSIST=1；未切換分支或覆寫共用 feature pointer。執行前後未發現 `.specify/extensions.yml`，沒有前後置 hooks。格式/數量驗證不代表應用程式驗收通過。
