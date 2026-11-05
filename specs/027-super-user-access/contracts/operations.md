# 設定、REPL、worker 與部署契約

以下介面已由 027 實作，027-08 依實作校正。本文件是契約，不是執行紀錄；部署與維運步驟見 [UAT CI/CD 操作文件](../../../docs/deployment/uat-cicd.md)「Super user 維護登入」。

## 設定與密碼雜湊

新增兩個 server-only 設定：`SUPER_USER_ACCOUNT`、`SUPER_USER_PASSWORD_HASH`。兩者在 HTTP／維護 worker／REPL 啟動時驗格式；缺漏即啟動錯誤，不記值。`client` 不接收、不建立 NEXT_PUBLIC 版本。原有 WEBVIEW_JWT_*、WEBVIEW_LAUNCH_ORIGIN、AUTH_TRUSTED_ORIGINS／CORS_ORIGIN 繼續沿用。

密碼格式固定 `scrypt:32768:8:1:<salt-base64url>:<derived-key-base64url>`，salt16bytes、derived64bytes，maxmem64MiB；只接受固定參數與正規base64url長度，避免受設定注入巨大KDF成本。使用非同步crypto.scrypt並限制登入輸入1024 UTF-8 bytes；帳號及密碼不trim。固定長度derived key採timingSafeEqual。帳號不符也執行同一次KDF，最後統一401。

提供 `pnpm -s -C server super-user:hash-password`（`-s` 讓 stdout 只有 hash；runtime image 沒有 pnpm，改用 `node dist/console/hash-super-user-password.js`），從TTY無回顯讀密碼及確認，不接受命令列password參數、不寫shell／REPL history，只輸出可填入設定的hash；只用本機crypto，不連DB、不載Nest。密碼強度由保管者管理；不在文件放可用帳密。

fingerprint固定為 SHA-256(`super-user-credentials-v1` + NUL + UTF-8 JSON.stringify([account, encodedPasswordHash]))。相同hash重啟不變；同密碼重建新salt也視為輪換。generation是DB單調版本，重新啟用先前設定仍增加版本，不能復活先前session。

## REPL 契約

啟動 `pnpm -C server repl:dev`（本機）或建置後 `pnpm -C server repl`；runtime image 沒有 pnpm，容器內用 `node dist/console/repl.js`（需要 TTY）。一次輸入一行：多行貼上時 REPL 不等前一行的 await 完成就執行下一行。使用相同 Node import conditions／env loading 模式，無HTTP listen、無worker、無自動初始化。只暴露 `auth` helpers；不暴露DataSource、裸query、任意repository。REPL有執行環境權限，本身不是沙箱；限制helpers的目的在避免正常維運繞過業務規則。

| 操作 | 讀寫／結果 |
|---|---|
| `await auth.initialize()` | 首次寫singleton、generation=1、entry初始化與credentials啟用事件，回 `{initialized:true}`；已存在回 `{initialized:false}`，不覆寫 |
| `await auth.currentEntry()` | 唯讀，回 `{path,entryGeneration,rotatedAt,nextScheduledAt}`；path為目前 `/ops-access/...`，不猜測origin、不新增origin設定；未初始化回503 `AUTH_SUPER_USER_UNAVAILABLE` |
| `await auth.credentialStatus()` | 唯讀，回 `{generation,localConfigMatches,activatedAt}`；不回帳號、hash、fingerprint；未初始化回503 `AUTH_SUPER_USER_UNAVAILABLE` |
| `await auth.activateCredentials({expectedGeneration})` | CAS啟用本機env，generation+1並撤舊維護會話，回 `{activated:true}`；相同fingerprint回 `{activated:false}`、不寫入；期望值不符回409 `AUTH_SUPER_USER_GENERATION_CONFLICT`，不可無條件強制。只寫一筆 `credentials.activated`，被撤銷的會話不逐筆寫 `session.revoked`（由 `revoked_at` 與 generation 追查） |
| `await auth.rotateEntryIfDue()` | 明確寫入，與worker同service；回 `{status:'rotated',entryGeneration}`／`{status:'not_due'}`／`{status:'uninitialized'}`；未到期no-op，沒有任意時間強制換網址的新需求 |
| `await auth.securityEvents({limit,beforeId})` | 唯讀，limit預設20最大100，倒序cursor；只回安全事件白名單，無入口／憑證 |

