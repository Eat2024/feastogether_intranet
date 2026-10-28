# Spec 016：Portal 登入後自動進入我的電子簽調查

調查日期：2026-10-28。範圍為本機 `/Users/user/Documents/portal` 原始碼與本機電子簽原始碼；未連線正式／UAT、未登入實際帳號，未讀取機密設定。Portal 僅唯讀調查，保留原有 `index.php` 修改。

## 結論

可以沿用既有 Portal 電子簽頁面與 WebView 登入協定，達成「Email → Portal 登入 → 自動開啟我的電子簽」。Portal 需要補上登入前目的地保存及登入後回跳；電子簽另外依 Spec 016 開放員工 session 簽署。現有 Portal 已能指定 `my-signature`，不必為此重做跨系統登入或更改 launch 的固定首頁規則。

## 已確認的程式依據

| 項目 | 現況與影響 | 來源 |
| --- | --- | --- |
| 我的電子簽入口 | `hr/esign/mine` 呼叫 `_showWebview('mine')`，對應電子簽 `my-signature` | [Esign.php](/Users/user/Documents/portal/application/controllers/hr/Esign.php:55) |
| 未登入 | `WebController` 直接轉往 `base_url('login')`，沒有保存原目的地 | [WebController.php](/Users/user/Documents/portal/application/core/WebController.php:15) |
| 登入成功 | 非預設密碼固定前往 `home/index`；已登入者開啟登入頁也固定回首頁 | [Login.php](/Users/user/Documents/portal/application/controllers/Login.php:12)、[登入成功分支](/Users/user/Documents/portal/application/controllers/Login.php:110) |
| 預設密碼 | 登入先前往 `account/modifyPassword`；修改成功由畫面 JavaScript 固定轉往首頁，故此流程也要保存並恢復目的地 | [Login.php](/Users/user/Documents/portal/application/controllers/Login.php:113)、[Account.php](/Users/user/Documents/portal/application/controllers/Account.php:59)、[modify_password.php](/Users/user/Documents/portal/application/views/admin/account/modify_password.php:161) |
| Portal 權限 | 頁面及 launch 都呼叫 `_requirePage`，依 `sys_func.func_url` 與使用者選單權限檢查；沒有權限回 403 | [Esign.php](/Users/user/Documents/portal/application/controllers/hr/Esign.php:176) |
| iframe 導頁 | Portal 等待 `esign:ready`，送出 `esign:navigate` 與 target；收到 `esign:launch-required` 時載入既有 launch，再送導頁。來源與 iframe 視窗都有檢查 | [esign_webview.js](/Users/user/Documents/portal/template/js/hr/esign_webview.js:48) |
| 電子簽 session | 電子簽核對 session 與 Portal 員編；吻合即導頁，不吻合先撤銷再要求 launch。launch POST 建立 session 後先回固定首頁，再由 Portal 導到目標 | [EmbedBridge.tsx](../../client/src/features/embed/EmbedBridge.tsx)、[auth.controller.ts](../../server/src/features/auth/controllers/auth.controller.ts) |
| 登出清理 | 共用登出逐一清除 session 欄位；若新增目的地欄位，須一併清除，不能假設現有登出會清掉所有 session | [WebController.php](/Users/user/Documents/portal/application/core/WebController.php:163) |
| 站台基底 | 專案文件列正式 `/portal/`、UAT `/portal_uat/`。不能將網域根目錄當成已確認的應用路徑 | [Portal AGENTS.md](/Users/user/Documents/portal/AGENTS.md:59) |

## 建議實作邊界

以下為設計建議，尚未實作：

