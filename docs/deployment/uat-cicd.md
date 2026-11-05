# 電子簽 UAT CI/CD

沿用 CKS 的 self-hosted GitHub Actions + GHCR + Compose 模式。`uat` push（包含 PR merge）或在 `uat` 手動觸發，會部署精確 commit；一般 lint／unit tests／build 品質檢查留在本機 hooks。部署執行結果可在 Actions 查看。

## 本機品質檢查

`pnpm install` 的 prepare 設定此 checkout 的 `core.hooksPath=.githooks`，也可執行 `pnpm hooks:install`。

- pre-commit、pre-merge-commit：前後端 lint、後端 unit tests。
- pre-push：前後端 build。
- `pnpm test:deploy`：實際解析 Compose（需要 Docker Compose CLI，不需連線 Docker daemon），以假設定驗證 RDS／raw 密碼／TLS，並以替身測試部署失敗分支。

hooks 不修改 staged 檔案、不自動 format；檢查 working tree。GitHub 網頁 merge 不執行本機 hooks，fast-forward／rebase 也不觸發 pre-merge-commit。hooks 可以略過，應搭配團隊 review／分支保護。E2E 依 server 文件在隔離測試資料庫執行，不對 UAT 跑測試。

## 已驗證的 UAT 架構

- EC2：`10.52.101.46`，runner 使用 `feasteng` Linux 帳號；專用 label `intranet-uat`。
- Compose project：`intranet-uat`，配置位於 root `docker-compose.uat.yml`。
- RDS writer endpoint：`ftg2-00-test-rds-cluster.cluster-cheguogu8mzk.ap-east-2.rds.amazonaws.com:3306`。
- Database：`intranet_uat`，Aurora MySQL 8.4.7。依 SRE 指示，應用程式與 migration 都使用 RDS `feasteng` 帳號；與同名 Linux 帳號的密碼無關。
- 2026-10-23 已使用 `5ec6cef` 執行 12 個 migrations；server／worker 接上 RDS，API 健康檢查成功，舊本機 MySQL 已停止。
- Redis、server／worker 共用的簽署檔案仍在 EC2。沿用 external volumes `intranet-uat_redis-data`、`intranet-uat_esign-data` 及 external network `intranet-uat_default`；不存在就停止，不建立空替代環境。
- 前端發布 `127.0.0.1:3000`，既有 Nginx 8080／ALB 路由不由 workflow 修改。
- Compose 不包含 MySQL server、不依賴舊 mysql volume 或 root 密碼，也不刪除舊容器／volume。`db-backup` 是 tools profile 的一次性 MySQL client，不啟動資料庫。

## 主機環境檔與 TLS

固定部署目錄為 `/home/feasteng/deploy/intranet-uat`，目錄權限 700，以下兩份機密檔案權限 600，不提交 Git：

1. `server.env`：SMTP、Portal 唯讀連線（`PORTAL_MYSQL_*`）、WebView 公鑰、HTTPS origins、邀請加密金鑰與 Super user 帳密（`SUPER_USER_*`，見「Super user 維護登入」），欄位與 Portal 帳號所需權限見 `server/.env.example`。
2. `migration.env`：沿用這次手動 RDS 切換成功的檔案，現在由 server、worker、migration 及備份共用資料庫連線設定。包含 `DB_MYSQL_HOST`、`DB_MYSQL_PORT`、`DB_MYSQL_DB`、`DB_MYSQL_USER`、`DB_MYSQL_PASS`、`DB_MYSQL_SSL_CA_B64`；不要放 SMTP 等非資料庫設定。

Compose 先讀 server.env，再以 `format: raw` 讀 migration.env 覆蓋 DB 設定，保留密碼中的 `$`／`#`。後者密碼不加引號；若加引號，引號會成為密碼的一部分。不得再加入 Compose environment 的本機 MySQL 覆寫。需要 Docker Compose 2.30.0 以上；目前 UAT 是 2.40.3。

