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

1. `server.env`：SMTP、饗賓 API、WebView 公鑰、HTTPS origins 與邀請加密金鑰，欄位見 `server/.env.example`。
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

1. 依序 build server/client，context 為 workspace root，前端 build 使用 `API_PROXY_TARGET=http://server:3000`。
2. 推送 GHCR 的 SHA tag，取得 digest；migration、server、worker 使用同一份 server digest。
3. GitHub concurrency 與主機 flock 防止部署互撞。檢查既有 Redis／檔案 volumes／網路，不啟停舊 MySQL、不重啟 Redis。
4. 使用候選 server image 檢查 RDS 目標、CA、連線及 pending migrations。連線／程式錯誤直接停止，不誤認為 pending。
5. 無 pending 就略過備份。有 pending 時先拉取 `mysql:8.4` 工具 image，再停止 client/server/worker。一次性 `db-backup` 容器以同一組 raw RDS 帳密與 CA，對 `intranet_uat` 做加密連線的邏輯備份，gzip 完成後才執行 TypeORM migrations。
6. 備份包含表、資料與 triggers；本專案沒有 stored routines／events，這些不在 dump 範圍。只備份 intranet_uat，不接觸帳號另外可存取的 oauth_uat。這是 schema 級備份，不呼叫 AWS snapshot，也不需要新增 AWS IAM 權限。
7. server 更新後等待 HTTP healthy；worker/client 啟動後檢查前端、代理 `/api/health`、worker 啟動訊息及 restart count。worker 不使用 HTTP `--wait`。smoke 不等於完整業務驗收。
8. 記錄 `releases/current.env`、`previous.env`、`before-last-deploy.env`。不自動 prune 或刪除 volumes。

2 核／8 GB EC2 的建置與服務共用資源，migration 有停機窗口，不宣稱零停機。

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
