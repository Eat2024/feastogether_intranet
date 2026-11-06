# 02: 固定下載範圍與並行更新共用

**What to build:** 持續簽署期間仍能下載本次固定範圍的成果；多人點擊共用同一工作，失敗重試不改範圍，離開再返回仍可看到進度。

**Blocked by:** 01：新簽署提醒與按需更新 ZIP

**對應 Tasks:** T014–T019

**Status:** resolved

- [x] 以 13 份受理後新增第 14 人，不取消、追加、重啟或自動排下一版；完成仍可下載 13 份並提示缺 1。
- [x] 10 個並發申請共用同一工作；重複點擊及過時畫面不建立重複工作。
- [x] 已簽但個人 PDF 尚未就緒者等待，不以缺檔 ZIP 宣告完成。
- [x] 新版失敗仍可下載舊版；適用重試保留原工作與快照，較舊失敗及完整性錯誤不可繞過。
- [x] 完成後「下載本次成果」與「再次更新」明確分開，前者不會觸發打包。
- [x] 離頁重開可恢復同工作；完成、失敗時畫面及歷史快取一致。
- [x] 並發、工作重送、固定內容及雙 session 驗證通過並留下證據。

## 執行紀錄

- 2026-11-06：使用者指示依 implement-spec 開始開發，確認採此拆分與依賴。前置 resolved 後才可 claimed；通過驗收且整合後才可 resolved。

- 2026-11-06：以 b7a1840 為基準，於 impl/030-02 獨立 worktree 開始實作。

- 2026-11-06：T014–T019 實作與驗證完成：修正較舊 failed 重試及重開頁面的固定工作追蹤；真實 10 session、13→14、等待 PDF、queue 恢復、固定範圍重試及雙瀏覽器 session 通過。詳見 specs/030-refresh-signed-zip/validation.md；保持 claimed，待 merger 驗收整合後 resolved。

- 2026-11-06 merger：已以 fast-forward 將 impl/030-02 的 6cf5b47 整合至 impl/030-integration。核對 10 session 共用、13→14 真 ZIP 固定範圍、來源等待、enqueue 復原、14→15 失敗後同快照重試、雙 session／reload／返回瀏覽器證據；8/8 e2e、119 suites／1204 tests、lint/build 與 hook 通過。read-ahead 測試僅以本案例來源 key 排除其他工作，保留兩 worker、慢目的端及 <64 原門檻，未改正式串流。US2 已完成，US3 取代及清理待下一票。