`DB_MYSQL_SSL_CA_B64` 使用台北區域 RDS CA bundle 的單行 base64：

```text
https://truststore.pki.rds.amazonaws.com/ap-east-2/ap-east-2-bundle.pem
```

不要改用全球 bundle 填入環境變數：全球檔案轉 base64 超過 Docker env-file 單行限制，已實測會出現 `bufio.Scanner: token too long`。每個 key 只保留一行。應用使用 mysql2 的 CA 驗證；備份要求 `VERIFY_IDENTITY`。部署檢查會拒絕非指定 RDS endpoint／非 intranet_uat／未提供 CA／停用憑證驗證。

原本 `.env` 中的本機 MySQL 密碼不再被此 workflow 使用。Compose CLI 明確使用 `--env-file /dev/null`，只從 workflow 傳入 CLIENT_IMAGE／SERVER_IMAGE，避免意外讀到 checkout 的 `.env`。不要 source 含 raw 密碼的 migration.env，也不要貼完整 `docker compose config` 輸出。

## 第一次啟用（主機管理員）

1. 合併 PR 到 `dev` 後，將變更帶到 `uat`。首次部署前既有 client/server/worker 必須存在，Redis 必須 healthy；RDS migrations 已成功初始化。舊 MySQL 可以保持停止，不需為部署啟動它。
2. GitHub Settings → Environments 建立 `uat`，deployment branch 限定 `uat`；依團隊規範配置分支保護。workflow 不接受其他 ref 的手動部署。
3. Settings → Actions → Runners → New self-hosted runner，選 Linux x64；依 GitHub 當下提供的下載／驗證／註冊指令，在此 EC2 的 `/home/feasteng/actions-runner-intranet` 安裝此 repository 專用 runner，加入 label `intranet-uat`。註冊 token 不進 Git 或聊天。
4. 在 runner 目錄使用 `sudo ./svc.sh install feasteng`、`sudo ./svc.sh start` 安裝系統服務。runner 能讀 UAT 機密且能操作 Docker，不執行不受信任的 PR 程式。
5. 管理員執行 `sudo usermod -aG docker feasteng` 後重新啟動 runner service，使 runner 可直接操作 Docker。Docker 群組等同主機 root 能力，僅授予部署帳號。確認 runner 可讀 env 並寫入部署目錄。
6. 主機需 bash、git、Docker Compose、curl、gzip、flock；不用安裝 Node/pnpm，建置在 Docker 內執行。網路需可存取 GitHub Actions、GHCR、Docker Hub、pnpm registry，以及 VPC 內的 RDS 3306。
7. GHCR 使用短期 GITHUB_TOKEN，`contents: read`、`packages: write`。若組織限制建立 package 或同名 package 已存在，授權本 repo 存取兩個 package；維持 private 並確認儲存／流量配額。
8. Actions 手動選 `uat` 執行第一次部署，確認建置、migration 檢查、smoke、摘要成功，再驗收 HTTPS 登入、上傳、寄信、簽署及匯出。

## 每次部署與備份

1. 依序 build server/client，context 為 workspace root，前端 build 使用 `API_PROXY_TARGET=http://server:3000`，同一個值也寫入 client runtime image，供員工頁面在伺服器端確認 session。
2. 推送 GHCR 的 SHA tag，取得 digest；migration、server、worker 使用同一份 server digest。
3. GitHub concurrency 與主機 flock 防止部署互撞。檢查既有 Redis／檔案 volumes／網路，不啟停舊 MySQL、不重啟 Redis。
4. 使用候選 server image 檢查 RDS 目標、CA、連線及 pending migrations。連線／程式錯誤直接停止，不誤認為 pending。
5. 無 pending 就略過備份。有 pending 時先拉取 `mysql:8.4` 工具 image，再停止 client/server/worker。一次性 `db-backup` 容器以同一組 raw RDS 帳密與 CA，對 `intranet_uat` 做加密連線的邏輯備份，gzip 完成後才執行 TypeORM migrations。
6. 備份包含表、資料與 triggers；本專案沒有 stored routines／events，這些不在 dump 範圍。只備份 intranet_uat，不接觸帳號另外可存取的 oauth_uat。這是 schema 級備份，不呼叫 AWS snapshot，也不需要新增 AWS IAM 權限。
7. server 更新後等待 HTTP healthy；worker/client 啟動後透過前端代理 `/api/health` 檢查服務，並檢查 worker 啟動訊息及 restart count。首頁未登入時預期回傳 404，不作為健康依據。worker 不使用 HTTP `--wait`。smoke 不等於完整業務驗收。
8. 記錄 `releases/current.env`、`previous.env`、`before-last-deploy.env`。不自動 prune 或刪除 volumes。

