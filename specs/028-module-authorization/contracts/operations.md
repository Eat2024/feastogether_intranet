# REPL 與導入契約

此文件為028實作後的維運交付契約。延續027的隔離console與明確維護操作者，不新增REPL登入、HTTP listener或worker啟動。

## Helpers

| helper | 行為 |
|---|---|
| authz.modules() / permissions(moduleKey) | 讀compiled目錄與可指派能力 |
| authz.roles(moduleKey, page) / rolePermissions(moduleKey, roleId) | 查角色設定與有效權限，區分停用／刪除與protected |
| authz.userPermissions(userId) | 與HTTP resolver相同結果，額外標示baseline／explicit來源，不輸出完整員工資料 |
| authz.createRole(moduleKey, input) | roleName，產生穩定roleCode |
| authz.updateRole(moduleKey, roleId, input) / deleteRole(moduleKey, roleId, expectedVersion) | 同API版本與使用中刪除保護 |
| authz.setRolePermissions(moduleKey, roleId, input) | permissionKeys及expectedVersion，同API完整集合語意 |
| authz.assignRoles(moduleKey, input) | empId、roleIds、expectedRoleIds，查Portal且同交易audit |
| authz.events(query) | 同API稽核白名單與分頁 |
| authz.syncCatalog() | 版本化冪等catalog／seed同步；一般角色存在後不覆寫設定 |

所有write由027已明確識別的維護操作者執行，驗證本次維護context仍有效；不得允許傳入任意employee／super actor繞過。來源記為repl，actor為operator，操作名只接受非個資識別。讀取不得偷偷syncCatalog。預指派時才使用Portal資格查核，不讓console啟動依賴人事上游可用。失敗與API同code、同回滾，REPL不直接呼叫repository繞過服務。syncCatalog保留同仁與目錄的版本控制，初始化變更以system／migration或具名operator記錄，不重複寫no-op audit。

## 切換

1. 在副本還原備份，核對users／文件／簽署關聯數量及證據摘要；執行schema up及catalog初始化兩次，驗證冪等。
2. 確認027維護入口與console可用。預備新版本console對擴充schema執行核定名單指派；不依歷史建立／匯出記錄推算權限，不儲存名單或員編於repository。
3. 用resolver核對每名必要建立者／管理員；一般員工只能同仁。目錄不完整時新HTTP／worker不接受流量，回報readiness失敗；不新增永久feature flag。
4. 維護窗口停止舊HTTP接受請求，排空或依既有方式安全停止worker。所有新HTTP與worker使用相同schema／catalog版本再恢復流量，避免舊實例繞過權限。
5. 驗證既有員工session免重登、跨實例下一請求撤權、Super建立與worker、合法一般匯出／他人本人副本拒絕。檢查無秘密或個資log。

## 回復

只有空測試環境且不存在授權audit或其他需保留的新資料時，才可依migration down反向還原。沒有Super actor業務資料不代表可安全down；已有authorization_events、Super建立的文件／jobs或其他受保護資料時，migration須拒絕破壞性回退，不得刪除稽核、強制恢復NOT NULL員工FK或造假員工來通過down。優先修正並向前發布；若必須全面回復，採已演練的一致DB與儲存備份還原流程，評估窗口內資料保留後才執行。既有授權限制不可因回復失敗轉成全域放行，維持服務停用直到可安全啟動。授權audit與業務證據不任意刪除。

## 可重跑的隔離演練

```bash
pnpm install --frozen-lockfile
pnpm -C server test:e2e:security authorization-cutover
pnpm -C server test:e2e:security authorization-readiness
pnpm -C server test:e2e:security authorization-routes
pnpm -C server test:e2e:security authorization-privacy
```

上述指令只接受既有 `.env.test` 的安全測試庫與非零 Redis DB。cutover 建立027版本的全合成資料，將所有表的可寫入欄位做邏輯備份、還原到第二個隔離庫，再向前執行028 migrations，兩次sync／核定合成指派、保留ID與證據及既有OAuth session；完整比較備份還原內容。這不是正式備份或真實核定名單簽核的替代品。正式文件儲存與DB一致備份及還原仍需部署環境實測。

## 維護窗口執行順序

1. 完成027維護入口／console前置，核對反向代理、CDN、APM的入口路徑遮罩與來源網段限制。應用log測試不能代替這些部署層檢查。真實核定名單由維運受控保存，禁止寫入repository、shell history或一般log。
2. 停止舊HTTP接流量，依現有方式排空／停止舊worker；取一致的DB與檔案儲存備份並在隔離副本演練。不要讓舊版HTTP或worker繼續寫入新授權schema。
3. 以同一發布版本執行 `pnpm -C server migration:run`。確認全部25支migration（本次最後為 `EsignExportActors1793923203000`），不手改migrations表或刪除audit。
4. 開啟 `pnpm -C server repl`（本機開發為 `repl:dev`），依027完成維護操作者初始化／有效credentials確認；執行 `await authz.syncCatalog()` 兩次，第二次必須 `changed:false`。console不掛readiness gate，才能修補目錄；HTTP／worker不自動sync。
5. 使用 `await authz.roles('esign')` 取得本庫role IDs，再依核定名單逐人呼叫 `authz.assignRoles('esign', {empId, roleIds, expectedRoleIds})`。以 `authz.employeeRoles` 和 `authz.userPermissions` 比對核定集合；同一目標重送必須 `changed:false`，不重複audit。禁止從歷史建立或匯出紀錄推算角色。
6. 新HTTP與worker全部使用相同發布版本。HTTP在listen前完成完整controller宣告與schema/catalog核對；worker async provider在任何onModuleInit（包括Bull consumer／scheduler）前完成核對。目錄缺失、schema版本不同或未知／空能力宣告都拒絕啟動；保持服務停用並前向修復，不能加入flag或臨時放行。
7. 僅在上述核對完成後恢復流量，確認舊實例已全部退出。用既有session驗證基線、必要建立者／管理員、下一請求撤權與本人副本限制，核對worker真正actor及業務／稽核數量。

本次repository交付只完成合成演練與程序；沒有操作真實核定員工名單、UAT或正式部署，也未替維運宣告上述窗口已執行。
