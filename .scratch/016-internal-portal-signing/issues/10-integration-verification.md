# 10：跨專案完整驗收與切換交付

**What to build:** 交付可追溯的 Email→Portal→本人簽署／副本完整旅程，以及可執行的協調上版與回退步驟。

**Blocked by:** 03 Portal 回跳、08 無 Email 員工、09 舊流程切換。

**Status:** ready-for-agent

**Tasks coverage:** T044–T047，並彙整每張票的驗收結果。

- [ ] 電子簽必要 lint/test/build/e2e/security 與 Portal PHP 檢查通過；桌面、窄螢幕與跨帳號權限實際驗收留下結果，未測項目列明而非視為通過。
- [ ] 覆蓋內部 BCC、外部逐人、無信箱、登入／改密碼、本人簽署／拒簽／下載、舊 OTP 拒絕及歷史資料不變。
- [ ] UAT／PRD 通知皆連正式 Portal，記錄實際 iframe origin 與資料環境；不把 UAT 信開到 PRD 當作 UAT 端到端通過，不自行改正式配置或同步資料。
- [ ] 切換步驟涵蓋 Portal 先行、舊 worker 在途與未知結果處理、HTTP/client/worker 相容版本、保留 queue/log 及整體回退限制；此票產出交付方案，不自動部署或推送。
- [ ] 文件與 FR／驗收覆蓋完整，說明無 migration／新環境變數、只有 Portal 版控允許清單；按治理要求審查憲章修訂，保留既有規劃票歷史，不虛報已整合。
