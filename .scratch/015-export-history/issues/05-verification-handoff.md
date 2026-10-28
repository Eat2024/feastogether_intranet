# 05: 回歸驗證與前端交接

**What to build:** 完整回歸、核對 ZIP 不受影響、對照契約，並把後端成果交給前端工程師。

**Blocked by:** 03、04

**Status:** ready-for-agent

**Spec:** 015 — SC-001～004、quickstart 驗收矩陣；對應 T028–T030。

**執行約定:** 所有票單只實作後端、必要 migration 與契約文件，不修改 client、不部署、不建立遠端 issues。開始實作改 claimed；驗收通過並合併至功能整合分支後才改 resolved，追加驗證與 commit 紀錄，保留原驗收條件。測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，只清理本次建立的合成資料。

- [ ] `pnpm -C server lint:check`、`build`、`test`、`test:schema`、`test:e2e` 通過，結果記入 quickstart「驗證紀錄」。
- [ ] quickstart #22、#23：ZIP 申請、重用、重試、下載與 worker／維護掃描不受 `excel`／`pdf` 紀錄影響。
- [ ] 實作與 `contracts/export-history-http-api.md` 一致；有差異時先回報使用者再更新。
- [ ] `docs/agents/電子簽串接待辦清單.md` 的「匯出紀錄」改為後端已完成、待前端串接；新增 `specs/015-export-history/implementation-notes.md`。
- [ ] 交接內容明列：必須跟後端一起部署的三處（ZIP 面板、檢視頁下載、外部簽署完成頁下載）、歷史頁、Excel 回報與重新下載流程。不得描述歷史頁或前端已完成。