不提供讓人直接輸入或列出session token的helper。查詢不可隱式initialize。write helpers以actor_kind=operator、source語意由event type／執行管道記錄；不得偽造成員工。REPL history不保存，且不在畫面自動列出當前入口；只有currentEntry明確回傳。結束時關閉DB連線。

## worker 契約

新增queue `auth-access-maintenance`，scheduler id `super-user-entry-weekly`，job `rotate-entry-if-due`，cron `0 4 * * 1`／Asia/Taipei。只有WorkerModule註冊；同固定ID upsert。startup先檢查DB catch-up，再保留既有overdue job或upsert下一週期；任一組合都由singleton週期鎖裁決。Redis丟失排程不會失去DB週期。

Job不帶entryKey或帳密，僅空payload；attempts=3，exponential backoff初始5000ms，保留最近100筆成功／失敗metadata。失敗保留原入口並記白名單故障；重試仍以目前週期處理，不重複生成已commit週期。不另增加掃描排程。未初始化回明確未初始化結果且不創建身分；DB不可用讓job失敗。

027-06 實作：startup補做直接執行與job相同的processor，補做失敗只記 `auth.entry_rotation_failed`，worker照常啟動並註冊排程，等下次排程或REPL `rotateEntryIfDue()` 補做（使用者決定）。worker 跑起來不代表輪換成功，部署後要檢查這兩個 log。job回傳值與REPL `rotateEntryIfDue` 相同：`{status:'rotated',entryGeneration}`、`{status:'not_due'}` 或 `{status:'uninitialized'}`（另記 `auth.entry_rotation_uninitialized` 警告）。失敗原因固定為「維護入口輪換失敗（<錯誤代碼>）」，log `auth.entry_rotation_failed` 只帶錯誤代碼，不含原始DB訊息或SQL。

每台worker以自己的時鐘判斷到期，主機需NTP。3次重試（約5＋10秒）都失敗後等下次排程或worker重啟；需要立即補做用REPL `rotateEntryIfDue()`，不用BullMQ `promote()`：promote後BullMQ從原排定時間計算下一次，等於跳過一週。

## 明確生效與部署順序

首次：準備兩設定 → 停止舊HTTP／worker並備份 → 套增量migration → 新REPL initialize → 新HTTP／worker → REPL查入口與身分驗證 → 開流量。Nginx／ALB 完整入口 URL 遮罩完成前不得 initialize（部署阻擋）。UAT 自動部署在 migration 與啟動之間不暫停，改為部署成功後才 initialize 與登入驗證；期間員工照常使用，維護登入回503。Portal／OAuth設定維持，移除員工密碼登入依賴，但不得誤刪其他仍用到的上游HTTP client。

換帳密：新env與程式部署準備好 → 在新設定的REPL讀credentialStatus → activateCredentials(expectedGeneration) commit，此刻即生效 → 舊維護session失效、舊配置實例無法接受維護登入 → 完成所有HTTP／worker設定更新並重啟、每個實例 `credentialStatus()` 都是 `localConfigMatches:true`、實際入口登入成功 → 宣告完成。未啟用的新實例維護登入回503，employee仍可服務；混跑期間維護操作可能503，不能宣稱零中斷維護登入。

不允許各實例開機自動activate，防止舊機回滾active fingerprint。若需回復舊env，亦需明確activate成更高generation，不復活舊session。

與帳密啟用不同，每週入口輪換不改credentialGeneration、不撤session，也不需部署。DB rotation commit是舊網址失效時點，排程負載延遲要可觀測但不回填多個歷史網址。

## 邊界與依賴

027只完成可辨識操作者；028之前維護者碰員工業務會403 `AUTH_ACTOR_NOT_ALLOWED`（登入後經 `/` 轉到 `/esign/forms` 看到業務403、會話過期對話框仍是員工版文案），不為展示首頁而塞假員工。員工帳密登入已移除；回退或修復不得重新開放，`1793836802000-SuperUserAccess` 的 down 在已有安全事件、入口或 Super user 會話時拒絕，正式資料採修正後重新部署。安全事件是低頻登入／維護記錄，與026移除的簽署時間軸無關。全部指令的成功輸出不可包括未指定的secret，真實環境只由獲授權維護者執行。