2 核／8 GB EC2 的建置與服務共用資源，migration 有停機窗口，不宣稱零停機。

## Super user 維護登入（Spec 027）

唯一的 Super user 從隱藏入口 `/ops-access/<入口>` 以專用帳密登入，供員工登入上游不可用時維護。入口存在 DB，只能用 REPL 查詢，每週一台北 04:00 由 worker 輪換。入口原值、帳號、密碼與 hash 不寫進 Git、ticket、PR、聊天或 log；本節只用 `<入口>`、`<generation>` 等佔位。

**部署阻擋：** 下一節的 Nginx／ALB log 遮罩確認前，不得在 UAT／正式環境執行 `initialize()` 或提供入口。

### 設定

- `server.env` 新增兩項 server-only 設定；client 不需要，也不建立 `NEXT_PUBLIC_*` 版本。
  - `SUPER_USER_ACCOUNT`：原樣比對，不 trim／normalize。server.env 不是 raw 格式，Compose 會解析 `$`、引號與 `#` 註解，帳號避開這些字元與前後空白。
  - `SUPER_USER_PASSWORD_HASH`：維護者在自己的互動式終端機執行 `pnpm -s -C server super-user:hash-password`，輸入兩次密碼（不回顯），stdout 只有 hash；`-s` 讓 pnpm 不多印指令行。工具不連 DB、不讀 `.env`。沒有 checkout 時可用 `docker run --rm -it <server image> node dist/console/hash-super-user-password.js`。
- HTTP、worker 與 REPL 啟動時都驗證這兩項；缺漏或格式錯誤時 server healthcheck 失敗，worker 因 `restart: unless-stopped` 反覆重啟，錯誤訊息只有變數名。UAT 的 server 與 worker 共用 server.env（`x-backend`），**推送含 027 的版本前就要寫入**：027 帶 migration，migration 開始後的啟動失敗會讓部署腳本停止全部服務、交人工處理。
- `FEASTOGETHER_*`（`19633f8` 移除）與 `DEVMOD`（027-05 移除）已沒有程式讀取，server.env 殘留不影響開機，可以刪除。

### 在容器內執行 REPL

runtime image 沒有 pnpm，`pnpm -C server repl` 不能用，改用 `node dist/console/repl.js`。在 repository checkout 依「人工操作」載入 `releases/current.env` 後：

```bash
# 新容器：讀主機 server.env＋migration.env，不需要 server 正在執行
docker compose --env-file /dev/null -f docker-compose.uat.yml run --rm --no-deps server node dist/console/repl.js
# 進入執行中的容器：使用該容器啟動時的設定，用來確認各實例的設定是否生效
docker compose --env-file /dev/null -f docker-compose.uat.yml exec server node dist/console/repl.js
docker compose --env-file /dev/null -f docker-compose.uat.yml exec worker node dist/console/repl.js
```

- 不加 `-T`：REPL 需要 TTY。
- REPL 只載入設定、logging 與 MySQL，不啟動 HTTP、queue consumer、Portal、mail 或 storage，也不寫 history。查詢 helper 不寫 DB；會寫入的只有 `initialize`、`rotateEntryIfDue`、`activateCredentials`。
- 一次輸入一行，等結果出來再輸入下一行。一次貼上多行時，REPL 不等前一行的 `await` 完成就執行下一行，`.exit` 可能在查詢完成前關閉連線。
- `.exit` 結束並關閉 DB 連線。

