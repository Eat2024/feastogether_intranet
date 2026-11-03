# Portal 員工主檔匯入

worker 每天 04:00（台北時間）直接讀 Portal 的在職名單，更新電子簽本機的 `users`。需要臨時同步時，維運可以手動執行同一套匯入，規則相同。

匯入不讀寫任何檔案，也不寄信。Portal 是唯一權威：資料有錯時修正 Portal 後重跑，沒有回復功能。

## 設定

- `PORTAL_MYSQL_*` 寫在 `/home/feasteng/deploy/intranet-uat/server.env`，server 與 worker 都透過 `x-backend` 載入。欄位說明見 `server/.env.example`。
- Portal 帳號只需要 `sys_person` 與 `chi_department` 兩張表的 SELECT 權限。
- 修改 `server.env` 後，依 `docs/deployment/uat-cicd.md`「人工操作」recreate server 與 worker。
- 不要把實際主機、帳號或密碼寫進 Git、指令參數、log 或聊天。

## 匯入規則

- **建立與更新**：讀取 Portal 狀態 0（試用）與 1（正式）的人。
  - 本機沒有這個員編就建立。
  - 欄位有差異才更新；完全相同時不寫入，`updated_at` 也不變。
- **寫入欄位**：員編、姓名、部門代碼與名稱、人員狀態、職稱、Email。
  - 部門代碼只寫入 `department_code`，不改本機的部門外鍵 `department_id`。
  - Portal 的 Email 空白時，會清除本機的舊 Email。
  - 不改本機 ID、登入紀錄，以及已發起文件的身分與信箱快照。
- **略過**：缺姓名、Email 格式錯、欄位超長、員編不合法，或同員編的資料互相衝突（包括只差大小寫）。
  - 只略過該員編，其餘照常匯入。
  - 被略過的人，本機資料不更新，也不停用。
  - log 只記各原因的人數。
- **停用**：本機在職的人，若 Portal 有這個員編、但沒有任何狀態 0／1 的資料，就停用。
  - Portal 查不到這個員編時，不停用也不更新。
- **不恢復**：已停用或軟刪除的帳號不會自動恢復，Portal 恢復在職也一樣；恢復走既有的人工程序。
- **停用門檻**：單次要停用超過 500 人時，整批不寫入，新建與更新也不寫。
  - 每日匯入只記錄 `portal_users.sync_blocked`。
  - 手動執行時，確認人數後才會套用，見下方「停用人數超過門檻」。

## 每日自動匯入

- worker 每天 04:00（台北時間）執行一次。部署多個 worker 也只會執行一次；worker 停機錯過時，恢復後補跑一次。
- 失敗不重試，隔天 04:00 照常執行。
- 在 UAT 主機查看最近一次的結果：

  ```bash
  docker logs --since 24h intranet-uat-worker-1 2>&1 | grep 'portal_users.sync_'
  ```

| 事件 | 等級 | 意義 |
| --- | --- | --- |
| `portal_users.sync_completed` | info | 完成。`metadata.outcome` 為 `applied`（手動 dry-run 為 `dry_run`） |
| `portal_users.sync_blocked` | warn | 要停用的人數超過 500，整批未寫入；`metadata.deactivated` 是要停用的人數 |
| `portal_users.sync_failed` | error | 失敗，整批未寫入。`metadata.outcome` 為 `failed_source`（讀 Portal 失敗）或 `failed_write`（寫本機 DB 失敗），`metadata.errorType` 是錯誤代碼 |

`sync_completed` 與 `sync_blocked` 的 `metadata` 是匯入摘要：

| 欄位 | 說明 |
| --- | --- |
| `trigger` | `schedule`（每日匯入）或 `manual`（手動執行） |
| `sourceAcquiredAt` | 讀取 Portal 的時間（UTC） |
| `sourceRows`／`eligibleEmployees` | Portal 在職資料列數、實際分類的員工數 |
| `created`／`updated`／`unchanged`／`protected`／`deactivated` | 新建、更新、不變、已停用或軟刪除而不動、停用的人數 |
| `skipped` | 依原因分類的略過人數 |

log 不含員編、姓名或 Email。手動執行的 log 只出現在執行的終端機，`docker logs` 看不到。

## 手動執行

用於以下情況：
- 新進同仁需要在下一次 04:00 前就能被選為簽署人。
- Portal 修正資料或恢復連線後，想立即同步。
- 停用人數超過門檻，經確認後套用。

在 repository 目錄先載入部署產生的版本 manifest（不要 source `migration.env`）：

