# 10：跨專案完整驗收與切換交付

**What to build:** 交付可追溯的 Email→Portal→本人簽署／副本完整旅程，以及可執行的協調上版與回退步驟。

**Blocked by:** 03 Portal 回跳、08 無 Email 員工、09 舊流程切換。

**Status:** ready-for-human

**Tasks coverage:** T044–T047，並彙整每張票的驗收結果。

- [ ] 電子簽必要 lint/test/build/e2e/security 與 Portal PHP 檢查通過；桌面、窄螢幕與跨帳號權限實際驗收留下結果，未測項目列明而非視為通過。
- [ ] 覆蓋內部 BCC、外部逐人、無信箱、登入／改密碼、本人簽署／拒簽／下載、舊 OTP 拒絕及歷史資料不變。
- [ ] UAT／PRD 通知皆連正式 Portal，記錄實際 iframe origin 與資料環境；不把 UAT 信開到 PRD 當作 UAT 端到端通過，不自行改正式配置或同步資料。
- [x] 切換步驟涵蓋 Portal 先行、舊 worker 在途與未知結果處理、HTTP/client/worker 相容版本、保留 queue/log 及整體回退限制；此票產出交付方案，不自動部署或推送。
- [x] 文件與 FR／驗收覆蓋完整，說明無 migration／新環境變數、只有 Portal 版控允許清單；按治理要求審查憲章修訂，保留既有規劃票歷史，不虛報已整合。

## 本機交付與未完成環境驗收（2026-10-28）

本機必要檢查、FR 對應、雙向 review 與切換方案均已完成，詳見 specs/016-internal-portal-signing/{validation,review}.md 與 contracts/notifications-and-cutover.md。程式整合 `5abefa1`、Portal `961ed6a8`。

03 的真實 Portal 環境仍未提供；缺少實際登入／改密碼、iframe origin、資料環境與完整旅程證據，故本票保留 ready-for-human，相關驗收不勾選、不標 resolved。使用者「請繼續」授權持續本機實作，不視為已取得環境或部署許可。未推送或部署。

## 使用者交付決策

使用者已確認 Portal 真實環境驗收於上線後執行，並授權發布 PR。本票保留 ready-for-human；環境驗收不阻擋本次 PR 發布，不代表已部署或驗收通過。
