# 01: 新簽署提醒與按需更新 ZIP

**What to build:** 員工可看到目前 ZIP 與未納入的新簽署份數，需要時才按更新取得包含全部已簽副本的新版；沒有新增則沿用現有成果。這是完整的讀取、申請、畫面與內容驗證切片。

**Blocked by:** None (can start immediately)

**對應 Tasks:** T001–T013

**Status:** resolved

- [x] 無人簽署不產生空 ZIP；已有簽署則可首次產製。
- [x] 1 人舊 ZIP 加第 2 人後只讀顯示過時，明確更新才產出實際包含 2 份正確 PDF 的 ZIP。
- [x] 新增 100 筆簽署及純讀取不自動建工作；無變更下載 10 次不新增工作或歷史。
- [x] 後端依簽署紀錄身分判斷新增，不相信畫面人數；同數不同紀錄可辨識，僅改名或副本就緒不重包。
- [x] 畫面分開目前可下載成果與更新工作；更新中舊版清楚標示份數且仍可下載。
- [x] 現有多版取最新曾成功版，缺檔不退回更舊版；有新增仍可明確要求新版。
- [x] 沿用文件權限、不揭露快照、不新增 schema；service、內容及瀏覽器驗證結果可查。

**交付界線:** 隔離環境可示範，不單獨上版；安全並行與舊版停用清理仍由後續 tickets 完成。

## 執行紀錄

- 2026-11-06：使用者指示依 implement-spec 開始開發，確認採此拆分與依賴。前置 resolved 後才可 claimed；通過驗收且整合後才可 resolved。


- 2026-11-06：由 implementer 01 在獨立 worktree 開始；整合基準 775b82e。

- 2026-11-06 使用者澄清：移除 ZIP expired 狀態的查詢／型別／UI 相容處理，不影響文件簽署期限；無須處理 expired 歷史資料。

- 2026-11-06 狀態邊界補充：文件 expired 保留；共用匯出 status／歷史 UI 因 Excel/PDF 未盤點亦保留 expired。僅移除 ZIP 專用舊判斷與無呼叫者 archiveFile()，保留 expires_at/index/API，不做 migration。

- 2026-11-06 merger：已以 fast-forward 將 impl/030-01 的 6d93e69 整合至 impl/030-integration（主實作 9256a05、狀態邊界修正 7b93624）。核對 9 項 service 情境、7/7 真 DB 匯出 e2e 日誌、119 suites／1198 tests、真 Chromium Next/API/worker 1→2 份證據及 package lint/build。整合 worktree 執行原預設 `pnpm build` 通過，補足隔離 worktree 的 Turbopack 限制。文件 expired、共用匯出歷史 expired、expiresAt／schema 均保留；本票驗收完成，US2／US3／容量與清理仍依後續票執行。
