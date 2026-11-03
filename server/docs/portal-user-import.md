# Portal 員工資料人工維護

此工具維護電子簽本機 `users`，不連線 Portal、不啟動 HTTP／worker、不寄信。使用既有 `DB_MYSQL_*` 設定及已部署的 `users.email` migration；來源擷取由可連 Portal 的維運主機唯讀執行。不新增排程或環境變數。

## 資料與資格

只建立／更新來源狀態 0（試用）及 1（正式）。其他狀態分類略過；來源未出現的員工不代表離職，也不自動停用。離職、人工停用與恢復另循管理程序。既有停用或軟刪除帳號整筆保護，不更新、恢復或刪除。

員編為精確字串，保留前導零及大小寫。來源同員編資料或狀態互相衝突整批拒絕，包含一列合格、一列不合格；完全相同重複列合併並計數。Email trim／小寫、可空且非唯一；明確空值會清除舊 email。來源部門代碼只寫 `department_code`，不覆寫本機 `department_id` 外鍵。保留本機 ID、登入紀錄、歷史文件、通知結果與簽署證據。

## 來源檔

在 Portal 使用唯讀帳號擷取，記錄真正的取得時間（ISO 8601 含時區）。不知道原始取得時間時重新擷取，不能以今天預覽時間或檔案修改時間冒充。不要把密碼寫在命令參數、SQL 或版本控制。

```sql
SELECT
  HEX(TRIM(person_empid)) AS empid_hex,
  HEX(TRIM(person_name)) AS name_hex,
  HEX(TRIM(department_id)) AS department_code_hex,
  HEX(TRIM(department_name)) AS department_name_hex,
  HEX(LOWER(TRIM(email))) AS email_hex,
  person_status,
  HEX(TRIM(title)) AS title_name_hex
FROM sys_person
WHERE person_status IN (0, 1)
ORDER BY person_empid;
```

用 MySQL client `--batch` 匯出，保留七欄 header；tab 分欄、LF 或 CRLF 分行，HEX 以 UTF-8 解碼，字面 `NULL` 表示 SQL NULL。不要以 Excel 重新儲存。非空 email 必須合法；缺姓名或資料格式錯誤整批停止。

檔案放 repository 外的私人目錄（0700），所有來源、排除、預覽與結果檔案為 0600，且不可使用 symbolic link。不要上傳真實名冊／備份到 Git、一般 log 或聊天。

若有經確認必須排除的單筆來源，建立私人 JSON 排除檔，每筆需完整員編與理由；以下只是假資料格式：

```json
[{"employeeNo":"SYN00001","reason":"維運已核對來源缺姓名，待來源修正"}]
```

排除名單不寫死進產品；適用所有該完整員編來源列，摘要顯示略過列數。

## AWS Session 執行

使用已包含本工具的 server image，另開短命容器，不重啟線上服務。以下範例沿用既有部署 DB env 檔；不要 `source migration.env`，也不要列印它。`--env-file` 由 Docker 讀取，保留原有密碼字元。

```bash
portal_image=$(docker inspect --format '{{.Config.Image}}' intranet-uat-server-1)
portal_acquired_at='請替換為本次實際來源取得時間，例如 2026-11-03T07:00:00Z'

docker run --rm \
  --network intranet-uat_default \
  --user "$(id -u):$(id -g)" \
  --env-file /home/feasteng/deploy/intranet-uat/migration.env \
  -v /home/feasteng/imports:/imports \
  --entrypoint node "$portal_image" \
  dist/maintenance/portal-users.js preview \
  --input /imports/portal_users.hex.tsv \
  --acquired-at "$portal_acquired_at" \
  --output /imports/preview-001.json
```

如需排除，在 preview 後加 `--exclude-file /imports/exclusions.json`。`portal_acquired_at` 須換成合法值，範例提示文字會被工具拒絕。

CLI 僅印批次 ID 與摘要；核對來源列數、唯一員工、新建、更新、同值、保護、排除、不合格、缺信箱與清空信箱數。預覽不寫 DB；私有預覽檔包含原值與預計變更，僅由具權限維運人員檢視。

