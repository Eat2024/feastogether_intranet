# 通知、舊入口與切換契約

## 寄送分流

server esign 常數集中保存固定 Portal 正式登入 URL，mail 與舊內部入口共用；UAT／PRD 同值，不新增 env。不更動 `EXTERNAL_SIGNING_ORIGIN`、`WEBVIEW_LAUNCH_ORIGIN` 或既有信件供應商設定。

保留外部 `send`／`sendOtp` 單人契約；在既有 mail port 加入 `sendInternalGroup`，輸入為本批 BCC 地址陣列、kind、文件名稱、建立人及期限，沒有 invitationToken。回傳逐地址 `accepted/rejected/unknown` 及可重試分類（不暴露到一般 API）。text/html 使用相同 Portal 按鈕與登入說明，不含個人 token、簽署人姓名清單或 Email 名單。外部模板、OTP、固定收件地址及期限不變。

發起／催簽／補簽逐一處理：有有效內部 Email 才排寄；無有效地址保留指派與任務，log `skipped/RECIPIENT_UNAVAILABLE`，不記 delivered、不入 SMTP 工作。來源查詢故障維持失敗，不當作全員無信箱。無信箱的補簽仍更新文件期限與資格。

worker 在 claim/send/finish 全部依 signerType 分支。內部沿文件／簽署人狀態、log supersede 與 lease 檢查，不依賴 invitation expiry/generation；外部照舊。每日一次催簽沿既有 policy，補簽使舊未完成通知失效；舊工作不可在完成時覆蓋新 log。SMTP 已在途中無法撤回，沿現有 unknown/retry 語意處理，不宣稱 exactly-once。

## BCC 群寄、部分結果與重試

- 群組限定同一文件、同一次邀請／催簽／補簽 batch，不能跨文件、跨批次或與外部合併。只寄本批實際選取且仍合格的人；不另等待湊滿，不新增排程。
- 每封最多 **50 個不同 BCC 地址**，以既有 Email 正規化值去重並穩定排序，超過拆批。這是本次保守實作上限，不是聲稱服務商固定上限。只有一位或重試只剩一位仍可寄。群寄不改變每日收件人配額，不新增配額繞過。
- 所有實際收件人只放 BCC／SMTP envelope，不放 To 或 CC；可省略 To/CC。驗證實際 MIME 不含 BCC 名單，禁止 keepBcc；不額外把寄件人加入 envelope。共用 Email 一次投遞映射回多個獨立 signer/log。
- producer 在現有 queue 對內部送 `{notificationBatchId}` 工作，同批 dedup；外部維持 `{notificationLogId}`。maintenance 必須使用相同分流。worker 接到歷史內部單人工作時，先轉為所屬批次選取，不能繼續逐人 SMTP。
- 每次領取在既有 DB 交易中鎖文件及批次，選擇可寄送的地址群組，連同其全部合格 log 設共同 lease；鎖內排除 processing/delivered/unknown/skipped、超次數及未到重試時間者。SMTP 在交易外執行，finish 以各 log 相同 lease 條件更新；後續工作領取下一組，不重領已處理地址。併發 workers 不可把同地址拆為重複信件。
- `accepted` 僅在整個 send 成功結束且該地址被受理時映射 delivered；有些地址 rejected 不得把整封視為成功。未對應到本批的地址忽略並列內部協定異常，缺結果者 unknown；mail adapter 不把原始 SMTP 錯誤／地址名單寫 log。
- 明確暫時拒收或確定整封未送出者才重試；內部群寄沿用現有催簽的有限策略：每個 log 最多 3 次（含首次），失敗後 30 秒、60 秒再次符合候選，由既有 maintenance 觸發，不承諾精準時刻。下一次可將本批剩餘失敗地址再合併；永久拒收停止自動重試。已 accepted 的地址不可隨其他失敗者再寄。外部原策略不變。
- DATA 後斷線、SMTP 已成功但落庫失敗、worker 中斷留下 stale processing，均保守 unknown，不自動回 pending。維護工作恢復狀態而非盲目再寄。人工再次催簽仍須遵守既有每日限制，不新增重送介面。
- 本次不新增通知 schema、供應商回執服務或新的計時工作；沿用 batch/log/lease/attemptHistory。記錄仍是逐人結果，畫面不得將人次稱為寄出封數。