1. 依使用者後續提出的方案，Email 連結改為該環境 Portal 的 `login?redirect_to=hr/esign/mine`。未登入顯示登入頁，已登入且無強制改密碼待辦者直接前往目的地。
2. `Login` 在已登入回首頁分支之前，透過共用回跳 library 驗證 `redirect_to` 屬於集中允許映射；初始 `hr/esign/mine`，未來新增頁面只擴充清單。保存 server session，取用時重驗並以映射的站內路徑產生 base_url；POST／失敗重試保留。新無參數登入維持首頁，不合法參數清除目的地。
3. 登入失敗保留目的地；登入成功且無強制改密碼時，消耗目的地並轉往我的電子簽；一般登入沒有目的地時仍回原首頁。無效或過期目的地清除，不造成循環導頁。
4. 需要修改預設密碼者先完成既有程序。目的地須跨越此步驟保存，只有後端確認修改成功才提供安全回跳位置；失敗不可清除目的地或跳過修改。保留原 JSON 欄位相容性，更新畫面成功導頁。
5. 更新登出清理，並處理已登入者再次開啟帶目的地登入入口的情境。目的地僅為導覽，不是簽署人身分或授權；Portal 選單權限與電子簽本人指派檢查均保留。
6. 沿用 `Esign.php`、`Esign_webview` 與現有 `postMessage` 流程。沒有證據顯示自動到列表需要修改 launch 契約；由 Portal 外框在 session 完成後發送 `my-signature` 即可。

預計需調整的 Portal 範圍為 `WebController.php`、`Login.php`、`Account.php` 及 `modify_password.php`；是否抽出少量共用目的地驗證依實作規劃決定，不預先新增抽象層。電子簽寄信端須產生正確環境的 Portal 入口網址；不能拿電子簽 origin 直接拼接 Portal 路徑。

參數方案下，`WebController.php` 僅需核對共用登出清理，不需擴充通用原網址保存。上述建議已依使用者最新方案更新；原始碼現況表仍描述尚未實作的現有行為。

## 環境與部署待核對

- 依使用者最新確認，電子簽 UAT／PRD 均使用 `http://portal.feastogether.com.tw/portal/login?redirect_to=hr/esign/mine`，不使用 Portal UAT。參數尚待實作；正式 Portal 接哪個電子簽環境取決於其既有配置，不保留通知來源環境。
- 確認受通知員工都有「我的電子簽」選單權限且功能已啟用。Email 不授權選單，也不自動調整權限或資料庫。
- 確認兩站既有 WebView 配置、允許 origin、cookie 與 iframe 瀏覽器行為。登陸列表所需能力已有程式實作，配置是否正確仍須環境測試。
- 本調查未發現此導頁需求必須新增資料表、排程或登入系統；信件端如何引用站台 URL 應在 plan 檢查既有設定後決定，不先新增環境變數。

## 驗收矩陣

| 情境 | 預期結果 |
| --- | --- |
| 未登入點 Email | 顯示 Portal 登入頁；成功後自動抵達我的電子簽，無須再點選單 |
| 已登入點 Email | 直接進入我的電子簽，檢查／建立對應的電子簽 session |
| 登入錯誤後重試 | 仍在登入頁，正確登入後目的地未遺失 |
| 必須修改預設密碼 | 先完成修改；失敗留在修改畫面，成功後自動進入我的電子簽 |
| 一般入口登入 | 沒有本次目的地時維持首頁與既有改密碼行為 |
| 非允許目的地、外部網址 | 不接受任意回跳，不將輸入拼成導向 URL |
| 過期目的地／登出再登入 | 清除舊狀態，沒有殘留導頁或跨帳號任務授權 |
| 無選單權限／功能關閉 | 遵守既有權限與啟用檢查，不繞過限制、不無限回登入 |
| 電子簽 session 不存在／帳號不同 | 沿既有 launch 建立正確身分，再導向本人列表 |
| launch 失敗／cookie 被擋 | 顯示既有可理解的錯誤，不反覆自動登入 |
| 正式與 UAT | 通知都連 Portal 正式機；分別驗證各自 API 與 Portal 實際連接環境，不假設 UAT 文件會跨環境出現 |
| 到列表後簽署 | 依 Spec 016 完成本人簽署，無 Email OTP 或回信箱步驟；此項仍需電子簽前後端實作 |