確認後使用同一 image／network／env-file／mount／user 參數，將最後操作換成：

```text
node dist/maintenance/portal-users.js apply --preview /imports/preview-001.json --output /imports/result-001.json
```

若沿用前面的 `--entrypoint node`，最後命令省略開頭的 `node`。來源 hash 或目標 DB 身分不符、原值被修改（包含登入時間與微秒 updated_at）、新增同員編競態、任何寫入失敗都不留下部分提交。既有使用者透過 repository.save 更新，只改有差異資料；同來源重新預覽／apply 應為零變更、不修改 updated_at。

## 失敗與重跑

- 正式結果 `status=applied` 才表示提交且完成結果紀錄；成功退出碼為 0。
- 每次 apply 使用新的預覽及結果檔名。`.apply-lock` 表示該預覽已嘗試，不可刪除後重播；先核對 DB，再產生新預覽。
- `<result>.intent` 保存預覽與原值；`<result>.prepared` 保存交易內實際 before／after 及新增 ID；正式 `<result>` 保存提交完成狀態。
- DB commit 前失敗整批回滾；commit 後檔案寫入失敗會明確回報「資料庫已提交」，必須以 intent／prepared 與 DB 人工對帳。程序被終止而僅留下 prepared 時，也不能猜測 DB 已提交或已回滾。
- 不可把 prepared 手改為 applied；工具要求正式結果、intent 與 prepared 完整一致。人工對帳後的資料修復另循維運程序。

## 受控回復

使用同一執行環境，先執行：

```text
node dist/maintenance/portal-users.js rollback-preview --result /imports/result-001.json --output /imports/rollback-001.json
```

核對還原既有帳號（restore）與移除新帳號（remove）數量後：

```text
node dist/maintenance/portal-users.js rollback --preview /imports/rollback-001.json
```

回復使用單一交易及固定 ID 鎖順序，先確認目前完整資料等於該批寫入後值。只還原既有帳號的本批管理欄位與原 updated_at；不覆寫其他登入欄位。新帳號已有外鍵、session、audit 或明確使用者欄位引用，或無法確認相依，整批拒絕自動回復；不可為了通過回復而刪除歷史紀錄。回復前新增引用或資料異動也會拒絕。

只要偵測到沒有 users 外鍵保護的使用者引用欄位，即使該表完全空白，也會拒絕包含新帳號的整批自動回復：非 FK writer 可能在刪除提交後才插入引用，不能靠空表檢查或 gap lock 保證安全。這種環境只允許自動還原純既有帳號更新批次；含新增帳號的批次需人工處理，不會先部分還原。repository schema.sql 中目前辨識到的使用者欄位都有 users 外鍵；部署實際 schema 仍由工具每次檢查。

檢查依據為目前資料庫 metadata、持久紀錄與欄位，不能推論已被外部刪除的歷史使用。若系統存在工具無法辨識的外部／非結構化引用，不使用自動刪除，交由人工資料修復。權限不足而無法讀 metadata 或相依表時也必須停止。

回復的 `.rollback-lock`／`.rollback-prepared`／`.rollback-result` 保留完整作業依據。只有 rollback-result 的 `status=rolled-back` 是完成紀錄；DB 已回復但結果檔失敗同樣要人工對帳，不能盲目重跑。

## 維運交接與清理

維運負責人在新人或異動需要使用電子簽前人工同步，並記錄來源時間、批次 ID、提交時間及彙總結果。本機資料不是即時 Portal 同步；選人部門樹與登入驗證仍用原來源。沒有 email 的有效員工仍可簽署，通知標示缺信箱。

依組織受控備份保留政策保存完整 source／preview／intent／prepared／result／lock 檔案集合，確認不再需要回復後再清理該批檔案；不要只留下 result 而刪掉回復依據。不要把清理指令套用其他批次或整個 imports 目錄。

應用版本回滾先恢復相容的 server／worker／client，保留 email 欄位及員工資料；不要以回滾程式為由刪除已建立帳號或歷史文件。實際部署與真實寄信須另行操作，工具本身不觸發。