設計依據：Nodemailer 的[寄送回應](https://nodemailer.com/)包含 accepted/rejected，部分受理仍可能視為送出成功；[訊息欄位](https://nodemailer.com/message)支援 BCC。實作須測試專案已安裝版本的實際回傳形狀，不依賴原 `Promise<void>` 推定所有地址成功。

## 舊內部邀請與 OTP

所有 `assertExternalAccess`、external principal、簽署／拒簽查重與檔案存取必須只允許外部指派，即使 cookie 仍在 Redis 也不能操作內部任務。不批次刪除歷史 token 或證據。

邀請 GET 維持既有不查資料、不寄碼、不建立 session 的確認頁。POST 開啟／寄 OTP 時，若 token 對應尚存在的內部指派，回 303 到固定 Portal 登入網址，不寄 OTP、不設定 external cookie，也不揭露文件。無效 token 維持原通用失效行為。

已存在內部 OTP cookie 呼叫 task API，回 403 `ESIGN_INTERNAL_LOGIN_REQUIRED` 與固定、安全的 `portalLoginUrl`（新增穩定錯誤碼及 client 對應），顯示「請登入入口網，至我的電子簽完成操作」按鈕。原檔／副本 API 回錯誤而非 PDF 或登入 HTML；簽署、拒簽與重送也拒絕。外部 cookie、邀請、完成後下載與拒簽重送保持原行為。

## 部署順序（實作後由交付流程執行）

1. Portal 先交付 redirect_to、登入／改密碼接續與登出清理，驗證一般登入未變。正式 Portal 尚未具備參數時，不宣稱電子簽通知旅程完成。
2. 暫停受影響通知派送與內部寫入入口，等待舊 worker 在途租約結束或依既有復原機制處理；不刪 queue/log。
3. 同一相容版本更新 HTTP、client、worker。舊內部通知由新 worker 按 user 分支改寄 Portal，外部照原 token 世代；superseded／完成者略過。
4. 驗證後恢復派送及操作。保留每版 artifact 與必要恢復紀錄；沒有 DB migration。

若回退：保留所有新指派、不可變證據及通知結果。舊版不能操作無 Email 指派，也會恢復 OTP 授權，故不可任意只退其中一個服務；先停止受影響流程，再協調整版回退或修正前進，不改寫新證據以迎合舊版。

## 環境驗收限制

電子簽 UAT 寄信也導正式 Portal，其後所見文件來自正式 Portal 實際接的電子簽環境。本次不保留來源環境、不傳 UAT 回跳、不同步 DB；兩邊同一員工登入不代表文件相同。驗收區分 URL 指向正確、UAT API 正確與 Portal 對應環境端到端三種證據。

## 本次可執行交付清單（尚未執行部署）

交付程式：電子簽 `5abefa1`（後續文件 commit 不改 runtime）、Portal `961ed6a8`。Portal 原 `master/index.php` 本機修改保留，交付取整合分支，不覆蓋該工作區。無新 migration、環境變數或套件；新增的 Portal 非機密設定為 `application/config/login_redirect.php`。

### 1. 先交付 Portal

以同一版本交付 Login、Account、WebController、modify_password view、Login_redirect library 及 login_redirect config。沿既有部署方式保留服務的機密設定與選單權限。部署 PHP 版本需先驗證下列檢查，再以合成帳號實測登入／改密碼／登出及目的頁權限：

```bash
php tests/login_redirect_test.php
php tests/login_redirect_controller_test.php
php -l application/libraries/Login_redirect.php
php -l application/config/login_redirect.php
php -l application/controllers/Login.php
php -l application/controllers/Account.php
php -l application/core/WebController.php
php -l application/views/admin/account/modify_password.php
```

確認正式 Portal 可接 `login?redirect_to=hr/esign/mine`；記錄實際 iframe origin。電子簽 UAT 與 PRD 的信都走此正式入口，不以改 Portal 所接環境或複製文件當作驗收。

### 2. 維持維護窗口並停下舊應用

由既有運維流程先限制入口流量／業務寫入；此 CR 沒有新增維護開關。保留現行 images、release manifest、Redis queue、通知 log 與檔案。既有 UAT workflow 在沒有 pending migration 時可能直接更新服務，**本次不可略過協調停機**，也不可因 smoke 成功就解除維護窗口。

下列只適用 repository 已記錄的 UAT Compose，在部署主機的正確 checkout 執行；PRD 需由其既有部署負責人對應相同三服務順序，不臆測主機或服務名稱。先載入只含版本資訊的現行 manifest（不可 source migration.env）：

```bash
set -a
. /home/feasteng/deploy/intranet-uat/releases/current.env
set +a
docker compose --env-file /dev/null -f docker-compose.uat.yml ps
docker compose --env-file /dev/null -f docker-compose.uat.yml stop -t 360 worker client server
```

給舊 worker 在途工作正常結束的時間；若超時中斷，保留 processing 租約。只讀核對通知狀態與停機時間，不把 processing／unknown 改為 pending、不刪 queue/log。新版會將超過 5 分鐘的 processing 保守轉 unknown；DATA 後斷線或寄出後落庫失敗不能證明未寄出，禁止整批補寄。

### 3. 同版啟動與驗收

依既有發佈流程取得已核准的 CLIENT_IMAGE／SERVER_IMAGE digest，明確設為候選版本；server 與 worker 必須使用同一 SERVER_IMAGE。機密環境檔維持原位置，不輸出完整 compose config。無本 CR migration，但仍依既有流程核對整個 release 是否另有 migration。

```bash
: "${CLIENT_IMAGE:?請先設定已核准的候選 client digest}"
: "${SERVER_IMAGE:?請先設定已核准的候選 server digest}"
docker compose --env-file /dev/null -f docker-compose.uat.yml pull client server worker
docker compose --env-file /dev/null -f docker-compose.uat.yml up -d --no-deps --wait --wait-timeout 180 server
docker compose --env-file /dev/null -f docker-compose.uat.yml up -d --no-deps client
```

在維護窗口內，先以合成帳號驗證本人 API／UI 與舊內部憑證 403，再啟動同版 worker：

```bash
docker compose --env-file /dev/null -f docker-compose.uat.yml up -d --no-deps worker
docker compose --env-file /dev/null -f docker-compose.uat.yml ps
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/api/health
```

以合成文件確認內部 BCC、外部逐人 OTP、無信箱 skipped、部分結果與未知結果不重寄；核對歷史單 log 工作會走內部 batch，逐人結果仍可追查。完成 T011／T045 的實際旅程、記錄版本與資料環境，才依運維流程解除維護窗口。health/smoke 並非業務驗收。

### 4. 失敗與回退界線

若失敗，維持入口限制並停止受影響的 client/server/worker，保留新指派、簽章、PDF、manifest、queue 與逐人 log；優先修正前進。舊版本不能正確處理無信箱指派，且會恢復內部 OTP 授權，因此不可只回退 HTTP 或 worker，也不可把新證據改寫成舊 authenticationMethod。

既有 UAT script 的「無 migration 自動回復舊 images」只代表一般部署機制；若發生，仍須立即保持停派送／維護窗口，不能視為本 CR 已安全回退或自動開放流量。整版回退須先核對是否已有新指派／新通知格式與簽署，再由部署負責人決定；不得刪除資料以迎合舊版。詳細既有流程見 `docs/deployment/uat-cicd.md`。本次只交付方案，未執行以上主機命令。