| 指令 | 用途 |
| --- | --- |
| `await auth.initialize()` | 首次建立入口與第 1 版帳密；已初始化回 `{ initialized: false }`，不覆寫 |
| `await auth.currentEntry()` | 唯一揭露入口的管道：`{ path, entryGeneration, rotatedAt, nextScheduledAt }`；`nextScheduledAt` 早於現在表示輪換逾期 |
| `await auth.credentialStatus()` | `{ generation, localConfigMatches, activatedAt }`；不回帳號、hash 或 fingerprint |
| `await auth.rotateEntryIfDue()` | 到期才輪換，與 worker 同一個判斷；回 `rotated`／`not_due`／`uninitialized` |
| `await auth.activateCredentials({ expectedGeneration })` | 把本機設定啟用為新帳密版本，見「換帳密與回復舊設定」 |
| `await auth.securityEvents({ limit, beforeId })` | 安全事件倒序；`limit` 預設 20、最大 100 |

### 首次部署

依 [operations 契約](../../specs/027-super-user-access/contracts/operations.md) 的順序：

1. 主機管理員完成下一節的 Nginx／ALB 遮罩；`server.env` 寫入兩項設定。
2. 停止舊 HTTP／worker 並備份。
3. 套用 migration（`1793836802000-SuperUserAccess`）。
4. 以新版 image 的 REPL 執行 `await auth.initialize()`。
5. 啟動新版 HTTP／worker。
6. REPL `await auth.credentialStatus()` 應為 `localConfigMatches: true`；`await auth.currentEntry()` 取得 path，在瀏覽器直接開啟「HTTPS 前端 origin＋path」（不放 iframe）並登入。看到「目前身分：Super user」後登出。登入後經 `/` 轉到 `/esign/forms` 並顯示「目前身分無法使用此功能」是 028 之前的預期結果。
7. 開流量。

UAT 由 workflow 自動執行 2、3、5：有 pending migration 時依序停止服務、備份、migration、啟動新版並 smoke，中間不停下來讓人執行 REPL。所以 UAT 在部署成功後才做 4 與 6：

- 部署成功到 `initialize()` 之前，員工照常使用；維護登入回 503（`AUTH_SUPER_USER_UNAVAILABLE`），worker 啟動時記 `auth.entry_rotation_uninitialized` 警告。
- `initialize()` 會把當週記為已處理，不必重啟 worker。
- 部署阻擋未解除時停在部署成功，不執行 `initialize()`。

### 部署後檢查 worker 輪換

smoke 只確認 worker 啟動且沒有重啟。啟動時的補做輪換失敗只記 log，worker 照常啟動（不擋電子簽與 Portal processor），所以 worker 起得來不代表輪換成功。每次部署後都要看：

```bash
docker compose --env-file /dev/null -f docker-compose.uat.yml logs worker | grep -E 'auth\.entry_rotation_(failed|uninitialized)'
```

- `auth.entry_rotation_failed`：補做失敗，舊入口照常有效，log 只帶錯誤代碼。排除原因後以 REPL `await auth.rotateEntryIfDue()` 補做。
- `auth.entry_rotation_uninitialized`：尚未 `initialize()`。

### 每週輪換

- worker 每週一台北 04:00 換新入口。舊入口立即 404，包括已開啟的表單；既有 Super user 會話不受影響。多個 worker、job 重試與停機多週都由 DB 已處理週期裁決，每週最多換一次；停機錯過時，worker 下次啟動補做一次。
- 每台 worker 以自己的時鐘判斷到期，主機需要 NTP 對時。
- job 重試 3 次（約 5＋10 秒）仍失敗就不再自動嘗試，要等下次排程或 worker 重啟補做。需要立即補做時用 REPL `await auth.rotateEntryIfDue()`。不要用 BullMQ `promote()` 提前執行排程 job：BullMQ 會從原排定時間計算下一次，等於跳過一週。
- 觀測：`securityEvents()` 的 `entry.rotated`（actor `system` 是 worker、`operator` 是 REPL）、`currentEntry()` 的 `nextScheduledAt`；Redis 保留最近 100 筆成功／失敗 job。
- 沒有任意時間強制換網址的 helper。