```bash
cd /path/to/feastogether_intranet
set -a
. /home/feasteng/deploy/intranet-uat/releases/current.env
set +a
```

### 1. 預覽（dry-run）

```bash
docker compose --env-file /dev/null -f docker-compose.uat.yml run --rm worker node dist/maintenance/portal-users.js sync --dry-run
```

dry-run 不寫入。終端機會輸出：
- `摘要：{...}`：摘要 JSON，欄位同上表，`outcome` 為 `dry_run`。
- `略過：<員編>（<原因>）`：每個被略過的員編一行。這份清單只出現在終端機，不寫入 log；不要貼到聊天或工單，請到 Portal 修正對應資料。
- `要停用：<N> 人`：本次要停用的人數。

### 2. 正式執行

```bash
docker compose --env-file /dev/null -f docker-compose.uat.yml run --rm worker node dist/maintenance/portal-users.js sync
```

- 正式執行會重新讀取 Portal，不沿用 dry-run 的結果。
- 要停用的人數不超過 500 時，不需要 `--allow-deactivations`。
- 結束碼：
  - 成功為 0。
  - 參數錯誤、Portal 讀取失敗、超過門檻未確認或寫入失敗都是 1，而且本機不會有任何變更。
- 只接受 `sync --dry-run`、`sync` 與 `sync --allow-deactivations <N>`。不接受檔案參數，也沒有 rollback 指令。

## 停用人數超過門檻

第一次上線最可能遇到這個情況：023 的人工匯入從不停用帳號，本機在職帳號中可能已累積許多離職者。

門檻沒有解除前，每天的匯入都會整批不寫入，新進同仁也不會建立，請盡快處理：

1. 執行 dry-run，記下 `要停用：<N> 人`。
2. 對照人資提供的離職人數，確認 N 合理。
   - 不合理（例如 Portal 的人員狀態大量出錯）時不要確認。請 Portal 負責人修正後，回到步驟 1。
3. 帶入同一個 N 正式執行：

   ```bash
   docker compose --env-file /dev/null -f docker-compose.uat.yml run --rm worker node dist/maintenance/portal-users.js sync --allow-deactivations <N>
   ```

   - 只有停用人數超過 500 時才核對 N：N 必須等於執行當下算出的停用人數。
   - dry-run 之後 Portal 若有變動：
     - 停用人數仍超過 500 但不等於 N 時，以結束碼 1 結束、不寫入，並印出新的人數。這時請回到步驟 1 重新確認，不要直接改用新的數字。
     - 停用人數降到 500 以下時不核對 N，直接套用，與不帶參數的 `sync` 相同。
4. 隔天早上確認 worker log 有 `portal_users.sync_completed`，且 `outcome` 為 `applied`。

## Portal 故障

- **徵兆**：
  - worker log 出現 `portal_users.sync_failed`，`outcome` 為 `failed_source`；`errorType` 例如 `ECONNREFUSED`、`ER_ACCESS_DENIED_ERROR`。
  - 同一時間，登入會回 `STAFF_LOOKUP_FAILED`，選人部門樹會回 502 `ORG_CHART_UPSTREAM_UNAVAILABLE`。
- **本機資料**：不會有任何變更。Portal 故障不會被當成「沒有任何員工」，也不會停用任何人。
- **處理**：
  1. 確認 `server.env` 的 `PORTAL_MYSQL_*`、容器到 Portal 的網路，以及帳號對兩張表的 SELECT 權限。
  2. 恢復後可以等下一次 04:00，或手動執行 `sync --dry-run` 後再執行 `sync`。

`failed_write` 表示寫入本機 DB 失敗，整批已 rollback。確認 RDS 狀態後，再手動執行一次。

`failed_source` 的 `errorType` 為 `PortalUndecodableTextError` 時，表示 Portal 讀回的文字無法解碼（通常是編碼錯誤的資料）。同一時間登入與部門樹也會失敗。請 Portal 負責人修正資料後重跑。

已知限制：新進同仁的第一次登入與 04:00 匯入同時發生時，登入可能先建立帳號，匯入新建同一員編就會撞唯一鍵。該次匯入以 `failed_write`（`errorType` 為 `ER_DUP_ENTRY`）結束，整批 rollback，不會部分寫入。手動執行 `sync` 即可，不必等隔天。

## 資料錯誤

- 匯入結果有錯時，修正 Portal 後重跑；沒有回復指令。
- 被誤停用的帳號不會被匯入自動恢復，請走既有的人工恢復程序。
