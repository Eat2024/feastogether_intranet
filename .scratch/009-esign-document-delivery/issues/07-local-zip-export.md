# 07: 背景 ZIP 匯出與七天重用：本機儲存

**What to build:** 有效員工session可跨建立人查找文件、背景匯出既有副本，離頁後從歷史下載及續傳。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [ ] 固定已簽record快照，等待既有副本、不重繪不漏檔。
- [ ] 本機串流ZIP64，安全唯一檔名，全成果落檔並驗證後發布。
- [ ] 七天從完成起算；不同員工重用同成果，新簽不混入，不延長期限。
- [ ] 查找/申請/進度/歷史/retry/原生下載可用；Range及到期410正確。
- [ ] 匯出只驗員工session不做RBAC；外部session不可用，不擴權其他管理。
- [ ] 失敗同快照恢復、全域concurrency=1、maintenance清理；完成local測試。

**Spec:** 009 — 對應任務 T015–T019、T021–T027。以已確認規格、計畫及契約為準。