### 換帳密與回復舊設定

生效點是 `activateCredentials` 的交易 commit：DB 啟用版本換成執行 REPL 那份設定、generation 加 1、全部有效的維護會話撤銷，並寫一筆 `credentials.activated`。被撤銷的會話不逐筆寫 `session.revoked`，可由 `revoked_at` 與 generation 追查。任何實例開機都不會改寫 DB 版本。

1. 產生新 hash（帳號也可一起換）並寫入 server.env。執行中的容器在 recreate 前仍是舊設定。
2. 以 `run --rm --no-deps server node dist/console/repl.js`（讀新 server.env）執行 `await auth.credentialStatus()`，應為 `localConfigMatches: false`；記下 `generation`。
3. `await auth.activateCredentials({ expectedGeneration: <generation> })`，應回 `{ activated: true }`。回 409 `AUTH_SUPER_USER_GENERATION_CONFLICT` 表示版本已被變更，重查 `credentialStatus()`；設定與 DB 相同時回 `{ activated: false }`，不寫入。
4. 依「人工操作」recreate server 與 worker。
5. 完成條件：所有 HTTP 與 worker 都換成新設定並重啟；對每個執行中的實例用 `exec … node dist/console/repl.js` 執行 `credentialStatus()`，都是 `localConfigMatches: true`；並在實際入口完成一次登入。只更新部分實例不算完成。

commit 之後、全部實例重啟之前：舊設定實例的維護登入與新維護會話都回 503，已換新設定的實例正常，員工會話不受影響。多實例混跑時維護操作會間歇 503，不能寫成零中斷。

回復舊設定走同一流程：把舊值放回 server.env，以舊設定的 REPL 明確執行 `activateCredentials`，generation 會再加 1，先前的會話不會復活。只把 server.env 改回去重啟而不 activate，維護登入會一直回 503。

### 身分邊界（Spec 028 之前）

- Super user 只能讀取目前身分與登出（`GET`／`DELETE /api/auth/session`）；其他需要會話的 API 回 403 `AUTH_ACTOR_NOT_ALLOWED`。登入後經 `/` 轉到 `/esign/forms` 並顯示「目前身分無法使用此功能」，會話過期對話框仍是員工版文案；028 接入業務授權前維持現狀。
- 員工只能經 OAuth 或主平台 WebView 登入；一般員工帳密登入與開發替代入口已移除，舊路徑回 404。

### 回退

- 不用 027 之前的 image 回退：舊版會重新開放已移除的員工帳密登入，也不支援新 schema 的會話規則。
- `1793836802000-SuperUserAccess` 的 down 在有安全事件、入口或 Super user 會話時拒絕；部署後任何員工登入都會寫 `login.succeeded`，所以正式資料不能靠 `migration:revert` 回復。
- 需要回復時，修正後重新部署，或部署另一個含 027 的版本；資料庫還原依「失敗處理與保留」，先由 SRE 確認。

## Super user 隱藏入口的 log 遮罩（Spec 027，部署阻擋）

**狀態：未解除。** 主機管理員／SRE 完成下列倉庫外設定並留下驗證證據前，027 不能宣稱可正式交付。

隱藏維護入口的網址本身就是存取條件：前端 `/ops-access/<入口>`，後端 `/api/auth/super-user-entries/<入口>`、`/api/auth/super-user-entries/<入口>/sessions`（POST body 含帳密）。完整入口、query、body、Referer、Set-Cookie 不得出現在一般 log。

倉庫內已處理（027-04）：

