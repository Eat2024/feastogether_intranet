# 028 驗證指南

本文件描述實作後的驗收程序；目前僅有設計文件，尚未建立授權API或執行以下業務驗收。

## 前置

完成027 actor／session與REPL；準備隔離MySQL、Redis、測試儲存與Portal測試資料。依既有.env.example設定本機環境，不提交secret。至少準備兩個部門、無額外角色員工、建立者、管理員、已停用員工、未登入員工與Super user；另以測試catalog提供第二子功能，不寫入正式目錄。

在repository root執行既有指令：

```bash
pnpm install
pnpm -C server db:test:create
pnpm -C server test:schema
pnpm -C server test -- --runInBand
pnpm -C server test:e2e
pnpm -C server lint:check
pnpm -C server build
```

若實作包含本plan要求的client型別／列表呼叫相容，再執行`pnpm build`與`pnpm lint`。手動流程以`pnpm dev`啟動現有HTTP、worker與client。開發資料庫migration用`pnpm -C server migration:run`；不可直接對正式庫試驗。REPL啟動沿027實作完成的指令，helper見[operations.md](contracts/operations.md)，不預造尚不存在的package script。

## 驗收順序

1. **Schema與seed（US2、US5／SC-001、006）**：up、重跑seed，確認一般角色自訂設定不被覆寫，員工及簽署FK／證據摘要保持。直接向MySQL送跨module的role_permission／user_role須被複合FK拒絕；並發同module同名create只有一筆成功，不同module同名可成立。soft-delete後可重用名稱但不能重用舊roleCode。驗證actor CHECK拒絕Super帶employee ID或employee缺ID。down於沒有Super資料時可回復，有Super資料時安全拒絕破壞性回退。
2. **同仁（US1／SC-002）**：OAuth及WebView新／舊session查`GET /api/me/authorization`都取得baseline；GET前後DB關聯筆數不變。同部門各既有可見狀態列表、detail、原始PDF允許；建立、一般匯出及歷史／下載拒絕。本人跨部門簽署／副本仍依本人規則；本地停用即拒絕，缺部門不影響另行判斷的本人資格。
3. **角色隔離與聯集（US2／SC-001、003）**：兩個角色互補能力、重複能力，撤掉其中一個不抹去另一個。第二module同名角色無法授予esign能力。角色停用／permission修改／撤指派提交後，保留原session對兩個HTTP實例發下一請求皆用新權限。無Redis權限快取或前端能力值可繞過。
4. **管理交易（US3／SC-004）**：只有Super或027維護context可管理；一般員工／esign管理員取得403。API和REPL各自建立角色、配權限、預指派未登入有效員工、撤銷，結果與稽核一致。競爭首次登入／預建檔只有同一users ID；同角色版本衝突409，指派CAS衝突409，audit失敗全部回滾。停用角色保留指派，使用中刪除409。所有同仁CRUD／permission修改／撤除企圖拒絕。
5. **員編失敗**：不存在、無效、模糊匹配的目標回422 AUTHORIZATION_EMPLOYEE_INELIGIBLE，Super session維持登入；Portal故障502且不fallback；本地disabled回403 ACCOUNT_DISABLED且不復活。只有操作者自身session無效回401。檢查錯誤及log無原始Portal內容／員編。
6. **電子簽管理與actor（US4／SC-005）**：一般建立者只能合法管理自己的文件；管理員／Super可跨部門處理他人合法狀態文件，不能改原creator／department。Super建立必填有效departmentCode，employee不能覆寫部門；完成上傳、欄位、簽署人編輯、發起、worker、通知與一般匯出，所有actor CHECK、mapper及檔名正常。worker記錄真正發起者而非文件creator；既有client列表super送all、員工送dep，顯示Super user且不出現undefined／假員編。
7. **不可繞過的邊界**：管理者／Super代簽、代拒簽、他人個人副本、departmentFile與pdf歷史下載旁路全部拒絕；完整文件的一般ZIP／Excel匯出在能力與範圍合法時允許。停止／完成狀態的非法改寫仍拒絕；外部邀請、OTP、公開驗證與簽名證據回歸不變。撤權前已受理job可完成，但撤權後poll／retry／download重驗並拒絕。
8. **029契約與端點覆蓋**：本人能力response符合OpenAPI，actor沿027 union、module／permissions排序，無role完整資料或憑證；Cache-Control:no-store。以路由清單比對[permissions.md](contracts/permissions.md)，每個非公開endpoint均有auth-only或能力分類；HTTP以實際請求確認非只metadata存在。029三選單key一致，403不觸發登出。
9. **導入演練（US5／SC-006）**：依operations停流量切換，只有同仁自動生效，核定額外指派全數核對；沒有歷史行為升權。重跑seed／指派不重複關聯。測試readiness拒絕缺目錄，備份／回復策略能保護Super資料與既有證據。

成功標準為spec全部SC；將執行命令、結果與無法驗證的環境限制記錄於實作交付，不以文件或mock替代真MySQL／worker證明。
