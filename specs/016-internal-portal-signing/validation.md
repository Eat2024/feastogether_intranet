# Spec 016 實作與驗證紀錄

日期：2026-10-28。電子簽程式整合版本 `5abefa1`，分支 `feat/016-internal-portal-signing`；Portal 程式整合版本 `961ed6a8`，分支 `feat/016-portal-login-return`，保留工作區 `/Users/user/Documents/portal-016-integration`。程式尚未部署，未寄正式信件。使用者已授權發布 PR；Portal 真實環境驗收依使用者決定於上線後執行。

## 本機驗證

| 檢查 | 實際結果與界線 |
| --- | --- |
| root `pnpm build`、`pnpm lint` | 整合版本 `ff13579` 通過；後續僅修改本人副本的 client 下載，該版本 `5abefa1` 的 client lint/build 與 root hooks 再次通過 |
| server unit | 整合及最後修正的正常 hooks：106 suites／964 tests 通過；未略過 hooks |
| 完整 API e2e | root 在 `ff13579` 執行：27 suites／240 tests 通過，123.85 秒。後續修正沒有 server 變更 |
| 完整 security e2e | `cb8874e`：11 suites／60 tests 通過；之後 server runtime 未變，僅補舊催簽測試及 client 下載 |
| Portal | PHP CLI 8.5.12；兩個 library/controller harness 通過，8 個變更 PHP 檔 `php -l` 通過 |
| SMTP | 真正本機 SMTP 對話驗證 MIME 無收件名單、部分 450／550 拒收；DATA 收完、尚未回 250 就斷線的 regression 驗證 unknown，不盲目重寄 |
| 容量 | 真實 HTTP/MySQL/Redis、worker 與 fake SMTP adapter：6,000 個不同地址共 120 次群寄、每次 50 地址、6,000 逐人結果。容量組約 103 秒；1／100／101／6,000 人來源查詢按 100 分批，來源故障仍回滾 |
| 瀏覽器 | Chrome、合成 API/PDF fixtures，桌面 1280 與窄版 390；驗證外部簽署／拒簽、內部閱讀／簽署、同 UUID 重試、防連點、切換任務、鍵盤同意、401 提示、副本輪詢終止及下載 bytes、催簽／補簽選取、無信箱提示與來源失敗、舊入口 Portal 提示。這些不代表真實 Portal 或正式 SMTP 端到端通過 |
| 審查 | Standards 0 項；Spec 1 項 P2 已修正並覆核，見 [review.md](review.md) |

最終 API 測試使用 `feastogether_intranet_test_spec016_final` 與隔離 Redis DB 15、獨立 `/tmp/feastogether-spec016-final` 檔案儲存；先確認該 Redis DB 為空，未執行 flush。其他實作線也使用各自測試 DB／storage。所有資料皆為合成，未輸出或提交實際環境檔。

最後修正專門驗證「ready 停止輪詢後 session 才過期」：下載 401 留在原頁顯示全域入口網重登提示；409 顯示解碼後訊息；成功下載保留伺服器檔名與原 PDF bytes；pending 停用、不自動重試、不增加 POST open 或恢復輪詢。

client 沒有測試框架或 test script；以上瀏覽器操作不稱為既有 client 自動測試套件。舊規格的內部 OTP 測試已遷移：本人流程改員工 API；仍有意義的 OTP、token 世代、密文及外部案例改明確外部 fixtures，未透過停用測試或放寬授權來通過。

## FR 與證據對應

| 規格 | 實作與證據 |
| --- | --- |
| FR-001、002、013 | 固定正式 Portal URL、內部 BCC／外部逐人；mail transport、group-notifications、group-reminders、capacity、initiation suites |
| FR-003、003a、003b | Portal 通用允許清單、登入重試／已登入、預設密碼待辦、登出清除、第二映射與移除映射；PHP harness 已通過，實際環境仍待下節驗收 |
| FR-004～008 | internal-portal-signing／completion、本人 API、共用表單、交易重送與跨人拒絕、來源／副本完整性、401 下載提示；API 與 Chrome 案例通過 |
| FR-009～010 | 舊 user token POST 303、GET 無副作用、user cookie 各入口／重送 403；internal-email-signing／copy、external-access／access-policy 與安全 suites；外部 OTP 及副本維持 |
| FR-011 | 新 `internal_session`、既有驗證方式保留；歷史 email_invitation 記錄及已產製 PDF bytes 不變，公開驗證顯示正確；無 schema migration |
| FR-012 | 無信箱 nullable 快照、skipped／RECIPIENT_UNAVAILABLE、零 SMTP、來源故障／無效身分仍拒絕；發起、催簽、補簽與本人簽署及前端提示皆有回歸 |

## 尚待部署環境驗收

- T011、T045：真實 Email → 正式 Portal 登入／必要改密碼 → iframe ready/launch/navigate → 我的電子簽 → 簽署／副本，須有可用部署環境與合成帳號。目前未提供，沒有冒充已通過。
- 需記錄實際部署 PHP 版本、iframe origin、所連資料環境，並實測無選單權限、帳號切換、cookie 被阻擋及 launch 失敗。UAT 信件同樣到正式 Portal，不代表 UAT 文件會出現在正式資料庫；不修改正式配置或同步資料以湊驗收。
- 原 standalone 窄版永久側欄，以及建立人頁首同列 actions 擠壓標題為既有 UI 限制；本次簽署與建立人控制項的窄版驗證使用 Portal 的 embedded 版面，不宣稱整個既有網站的 standalone 響應式已全面通過。

正式實作 tickets 02／04～09 已完成本機整合；03 與 10 保留 ready-for-human，由實際環境驗收收尾。規劃票 01 的歷史勾選與紀錄保留。本次未新增套件、DB table、migration、環境變數或排程；Portal 只新增版控的非機密回跳清單及共用 library。

## PR 交付決策

使用者確認「Portal 驗收要等上線才驗」。T011／T045 與 tickets 03／10 保留待上線後驗收，不將未執行項目標為通過，也不作為本次 PR 發布的阻擋。PR 發布不包含合併或部署。
