# 04: 大量更新、相容與整合交付驗證

**What to build:** 以完整使用者流程驗證既有文件、大量簽署與故障恢復都可使用新機制，提供同版切換與修正版回復說明，使整合結果可交付。

**Blocked by:** 03：新版成功後取代與清除舊 ZIP

**對應 Tasks:** T029–T032

**Status:** claimed

- [x] 既有多版及缺檔資料相容；升級不自動全量打包、刪檔或改寫歷史。
- [x] 6,000 份具代表性 PDF 能完成背景更新，記錄實際耗時、記憶體與完整性，不以複製小檔替代。
- [x] 瀏覽器完整驗收最新、過時、處理中、失敗、取代及雙 session 舊頁操作。
- [ ] 對應 server unit/e2e/storage、前端 lint、跨 package build/lint 完成；未執行項目及原因明列，不宣稱通過。
- [x] 部署說明包含 client/API/worker 同版切換、舊 worker 停止、不可直接回退不識別新狀態的舊程式，以及已刪 ZIP 不可復原。
- [x] 不包含實際部署、遠端 PR 或正式資料操作；驗收通過並整合至功能整合分支後才可 resolved。

## 執行紀錄

- 2026-11-06：使用者指示依 implement-spec 開始開發，確認採此拆分與依賴。前置 resolved 後才可 claimed；通過驗收且整合後才可 resolved。


- 2026-11-06 使用者澄清：目前沒有 ZIP expired 資料，原驗收中的「expired／缺檔資料相容」改為僅驗證缺檔，不做 expired 相容或回填；文件簽署到期規則不變。

- 2026-11-06：由 ticket04 implementer 在獨立 worktree 開始，基準 f9f3312。

- 2026-11-06：T029–T031 完成；容量完整 1→6,000→6,001，新增大型快照排序兩處修正及 RED/GREEN，Chromium 跨故事 1/1、相關 e2e 119/119、unit 1204/1204、root lint 與兩端 build 通過。詳見 validation.md。T032 的預設 root build 留由 merger 在真整合工作區確認；本票維持 claimed，未整合前不 resolved。