上述為待執行驗收，未以本機靜態調查宣稱通過。

## Phase 0 補充研究：2026-10-28

以下依本機原始碼完成設計決策；無新技術或需外部查證的函式庫用法。Portal 原始碼唯讀，後端與前端由研究代理交叉檢查。

### R1：重用內部 API 與最小共用表單

- **Decision**：恢復既有本人操作端點，結果輪詢用既有 GET 列表；共用簽名呈現及 task 轉換，內外容器分別呼叫 API。
- **Rationale**：[signing-tasks.controller.ts](../../server/src/features/esign/controllers/signing-tasks.controller.ts) 已有全部寫入與檔案入口；[SigningTaskView.tsx](../../client/src/features/signing-tasks/SigningTaskView.tsx) 只缺流程；[ExternalSignForm.tsx](../../client/src/features/external-signing/ExternalSignForm.tsx) 已有防連點／requestId，但綁定外部 API。
- **Alternatives considered**：新增一套 API、把外部 cookie API 用於員工、重複製作 PDF／簽名元件，均增加不必要差異。

### R2：新證據來源與重送

- **Decision**：新內部簽章 `authenticationMethod=internal_session`，auth event 沿 principal/signer/requestId；查重前與鎖內都做本人授權。
- **Rationale**：[record entity](../../server/src/features/esign/entities/esign-signature-record.entity.ts) 已為 varchar 且有 auth event／signer unique；[signing service](../../server/src/features/esign/services/esign-signing.service.ts) 兩處重送目前硬套 external access，須同時分流。
- **Alternatives considered**：新增驗證方式表、寫入 session token、回填歷史 email_invitation，皆不需要或破壞證據。

### R3：無 Email 與通知去重

- **Decision**：內部 nullable email 保留指派、skipped/RECIPIENT_UNAVAILABLE 表示未通知；內部不產邀請 token，worker 依 batch/log/lease 與文件狀態判定。補簽 supersede 舊工作。
- **Rationale**：[signer entity](../../server/src/features/esign/entities/esign-signer.entity.ts) CHECK 已允許；[initiation](../../server/src/features/esign/services/esign-initiation.service.ts)、[reopening](../../server/src/features/esign/services/esign-reopening.service.ts)、[reminder policy](../../server/src/features/esign/services/esign-reminder-policy.ts) 與 [processor](../../server/src/worker/esign/external-invitation.processor.ts) 目前都含 email/token 耦合；[notification log](../../server/src/features/esign/entities/esign-notification-log.entity.ts) 已有 skipped 與 lease。
- **Alternatives considered**：只改發起檢查會在補簽／worker 失敗；保留內部 OTP token 充當通知授權與新需求矛盾；新表或人資通知功能不在範圍。

### R4：舊內部邀請隔離

- **Decision**：external policy 僅允許 email 指派；舊 token 在 POST 邀請確認步驟導 Portal，GET 保持不查 DB；舊 cookie 回固定內部登入提示錯誤。
- **Rationale**：[access policy](../../server/src/features/esign/services/esign-access-policy.service.ts) 目前同時接受 user/email；[external controller](../../server/src/features/esign/controllers/external-signature.controller.ts) 明定 GET 無副作用。簽署、拒簽與重送也須獨立守住 signerType。
- **Alternatives considered**：只在畫面隱藏、只撤銷 Redis、GET 消耗邀請都不能完整符合授權與原邀請語意。

### R5：Portal URL 與環境

- **Decision**：UAT／PRD 使用單一正式 Portal 登入網址常數，mail 及舊入口共用；不新增 env。
- **Rationale**：使用者最新明確要求。現有 `EXTERNAL_SIGNING_ORIGIN`／`WEBVIEW_LAUNCH_ORIGIN` 用於電子簽端，`AUTH_TRUSTED_ORIGINS` 是 allowlist，均不應挪用；見 [環境定義](../../server/src/config/app.environment.ts)。
- **Alternatives considered**：原先考慮新增 `ESIGN_PORTAL_LOGIN_URL` 分環境設定，因目前兩邊固定同站而不採；不得新增來源環境回跳或跨 DB 同步。

