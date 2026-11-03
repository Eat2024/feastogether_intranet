# Portal 來源契約

## 環境變數

| 變數 | 必填 | 預設 | 說明 |
| --- | --- | --- | --- |
| `PORTAL_MYSQL_HOST` | 是 | | Portal MySQL 主機 |
| `PORTAL_MYSQL_PORT` | 否 | 3306 | |
| `PORTAL_MYSQL_USER` | 是 | | UAT 使用 `survey_role` |
| `PORTAL_MYSQL_PASS` | 否，可為空 | 空字串 | 只存在於部署環境；可為空是因為合成 Portal 沿用本機測試 DB 的帳密 |
| `PORTAL_MYSQL_DB` | 是 | | `portal` |

- 第一次查詢時才檢查必填值；缺漏時視為來源不可用，不影響服務啟動。
- 連線上限 3、連線逾時與查詢逾時各 10 秒，都是程式常數。
- 每次呼叫另有 10 秒的整體期限，涵蓋排隊等連線、建立連線與查詢；mysql2 pool 沒有 acquire timeout，Portal 不回應時，超過 3 個的並發呼叫也在期限內拒絕。

## Portal 查詢（只有這四個）

```sql
-- 1. 組織樹：部門
SELECT department_ch_id, department_name, department_parent_guid, startdate, stopdate
FROM chi_department WHERE stopdate IS NULL
ORDER BY CAST(department_name AS BINARY), department_ch_id;

-- 2. 組織樹：正式員工
SELECT person_empid, person_name, title, department_id
FROM sys_person WHERE person_status = 1 ORDER BY person_empid;

-- 3. 登入：依員編查詢（查回後在程式中以 === 精確比對）
SELECT person_empid, person_name, department_id, department_name, title, person_status
FROM sys_person WHERE person_empid = ?;

-- 4a. 匯入：在職名單
SELECT person_empid, person_name, department_id, department_name, title, email, person_status
FROM sys_person WHERE person_status IN (0, 1);

-- 4b. 匯入：本機在職、但不在 4a 名單中的員編狀態，每批最多 500 個
SELECT person_empid, person_status FROM sys_person WHERE person_empid IN (?, ...);
```

- 不得出現其他資料表、欄位或任何寫入語句。
- 單元測試要比對這些 SQL 字串，確保欄位清單不會被擴大。

## `PortalDirectoryService`（infrastructure/portal）

| 方法 | 回傳 | 失敗時 |
| --- | --- | --- |
| `listOrgChartSource()` | `{ departments, employees }`，Portal 原始資料列 | 拋出錯誤，由呼叫端轉成自己的錯誤碼 |
| `findEmployeesByEmpid(empid)` | 資料列陣列，可能是 0 筆或多筆 | 同上 |
| `listActiveEmployees()` | 查詢 4a 的資料列 | 同上 |
| `findStatusesByEmpids(empids)` | `{ person_empid, person_status }[]` | 同上 |

- 任一資料列的字串含 U+FFFD（mysql2 對無法解碼位元組的替代字元）時，該次呼叫拒絕，錯誤名稱為 `PortalUndecodableTextError`，訊息不含資料內容（data-model「無法解碼的文字」）。

這個服務不做業務判斷，也不寫 log 個資。

## HTTP（client 可見部分全部不變）

| 端點 | 本次變更 | 錯誤 |
| --- | --- | --- |
| `GET /api/esign/signer-candidates/org-chart` | 資料來源改為 Portal | Portal 或組樹失敗回 502 `ORG_CHART_UPSTREAM_UNAVAILABLE`（不寫快取）；Redis 失敗回 503 `ORG_CHART_UNAVAILABLE`；未登入回 401 |
| 帳密登入、WebView launch、OAuth callback | 員工資料查詢改為 Portal | 來源失敗回 `STAFF_LOOKUP_FAILED`；不合格回 `AUTH_EXCHANGE_FAILED`；帳密錯誤與帳號停用沿用饗賓人 `staff/login` 的對應 |

## Worker 排程

| 項目 | 值 |
| --- | --- |
| Queue | `portal-user-sync`（只在 worker 註冊） |
| Scheduler id | `portal-user-sync:daily` |
| 排程 | `{ pattern: '0 4 * * *', tz: 'Asia/Taipei' }` |
| Job 選項 | `attempts: 1`，`removeOnComplete: 1000`，`removeOnFail: 1000` |
| Processor concurrency | 1 |

log 事件（內容都不含員編或其他個資）：
- `portal_users.sync_completed`：摘要（見 data-model）。
- `portal_users.sync_blocked`：停用人數超過門檻，附停用人數。
- `portal_users.sync_failed`：失敗分類（`source` 或 `write`）與錯誤類型。

這三個事件由匯入服務自己寫出，processor 與 CLI 不重複記錄。

## 手動 CLI

```text
node dist/maintenance/portal-users.js sync --dry-run
node dist/maintenance/portal-users.js sync [--allow-deactivations <N>]
```

- `--dry-run`：不寫入。stdout 輸出：
  - 摘要 JSON
  - 每個被略過的員編與原因
  - 本次要停用的人數
- 正式執行：
  - 停用人數超過門檻時，必須帶 `--allow-deactivations`，且 N 等於本次停用人數，否則以非零狀態結束、不寫入。
  - 沒有超過門檻時，不需要這個參數。
- 結束碼：成功為 0；參數錯誤、來源失敗、超過門檻未確認或寫入失敗為非零。
- 不讀檔，也不寫檔；不接受 `--input`、`--output`、`--exclude-file`、`--acquired-at`，也沒有 rollback 指令。
- UAT 執行方式：先載入 `releases/current.env`，再以 `docker compose --env-file /dev/null -f docker-compose.uat.yml run --rm worker` 執行，完整步驟見 runbook [手動執行](../../../server/docs/portal-user-import.md#手動執行)。
