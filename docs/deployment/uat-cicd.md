# 電子簽 UAT CI/CD

本流程沿用 CKS 的 self-hosted GitHub Actions + GHCR + Compose 模式。`uat` push（包含 PR merge）或在 `uat` 手動觸發會部署精確 commit；沒有 PR／GitHub-hosted 品質檢查工作。部署狀態可在 Actions 查看。

## 本機品質檢查

`pnpm install` 的 prepare 會設定此 checkout 的 `core.hooksPath=.githooks`，也可執行 `pnpm hooks:install`。

- pre-commit、pre-merge-commit：前後端 lint、後端 unit tests。
- pre-push：前後端 build。
- `pnpm test:deploy`：以替身驗證部署失敗分支，不連線 UAT。

hooks 不修改 staged 檔案、不自動 format。檢查的是 working tree，請避免同時修改檔案。GitHub 網頁 merge 不執行本機 hooks；fast-forward、rebase 也不會觸發 pre-merge-commit。hooks 可以被略過，應配合團隊 review／分支保護。E2E 仍依 server 文件在隔離測試資料庫執行，不直接對 UAT 跑測試。

## 實際架構與固定路徑

- runner 必須位於目前的 Linux x64 UAT EC2，專用 label `intranet-uat`，以 `feasteng` 帳號執行。
- Compose project 固定為 `intranet-uat`；採用 root 的 `docker-compose.uat.yml`。
- 沿用 `/home/feasteng/deploy/intranet-uat/.env` 的 `MYSQL_ROOT_PASSWORD`、`DB_MYSQL_PASS`。
- 沿用同目錄的 `server.env`：SMTP、FEASTOGETHER API、WebView 公鑰、HTTPS origins 與邀請加密金鑰，欄位定義見 `server/.env.example`。不提交這兩份檔案。
- 明確沿用 external volumes：`intranet-uat_mysql-data`、`intranet-uat_redis-data`、`intranet-uat_esign-data`。找不到時停止，不建立空白替代資料庫。
- MySQL 與 Redis 仍使用既有 EC2 容器。這份配置**尚未切到 RDS**；確定轉移時須同步改連線、備份與 migration 流程。
- 前端只發布 `127.0.0.1:3000`；既有 Nginx 8080 與 ALB 路由不由部署腳本修改。

## 第一次啟用（主機管理員操作）

1. 將這次 CI/CD 檔案合併到 `uat`，先不要移除現有手動 Compose。第一次自動部署前，現有 client/server/worker 必須存在，MySQL／Redis 必須 healthy。
2. 在 GitHub repository 的 Settings → Environments 建立 `uat`，將 deployment branch 限定為 `uat`。依團隊規範設定 branch protection。此 workflow 不接受其他 ref 的手動部署。
3. 到 Settings → Actions → Runners → New self-hosted runner，選 Linux x64。依 GitHub 當下產生的下載、驗證、設定指令，在此 EC2 安裝**此 repository 專用 runner**；目錄例如 `/home/feasteng/actions-runner-intranet`，label 加 `intranet-uat`。註冊 token 不寫入 repo 或聊天。
4. runner 使用 `feasteng` 身分，安裝成 systemd service（依 runner 目錄提供的 `sudo ./svc.sh install feasteng`、`sudo ./svc.sh start`）。專用 runner 不執行不受信任的 PR 程式，因為它可以接觸 Docker 與 UAT 機密。
5. runner 需要直接使用 Docker。由管理員執行 `sudo usermod -aG docker feasteng`，然後重新啟動 runner service。Docker 群組具有等同主機 root 的能力；不要另外給不相關帳號。runner 必須可讀寫部署目錄、讀取兩份 env 檔，目錄設為 700、env 設為 600。
6. 確認 runner 有 `bash`、`git`、`docker compose`、`curl`、`gzip`、`flock`，並可對外存取 GitHub Actions、ghcr.io、Docker Hub 與 pnpm registry。主機不必安裝 Node/pnpm：build 在 Docker 內執行。
7. GHCR 使用 workflow 的短期 `GITHUB_TOKEN`，權限為 `contents: read`、`packages: write`。若組織限制建立 package 或同名 package 已存在，需讓此 repository 取得兩個 package 的寫入／讀取權限。package 保持 private，確認組織的儲存／流量配額。
8. 在 Actions 的「電子簽 UAT 部署」選 `uat` 手動執行第一次部署。確認 build、migration、smoke 與摘要都成功，再驗收 HTTPS 登入、上傳、寄信、簽署與匯出。