- Nest：access log 的 `path`／`url` 只記 `/api/auth/super-user-entries/:entryKey[/sessions]`，不記 query 與 body；入口無效、限流（429）、限流儲存不可用的安全 log 與未預期例外 log 只含遮罩後的路由模板或不含路徑。
- Next：正式環境（standalone `server.js`）本來就不記 incoming request；開發模式以 `next.config.ts` 的 `logging.incomingRequests.ignore` 略過這兩組路徑。proxy／頁面檢查失敗的錯誤訊息只含 HTTP 狀態，不含網址。
- 維護頁回應帶 `Referrer-Policy: no-referrer`，瀏覽器送出登入請求時不帶含入口的 Referer。

倉庫外尚未處理：Nginx 8080／ALB 不由此 repository 管理，預設 access log 會記錄完整 request line。**在主機管理員確認以下設定前，不得在 UAT／正式環境初始化或提供隱藏入口：**

- Nginx 對這兩組路徑關閉 access log（或改用不含 `$request`／`$request_uri`／`$http_referer` 的 log_format）。示意（實際 upstream 依主機既有設定，未在 UAT 主機驗證）：

  ```nginx
  location ^~ /ops-access/ {
      access_log off;
      proxy_pass http://127.0.0.1:3000;
  }
  location ^~ /api/auth/super-user-entries/ {
      access_log off;
      proxy_pass http://127.0.0.1:3000;
  }
  ```

  Nginx error log 遇到 upstream 錯誤時也會帶 request line；確認 error log 的保存與存取權限，或對這兩個 location 另設 error_log。
- ALB 若啟用 access logs（寫入 S3），會記錄完整 URL 且無法逐路徑遮罩；需確認是否啟用、保存期限與存取權限，或由 SRE 決定關閉。
- 本機驗證以 `http://localhost:3010` 前端呼叫後端，需把該 origin 加進 `server/.env` 的 `AUTH_TRUSTED_ORIGINS`；部署環境沿用 `server.env` 既有的 HTTPS 前端 origin，不需新增。

## 失敗處理與保留

- build／migration 檢查失敗：不更新服務。
- 備份工具拉取失敗：不停止服務；備份失敗：不執行 migration，嘗試恢復舊映像。
- 未執行 migration 的應用更新失敗：嘗試回復部署前 images 並 smoke，workflow 仍失敗。
- migration 一旦開始，之後任何失敗都停止應用，交由人工確認；MySQL DDL 可能部分提交，不能假設換 image 或 migration:revert 就能復原。
- SQL 備份在主機 `backups/<SHA>-<UTC>.sql.gz`，含敏感資料且限制權限。不得直接將備份匯入共用 Aurora cluster，先由 SRE 確認復原目標、其他應用及資料影響。
- 同機 dump 不能防主機／磁碟遺失；SRE 仍須確認 Aurora 自動備份／PITR、必要時的 cluster snapshot，以及簽署檔案的異地備份與保留期限。
- 定期檢查 `df -h`、`docker system df` 與備份容量。僅清理確認不需要的舊 images/cache，保留 current／previous；此 PR 不新增清理排程。

## 人工操作

用這版 repository 的 Compose，先載入由部署腳本產生、只含版本資訊的 manifest（不要 source migration.env）：

```bash
cd /path/to/feastogether_intranet
set -a
. /home/feasteng/deploy/intranet-uat/releases/current.env
set +a
docker compose --env-file /dev/null -f docker-compose.uat.yml ps
```

第一次部署尚未成功時，從 Actions build 輸出取得兩個 digest，明確設定 CLIENT_IMAGE／SERVER_IMAGE。修改環境檔後以相同 Compose／env-file 參數 recreate server／worker；server 可使用 `--wait`，worker 不要加 `--wait`。

自動部署接管後不要再使用舊 compose.app.yaml，避免接回本機 DB；手動 compose.rds.yaml 雖連 RDS，仍固定舊 image，也不應用來重部署。不要使用 `--remove-orphans` 刪除舊容器，更不要執行 `down -v`。清除舊 MySQL 是另外的人工操作，這個 PR 不會刪除它。
