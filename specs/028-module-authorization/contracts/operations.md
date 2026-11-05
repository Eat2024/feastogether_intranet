# REPL 與導入契約

此文件為待實作契約。延續027的隔離console與明確維護操作者，不新增REPL登入、HTTP listener或worker啟動。

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