## 每次部署

1. self-hosted runner 依序 build server/client，context 都是 workspace root。`API_PROXY_TARGET=http://server:3000` 在前端 build 時注入。
2. 推送 `ghcr.io/<owner>/feastogether-intranet-{server,client}:<SHA>`，取得 digest；同一 server digest 用於 migration、HTTP server、worker。
3. 使用 GitHub concurrency 與主機 `flock` 避免部署互撞。驗證既有 volumes 與資料庫健康，不重啟 MySQL／Redis。
4. 使用候選 server image 讀取 migration 狀態；連線／程式錯誤直接停止，不當作 pending migration。
5. 沒有 pending migration 就略過備份。有 pending 時先停 client/server/worker，透過既有 MySQL root 帳號做邏輯備份，成功後才執行 TypeORM migration。此 UAT 帳號安排沿用現有本機容器；正式環境應另外規劃 DDL 權限。
6. 更新 server 並等待 HTTP healthy，啟動 worker/client。檢查前端、代理 `/api/health`、worker 啟動訊息及 restart count。worker 不使用 HTTP `--wait`。這是啟動 smoke，不能替代寄信／匯出完整驗收。
7. 寫入 `releases/current.env`、`previous.env` 與 `before-last-deploy.env`。不自動執行 `docker system prune` 或刪除資料 volumes。

建置與服務共用 EC2 資源；2 核／8 GB 機器部署期間可能變慢。資料庫 migration 會有停機窗口，不宣稱零停機。

## 失敗與備份

- build／migration 檢查失敗：尚未更新服務。
- 備份失敗：不執行 migration，嘗試重新啟動舊映像。
- 沒有執行 migration 的應用更新失敗：嘗試回復部署前 images，再次 smoke；workflow 仍標記失敗。
- migration 一旦開始後，任何失敗都停止應用服務，交由人工確認 schema／資料。MySQL DDL 可能部分提交，不能假設換回 image 或 `migration:revert` 就能恢復。
- 備份在 `/home/feasteng/deploy/intranet-uat/backups/<SHA>-<UTC>.sql.gz`，含敏感資料且權限限制；同機備份不能防止磁碟／主機遺失。請 SRE 規劃異地備份與保留期限，簽署檔案 volume 也必須備份。
- 目前磁碟約 28 GB；定期檢查 `df -h`、`docker system df` 與備份容量。只清理已確認不需回復的舊 images/build cache，保留 current／previous。此版本沒有額外新增自動清理排程。

## 人工檢查

使用這版 repository 的 Compose 時，先載入成功部署版本（不要把輸出貼出機密）：

```bash
cd /path/to/feastogether_intranet
set -a
. /home/feasteng/deploy/intranet-uat/releases/current.env
set +a
docker compose --env-file /home/feasteng/deploy/intranet-uat/.env -f docker-compose.uat.yml ps
```

若第一次部署尚未成功，可從 Actions build 輸出取得兩個 digest 並明確設定 `CLIENT_IMAGE`、`SERVER_IMAGE` 後再檢查。更新 `server.env` 後需要 recreate 容器；單純 restart 不會載入新的環境變數。server 可用 `up -d --no-deps --force-recreate --wait server`，worker 另用 `up -d --no-deps --force-recreate worker`，兩者都帶同樣的 Compose／env-file 參數。

不要使用舊 `compose.app.yaml` 部署，否則會切回手動 image 版本；不要執行 `down -v`。RDS 遷移、Nginx／ALB、API key、runner 註冊均不由此 workflow 自動配置。
