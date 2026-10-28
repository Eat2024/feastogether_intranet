# 09：舊內部邀請改走 Portal，外部 OTP 保持可用

**What to build:** 員工開舊邀請會收到 Portal 引導，舊內部 OTP 憑證不能再讀檔或操作；外部人員的邀請、OTP、簽署與下載不受影響。

**Blocked by:** 05 拒簽與本人副本、07 催簽與補簽。

**Status:** claimed

**Tasks coverage:** T004/T038–T043；歷史佇列分流由 06／07 提供，本票整合驗證。

- [x] 舊內部 token 在確認 POST 引導固定 Portal，不寄 OTP、不建立外部 session、不揭露文件；邀請 GET 維持無副作用。
- [x] 已存在內部 cookie 的 task／原檔／簽署／拒簽／副本與重送全部拒絕；畫面顯示員工登入提示及安全目的地，PDF 入口不回登入 HTML。
- [x] 切換後原待簽與補簽指派可直接走我的電子簽，不需重建或補寄；新舊驗證方式不改寫已完成證據。
- [x] 外部完整 OTP、簽署／拒簽重送、已簽副本與期限後下載回歸通過；員工 session 不得取得外部指派權限。
- [x] 舊通知 queue 與新 worker 相容，內部改 BCC、外部照舊，安全測試與歷史證據驗證通過。

## 實作與驗證（待整合結案）

- 舊內部 token POST 303 固定正式 Portal，GET 保留無狀態 bridge；既有 cookie 的讀取、檔案、簽名／拒簽與重送統一 403 JSON。外部政策只允許 email 指派，包含交易內重送。
- 前端依穩定錯誤碼顯示 Portal；驗證目標 host/path/唯一 redirect_to，不接受任意 URL。PDF 載入失敗以唯讀 task 診斷，副本 Blob 下載保留 JSON 錯誤與原始檔名。
- 原 internal-email-signing/copy 的 OTP、安全、worker 產製／失敗重試／完整性與期間後副本測試保留為真正外部 fixtures；另補歷史 user token/cookie 及 email_invitation 證據不變、同一員工指派可登入簽署／期限後下載。
- 真實 HTTP：internal-email-signing/copy 2 suites、12 tests 通過（隔離 MySQL/Redis DB 11/storage）。其他內部 fixture 遷移由平行子票 7816692 保留原安全斷言並改員工端點，5 suites、38 tests 通過。
- Chrome CDP 合成 API：1280px 外部 PDF／同意／手寫簽名／同 requestId 重試／完成；390px 換人清空／拒簽重試／結果；兩種寬度的開啟 403、PDF 403、下載 403、惡意目標拒絕、外部成功下載均通過，無水平溢出。真實 API/worker 另由上述 HTTP suites 驗證。
- client/server lint 與 build 通過；server 全量 unit 通過。無 schema、環境變數或 dependency 變更。queue 相容由 06／07 與最終全量整合驗證覆蓋。
