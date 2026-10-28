# 實作後驗證指南

本文件保留驗證步驟；本機程式與驗證已完成，結果見 [validation.md](validation.md)，真實 Portal 環境與部署仍待交付流程。只用合成帳號、文件與簽名，測試 DB 名稱須以 `feastogether_intranet_test` 開頭，不清理正式資料。

## 前置條件

- 依 root/client/server AGENTS 使用 pnpm，備妥符合 package engines 的 Node、MySQL、Redis 與現有檔案儲存。
- 測試設定依 `.env.example` 與既有 `.env.test`，不新增 Portal env、不把實際設定輸出或提交。
- 準備 A、B 兩名內部員工（其中一名無 Email）、一名外部簽署人，以及有／無「我的電子簽」選單權限的 Portal 合成帳號。
- 可寄送測試信箱與既有測試 mail sender。文件含待簽、未開始、已到期、停止、已簽、已拒及可補簽案例。
- Portal 原有 `index.php` 修改不屬此任務。PHP 語法檢查使用與部署相容版本，記錄版本。

## 自動檢查

```bash
pnpm -C server lint:check
pnpm -C server test
pnpm -C server build
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm -C client lint
pnpm -C client build
pnpm build
pnpm lint
```

實作中先針對變更執行相關 tests，交付時執行跨 package 必要檢查。client 無 test script，不宣稱已跑 client 自動測試。Portal 對本次修改的 PHP 檔逐一 `php -l`，並執行新增的目的地允許清單／session 接續可隔離測試；不得將框架 composer 預設測試誤認業務覆蓋。

## 必要 server 測試組合

| 情境 | 預期 |
| --- | --- |
| A session 操作 A 指派 | open/source/sign/reject/result/copy 依狀態成功，無 OTP |
| A session 操作 B 或外部指派 | 404，不揭露文件與副本 |
| 無 session、過期或已撤銷 | 401，不寫入 |
| 同 requestId 重試／同時提交 | 同結果 200，僅一筆證據；新 requestId 不能重簽 |
| 未開始／到期／停止／提交時改狀態 | server 拒絕，畫面狀態不是唯一 gate |
| consent、PNG、欄位、來源 hash 竄改 | 拒絕且無部分證據／檔案遺留 |
| 無 Email 混合名單 | 發起及補簽成功，保留指派，通知 skipped，其他人正常寄送 |
| HR 查詢故障／員工身分失效 | 維持失敗，不視作無 Email |
| 舊內部 token 與 cookie | token POST 引導 Portal；cookie 不可讀檔、簽署、拒簽或重送 |
| 外部完整流程 | 邀請 OTP、讀取、簽署／拒簽、重送與期限後本人下載不變 |
| 內部新證據／歷史證據 | 新為 internal_session；歷史 bytes/hash/驗證結果不改 |
| 通知競態 | 內部無 token 可寄、補簽 supersede、租約重試及歷史 queue 正確，外部世代照舊 |
| BCC 封數與隱私 | 同批 2、50 個不同地址各呼叫 SMTP 一次；51 個分兩封，6,000 個分 120 封（無失敗時）；只有 1 位仍可寄。實際 MIME 的 To/CC/BCC 標頭及正文不洩露其他收件人 |
| 共用信箱／混合名單 | 同信箱只投遞一次，各員工 log 同步結果、授權不合併；外部仍各自專屬連結 |
| 群寄部分成功 | accepted 正確記錄，暫時 rejected 僅剩餘地址群組重試；永久拒收不自動重試，不重寄已受理者 |
| 群寄恢復 | producer／maintenance／歷史單 log 工作均進 batch，並行 worker 無重複領取；DATA 後斷線、落庫失敗及 stale processing 保守 unknown，不能自動整組重送 |

測試可擴充現有 `core-esign-flow.e2e-spec.ts`、`esign-employee-email-checks.e2e-spec.ts`、`esign-reminders.e2e-spec.ts`、`esign-rejection.e2e-spec.ts`、安全相關 suites 與 service/processor unit；必要新 suite 須加入現有 Jest e2e 設定。

## Portal 與瀏覽器

