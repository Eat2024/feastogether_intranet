# 05: 單位外部簽署人的催簽

**What to build:** 建立人可催簽一位外部待簽者，提醒連結走OTP，當日限額與重試可追查。

**Blocked by:** 03: 內外部拒簽與文件結案

**Status:** ready-for-agent

- [ ] 僅外部且有效待簽，寄送前再驗資格；同文件同人台北曆日一次。
- [ ] 午夜重置，跨午夜pending/processing不重排；同操作requestId冪等。
- [ ] 保留原邀請digest，提醒獨立憑證走OTP，已簽本人下載權不失效。
- [ ] DB先保存再入列、maintenance補列；已確認成功不重寄，unknown不盲重試。
- [ ] 單人正式畫面通知與結果可驗；完成對應schema、API及worker測試。

**Spec:** 009 — 對應任務 T036–T042、T044（單人）。以已確認規格、計畫及契約為準。
