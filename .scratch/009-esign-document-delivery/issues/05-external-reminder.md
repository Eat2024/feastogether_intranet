# 05: 單位外部簽署人的催簽

**What to build:** 建立人可催簽一位外部待簽者，提醒連結走OTP，當日限額與重試可追查。

**Blocked by:** 03: 內外部拒簽與文件結案

**Status:** claimed

- [ ] 僅外部且有效待簽，寄送前再驗資格；同文件同人台北曆日一次。
- [ ] 午夜重置，跨午夜pending/processing不重排；同操作requestId冪等。
- [ ] 保留原邀請digest，提醒獨立憑證走OTP，已簽本人下載權不失效。
- [ ] DB先保存再入列、maintenance補列；已確認成功不重寄，unknown不盲重試。
- [ ] 單人正式畫面通知與結果可驗；完成對應schema、API及worker測試。

**Spec:** 009 — 對應任務 T036–T042、T044（單人）。以已確認規格、計畫及契約為準。

## 實作與驗證（2026-10-21）

- 本分支以 `8780ac5` 整合 tip 起始；TDD red：資格 helper不存在、schema缺欄、POST404、舊worker漏記當日額度；green覆蓋正式API與真MySQL/Redis及SMTP boundary。
- 新增既有batch/log欄位與 `1792454402000` migration；public UUID有DB預設以相容舊邀請寫入，保留原邀請digest。已明確依document→signer→log鎖定。
- 單人UI、POST202/detail、requestId內容防重、台北每日限額、有效外部資格、獨立提醒憑證與OTP、最多3次明確失敗重試、unknown不盲重送、maintenance補列已完成。批次畫面與完整分頁歷史由06交付。
- 驗證：server unit 97 suites/830 tests；schema 6 tests（含零drift及回滾重套）；reminders e2e 8 tests（API、SMTP、OTP/世代、停止、未知結果、租約、並發、回滾保護）；server build/lint（既有warnings），client lint/build通過。使用隔離DB `feastogether_intranet_test_009_05`，schema測試以較短前綴 `feastogether_intranet_test_05` 產生臨時DB，避免MySQL名稱長度限制。