1. 未登入點指定正式 Portal Email URL，登入後自動抵達本人「我的電子簽」，不用再點選單。紀錄最終 iframe origin，以確認實際電子簽環境。
2. 已登入點 Email 直接進入；錯誤帳密重試目的地保留。無參數新登入仍回首頁。
3. 預設密碼登入先改密碼；失敗不導頁，成功自動抵達 mine；改密碼前再次點 Email 也不繞過待辦。
4. 驗證外站 URL、`//host`、穿越、陣列、重複參數、未知值都不回跳；登出清除目的地。兩個分頁共享 session 時新 GET 的目的地行為符合契約。
5. 無權限或功能關閉保留拒絕，launch 故障／cookie 被擋顯示錯誤、不無限登入。
6. A/B 帳號切換沿既有 session 比對；不得看到前一人的檔案或簽名。
7. 桌面與窄螢幕完成閱讀、同意、手寫簽名、提交、拒簽與副本輪詢下載。切換文件不沿用前一份簽名狀態，session 失效提示重登，不自動提交。
8. 人資另行通知的無 Email 員工可自行登入後找到任務，本次不測試人資通知工具。
9. 在隔離測試中登記第二個站內頁面，驗證登入與改密碼後可返回，不修改 controller；移除清單項目後舊 session 回原首頁。測試目的地不加入正式清單，目的頁仍需原有權限。

## UAT／PRD 的特別驗收

依使用者要求，兩者信件都含正式 Portal URL。UAT 流程拆成：mail URL 正確、UAT 本人 API／UI 正確、正式 Portal 所連環境的完整旅程。若 Portal 接 PRD 而文件僅在 UAT，列表不會有該文件，這不等於導頁失敗；也不能據此宣稱 UAT Email 到簽署端到端完成。不得為驗收自行改正式 Portal 指向或複製正式／UAT 資料。

## 切換與交付紀錄

依 [切換契約](contracts/notifications-and-cutover.md) 先 Portal、再協調 server/client/worker。交付列出版本、日期、環境、執行指令、通過／失敗、瀏覽器與未驗證原因。新增 Portal 非機密版控回跳清單，無 schema migration 或新環境變數；需確認原有 WebView 配置與選單授權。不要將靜態程式調查當成真實登入結果。

## 本機執行紀錄（2026-10-28）

- 電子簽整合分支 `feat/016-internal-portal-signing`，實作前文件基準 `c5a8480`；既有單元測試 104 suites／948 tests 通過，root lint 無錯誤（server 206 項既有警告）。
- Node v26.4.0、pnpm 11.9.0、PHP CLI 8.5.12；已核對 root/client/server/Portal AGENTS 與憲章 2.0.0、API／通知／Portal 契約。
- Portal 原工作區 `master` 的 `index.php` 保留；另以 `develop` 的 `0f814565` 建立 `feat/016-portal-login-return` 整合分支與獨立實作 worktree。
- 已確認本機測試 MySQL／Redis 可連線；測試使用 `feastogether_intranet_test_spec016_*` 隔離 DB 與 `/tmp/feastogether-spec016-*` 檔案，不操作正式資料。
- 不引入 Spec 014 另一分支程式；UAT／PRD 信件固定指向正式 Portal，無 Email 人員由人資通知的方式不在本次實作。

- 實作前 API e2e：23 suites／209 tests 通過；security：9 suites／45 tests 通過（隔離 integration DB）。
- Ticket 02：client lint/build、root hooks 104 suites／948 tests，以及 Chrome 合成 API fixture 桌面 1280×900／窄螢幕 390×844 通過。閱讀、鍵盤同意、真實筆畫、重送同 requestId、防連點、拒簽及換人狀態重置已驗證；這不代表真實 Portal/後端完整旅程。
- Portal 本機整合 `961ed6a8`：兩個 PHP harness 與 8 檔語法檢查通過。真實 Portal／iframe/session 未驗收，ticket03 保留 ready-for-human；T011 及環境完整旅程仍未完成。

## 最後交付

程式整合 `5abefa1`、Portal `961ed6a8`；完整 API 27 suites／240 tests、security 11 suites／60 tests、unit 106 suites／964 tests 通過。完整驗證界線、FR 對應及尚待環境項目見 [validation.md](validation.md)，雙向審查見 [review.md](review.md)。