### R6：Portal 目的地生命週期

- **Decision**：登入頁 GET 接受集中清單中的值，POST 重試保留；新無參數 GET 清目的地；強制改密碼另存 server session 待辦，成功後清除與導頁；Logout 清除共用回跳狀態。後續使用者要求可供其他頁面擴充，採 R9。
- **Rationale**：Login constructor 先判已登入、表單 POST 不帶 query、改密碼 view 固定回首頁、WebController Logout 不 destroy 全 session；上述來源見前表。
- **Alternatives considered**：直接反射 URL、不保存目的地、將所有 constructor query 缺少視為清除，均會錯誤回跳或失去目的地；單一目標不需要新登入交易 token。

### R7：憲章與 schema

- **Decision**：依使用者已確認授權修訂憲章至 2.0.0；不做 DB migration，保留所有歷史證據。Portal 部署 PHP 版本與實際 cookie 行為列入環境驗收。
- **Rationale**：舊 Principle III 與新員工授權直接衝突；現有 nullable／varchar／通知狀態足夠。
- **Alternatives considered**：默默略過憲章、變更歷史簽章或為無實際需求增表均不採。

全部設計未知點已形成決策；剩餘部署條件不以假設視為驗證通過，詳 quickstart。

### R8：tasks 階段新增內部 BCC 群寄

- **Decision**：使用者確認僅內部邀請／催簽／補簽群寄，採 BCC，外部與 OTP 維持逐人。內部按同文件同 batch 合併，每封上限 50 個不同地址，無新環境變數；同 Email 投遞去重、指派與逐人 log 不去重。此決策取代 R3 中逐 log SMTP 的舊假設。
- **Rationale**：內部已共用 Portal URL，不需個人 token。[現有 mail port](../../server/src/infrastructure/mail/invitation-mail-sender.port.ts) 為單人 void 回傳，[processor](../../server/src/worker/esign/external-invitation.processor.ts) 與 [maintenance](../../server/src/worker/esign/esign-maintenance.processor.ts) 都按 log 排程，三者須一起改。沿現有 batch、log 與 lease 便能組合投遞，無需新表。
- **Evidence**：2026-10-28 查閱 [Nodemailer 寄送結果](https://nodemailer.com/)及 [BCC 欄位](https://nodemailer.com/message)。部分 accepted 仍可成功回傳，因此必須逐地址判定；不得延續 void 成功就全數 delivered。50 是設計上的保守批次值，仍須環境驗收，不是服務商上限聲明。
- **Alternatives considered**：逐人呼叫 send 不符合需求；To/CC 暴露名單；一封裝入全部 6,000 人缺乏容量邊界；部分成功整組重試造成重複通知；另建通知系統不必要。
- **Recovery**：共用群組 lease，逐地址結果映射回 log；明確未寄出者有限重試，未知結果不自動重寄。舊單 log 工作轉 batch，maintenance 也分流。依通知契約與新增 tasks 驗證。

### R9：共用登入回跳

- **Decision**：依使用者要求，不將登入／改密碼綁死電子簽；集中版控清單映射目的地，薄 library 供三個 controller 共用，session 改為 `login_redirect_target` 與 `login_password_change_pending`。初始僅登記 mine，其他頁面以清單擴充，取用時重新驗證。
- **Rationale**：Login 成功、已登入與 Account 改密碼都有相同目的地消費需求；集中規則可避免各處加入頁面專用 if。使用者已明確要求此擴充能力。
- **Alternatives considered**：每加一頁修改 controller、直接接受任意 URL、建立設定後台均不採。無環境變數或 schema 變更。
