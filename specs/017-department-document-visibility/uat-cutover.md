# Spec 017：UAT 部門歸屬切換與回復

本文件是可審查的一次性程序。只完成本機隔離演練，不代表已在 UAT 回填、部署或完成現場盤點。真正執行須依使用者的部署指示；真實備份、員工資訊及簽署證據不提交 repository。

## 維護窗口與執行順序

1. 停止對外文件寫入與一般下載，確認 HTTP process 與 worker 不再變更既有文件；保留維護頁。不能只停止前端按鈕。
2. 備份 UAT 資料庫及私有檔案；記錄可復原位置與備份驗證結果。套用一般 schema migration `1793664000000-DepartmentDocumentVisibility`，只加三個 nullable 欄位及索引，不呼叫 HR、不回填任何資料。
3. 保持停寫，唯讀盤點目前所有舊文件（包含軟刪除），輸出下方 `backup` SQL 的 `backup_json`、`expected_count` 與 `soft_deleted_count` 至受控檔案。這份明列 ID 與原值 JSON 是唯一回填／回復集合；重跑不得重新產生備份以擴大集合。
4. 現場核對使用者指定字串 `1029030000` 對應「IT策略本部系統開發部」。若不符或任一待回填文件已有非預期非空部門，停止並調查，不依名稱猜測、不自動覆蓋。盤點員工缺碼數、登入入口分布與文件證據摘要，保存於受控環境，不把員工統一改為 IT。
5. 使用同一 MySQL connection 載入保存的 JSON 到 session 變數 `@spec017_backup`，`START TRANSACTION`，執行 `lock`、`preflight`、`backfill` 與 `verify`。核對通過後才 `COMMIT`，否則 `ROLLBACK`；任何 SQL 錯誤都必須回滾。不能切換 connection 或使用會自動續跑的管理工具。
6. 部署本規格的完整相容前後端與 worker，維持停寫／停下載；不可只上同部門列表而保留舊全員匯出服務。
7. 要求使用者透過帳密、WebView、OAuth 正式重新登入同步可信部門。驗證兩位 IT 同事看到舊文件、無關部門不能看／匯出；驗證新文件採建立人真正部門、調職及舊 session、本人跨部門簽署／副本與外部副本。全部驗收後才恢復對外服務。

資料前綴、SQL 連線與備份路徑由現場核對，不新增環境變數、排程、永久表或 stored procedure。一次性歸 IT 是使用者指定遷移決策，不宣稱還原了歷史建立部門。

## 載入與整批防護

`backup_json` 使用字串 ID，避免 bigint 經 JavaScript number 失真。SQL 只接受明列 ID，包含軟刪除；不以建立人目前部門查找文件、不改 users、不更改原建立人、updated_at、payload、簽名、manifest 或 PDF。沒有自動建立通知／產檔工作。

在同一 connection 以資料庫 client 的 bound parameter 執行 `SET @spec017_backup = CAST(? AS JSON)`，參數是受控備份檔案內容；不要將未轉義 JSON 拼接到 SQL。手動 client 可使用已正確轉義的 SQL 字串載入。不要把這個含真實 ID 的命令留在 repository。

`preflight` 必須滿足 expected_count > 0，unique_count、existing_count、valid_count 全等於備份 expected_count。原值只允許兩欄皆 NULL 或已是指定目標；現值只能是備份原值或指定目標。任何缺失 ID、重複 ID、未知非空值／不完整備份使整批寫入為零。空集合沒有資料可回填，不當成成功的有效批次。

兩個 UPDATE 內也各自計算完整 preflight，不依賴操作人記得執行檢查；即使略過人工檢查後誤 COMMIT，也不會局部更新有效列。聚合 derived table 強制 materialize，避免 UPDATE 同表子查詢限制。ID 與部門原值以 BINARY 比較，不做數值、大小寫或尾端空白折疊。

`backfill`／`restore` 後立刻執行 `SELECT ROW_COUNT() AS changed_count`，再執行其他查詢；只對需改變的列 UPDATE，所以首次改動筆數可能小於目標筆數，安全重跑應為 0。不能只因 changed_count = 0 就認為成功，必須同時核對 preflight 和 verify 的目標／原值筆數。

## SQL（測試直接讀取下列區塊）

以下具名 SQL 區塊由 `server/test/department-backfill.e2e-spec.ts` 直接解析及執行，不另寫鏡像回填邏輯。backup 僅首次盤點執行；其餘區塊在同一連線、交易、備份 JSON 下使用。

先核對員工部門完整度與舊文件狀態筆數（不回傳姓名、Email 或憑證）：

<!-- sql:inventory -->
```sql
SELECT COUNT(*) AS employee_count,
  SUM(is_active = 1 AND deleted_at IS NULL) AS active_employee_count,
  SUM(is_active = 1 AND deleted_at IS NULL
    AND (department_code IS NULL OR CHAR_LENGTH(TRIM(department_code)) = 0)) AS active_missing_department_count
FROM users;
```

<!-- sql:document_inventory -->
```sql
SELECT status, COUNT(*) AS document_count,
  SUM(deleted_at IS NOT NULL) AS soft_deleted_count,
  SUM(created_by_department_code IS NULL) AS missing_department_count
FROM esign_documents
GROUP BY status
ORDER BY status;
```

原始登入入口分布沿既有 session 稽核資料核對，不新增追蹤欄位；不能以目前 session 數推論全部員工人數。

<!-- sql:backup -->
```sql
SELECT JSON_ARRAYAGG(JSON_OBJECT(
  'id', CAST(id AS CHAR),
  'departmentCode', created_by_department_code,
  'departmentName', created_by_department_name
)) AS backup_json,
COUNT(*) AS expected_count,
SUM(deleted_at IS NOT NULL) AS soft_deleted_count
FROM esign_documents;
```

<!-- sql:lock -->
```sql
SELECT d.id
FROM JSON_TABLE(@spec017_backup, '$[*]' COLUMNS (
  backup_id VARCHAR(32) PATH '$.id' ERROR ON ERROR,
  old_code VARCHAR(150) PATH '$.departmentCode' ERROR ON ERROR,
  old_name VARCHAR(500) PATH '$.departmentName' ERROR ON ERROR,
  has_code INT EXISTS PATH '$.departmentCode',
  has_name INT EXISTS PATH '$.departmentName'
)) AS backup
JOIN esign_documents AS d
  ON CAST(CAST(d.id AS CHAR) AS BINARY) = CAST(backup.backup_id AS BINARY)
ORDER BY d.id
FOR UPDATE OF d;
```

<!-- sql:preflight -->
```sql
SELECT COUNT(*) AS expected_count,
    COUNT(DISTINCT b.backup_id) AS unique_count,
    COUNT(existing.id) AS existing_count,
    SUM(CASE WHEN b.has_code = 1 AND b.has_name = 1
    AND ((b.old_code IS NULL AND b.old_name IS NULL)
      OR (CAST(b.old_code AS BINARY) = CAST('1029030000' AS BINARY)
        AND CAST(b.old_name AS BINARY) = CAST('IT策略本部系統開發部' AS BINARY)))
    AND ((CAST(existing.created_by_department_code AS BINARY) <=> CAST(b.old_code AS BINARY))
      AND (CAST(existing.created_by_department_name AS BINARY) <=> CAST(b.old_name AS BINARY))
      OR (CAST(existing.created_by_department_code AS BINARY) = CAST('1029030000' AS BINARY) AND CAST(existing.created_by_department_name AS BINARY) = CAST('IT策略本部系統開發部' AS BINARY))) THEN 1 ELSE 0 END) AS valid_count
  FROM JSON_TABLE(@spec017_backup, '$[*]' COLUMNS (
  backup_id VARCHAR(32) PATH '$.id' ERROR ON ERROR,
  old_code VARCHAR(150) PATH '$.departmentCode' ERROR ON ERROR,
  old_name VARCHAR(500) PATH '$.departmentName' ERROR ON ERROR,
  has_code INT EXISTS PATH '$.departmentCode',
  has_name INT EXISTS PATH '$.departmentName'
)) AS b
  LEFT JOIN esign_documents AS existing
    ON CAST(CAST(existing.id AS CHAR) AS BINARY) = CAST(b.backup_id AS BINARY);
```

<!-- sql:backfill -->
```sql
UPDATE esign_documents AS d
JOIN JSON_TABLE(@spec017_backup, '$[*]' COLUMNS (
  backup_id VARCHAR(32) PATH '$.id' ERROR ON ERROR,
  old_code VARCHAR(150) PATH '$.departmentCode' ERROR ON ERROR,
  old_name VARCHAR(500) PATH '$.departmentName' ERROR ON ERROR,
  has_code INT EXISTS PATH '$.departmentCode',
  has_name INT EXISTS PATH '$.departmentName'
)) AS backup
  ON CAST(CAST(d.id AS CHAR) AS BINARY) = CAST(backup.backup_id AS BINARY)
JOIN (
  SELECT COUNT(*) AS expected_count,
    COUNT(DISTINCT b.backup_id) AS unique_count,
    COUNT(existing.id) AS existing_count,
    SUM(CASE WHEN b.has_code = 1 AND b.has_name = 1
    AND ((b.old_code IS NULL AND b.old_name IS NULL)
      OR (CAST(b.old_code AS BINARY) = CAST('1029030000' AS BINARY)
        AND CAST(b.old_name AS BINARY) = CAST('IT策略本部系統開發部' AS BINARY)))
    AND ((CAST(existing.created_by_department_code AS BINARY) <=> CAST(b.old_code AS BINARY))
      AND (CAST(existing.created_by_department_name AS BINARY) <=> CAST(b.old_name AS BINARY))
      OR (CAST(existing.created_by_department_code AS BINARY) = CAST('1029030000' AS BINARY) AND CAST(existing.created_by_department_name AS BINARY) = CAST('IT策略本部系統開發部' AS BINARY))) THEN 1 ELSE 0 END) AS valid_count
  FROM JSON_TABLE(@spec017_backup, '$[*]' COLUMNS (
  backup_id VARCHAR(32) PATH '$.id' ERROR ON ERROR,
  old_code VARCHAR(150) PATH '$.departmentCode' ERROR ON ERROR,
  old_name VARCHAR(500) PATH '$.departmentName' ERROR ON ERROR,
  has_code INT EXISTS PATH '$.departmentCode',
  has_name INT EXISTS PATH '$.departmentName'
)) AS b
  LEFT JOIN esign_documents AS existing
    ON CAST(CAST(existing.id AS CHAR) AS BINARY) = CAST(b.backup_id AS BINARY)
) AS preflight
  ON JSON_TYPE(@spec017_backup) = 'ARRAY'
  AND preflight.expected_count > 0
  AND preflight.unique_count = preflight.expected_count
  AND preflight.existing_count = preflight.expected_count
  AND preflight.valid_count = preflight.expected_count
SET d.created_by_department_code = '1029030000',
    d.created_by_department_name = 'IT策略本部系統開發部',
    d.updated_at = d.updated_at
WHERE NOT ((CAST(d.created_by_department_code AS BINARY) <=> CAST('1029030000' AS BINARY))
  AND (CAST(d.created_by_department_name AS BINARY) <=> CAST('IT策略本部系統開發部' AS BINARY)));
```

<!-- sql:restore -->
```sql
UPDATE esign_documents AS d
JOIN JSON_TABLE(@spec017_backup, '$[*]' COLUMNS (
  backup_id VARCHAR(32) PATH '$.id' ERROR ON ERROR,
  old_code VARCHAR(150) PATH '$.departmentCode' ERROR ON ERROR,
  old_name VARCHAR(500) PATH '$.departmentName' ERROR ON ERROR,
  has_code INT EXISTS PATH '$.departmentCode',
  has_name INT EXISTS PATH '$.departmentName'
)) AS backup
  ON CAST(CAST(d.id AS CHAR) AS BINARY) = CAST(backup.backup_id AS BINARY)
JOIN (
  SELECT COUNT(*) AS expected_count,
    COUNT(DISTINCT b.backup_id) AS unique_count,
    COUNT(existing.id) AS existing_count,
    SUM(CASE WHEN b.has_code = 1 AND b.has_name = 1
    AND ((b.old_code IS NULL AND b.old_name IS NULL)
      OR (CAST(b.old_code AS BINARY) = CAST('1029030000' AS BINARY)
        AND CAST(b.old_name AS BINARY) = CAST('IT策略本部系統開發部' AS BINARY)))
    AND ((CAST(existing.created_by_department_code AS BINARY) <=> CAST(b.old_code AS BINARY))
      AND (CAST(existing.created_by_department_name AS BINARY) <=> CAST(b.old_name AS BINARY))
      OR (CAST(existing.created_by_department_code AS BINARY) = CAST('1029030000' AS BINARY) AND CAST(existing.created_by_department_name AS BINARY) = CAST('IT策略本部系統開發部' AS BINARY))) THEN 1 ELSE 0 END) AS valid_count
  FROM JSON_TABLE(@spec017_backup, '$[*]' COLUMNS (
  backup_id VARCHAR(32) PATH '$.id' ERROR ON ERROR,
  old_code VARCHAR(150) PATH '$.departmentCode' ERROR ON ERROR,
  old_name VARCHAR(500) PATH '$.departmentName' ERROR ON ERROR,
  has_code INT EXISTS PATH '$.departmentCode',
  has_name INT EXISTS PATH '$.departmentName'
)) AS b
  LEFT JOIN esign_documents AS existing
    ON CAST(CAST(existing.id AS CHAR) AS BINARY) = CAST(b.backup_id AS BINARY)
) AS preflight
  ON JSON_TYPE(@spec017_backup) = 'ARRAY'
  AND preflight.expected_count > 0
  AND preflight.unique_count = preflight.expected_count
  AND preflight.existing_count = preflight.expected_count
  AND preflight.valid_count = preflight.expected_count
SET d.created_by_department_code = backup.old_code,
    d.created_by_department_name = backup.old_name,
    d.updated_at = d.updated_at
WHERE NOT ((CAST(d.created_by_department_code AS BINARY) <=> CAST(backup.old_code AS BINARY))
  AND (CAST(d.created_by_department_name AS BINARY) <=> CAST(backup.old_name AS BINARY)));
```

<!-- sql:verify -->
```sql
SELECT COUNT(d.id) AS existing_count,
  SUM(CAST(d.created_by_department_code AS BINARY) = CAST('1029030000' AS BINARY)
    AND CAST(d.created_by_department_name AS BINARY) = CAST('IT策略本部系統開發部' AS BINARY)) AS target_count,
  SUM((CAST(d.created_by_department_code AS BINARY) <=> CAST(backup.old_code AS BINARY))
    AND (CAST(d.created_by_department_name AS BINARY) <=> CAST(backup.old_name AS BINARY))) AS original_count
FROM JSON_TABLE(@spec017_backup, '$[*]' COLUMNS (
  backup_id VARCHAR(32) PATH '$.id' ERROR ON ERROR,
  old_code VARCHAR(150) PATH '$.departmentCode' ERROR ON ERROR,
  old_name VARCHAR(500) PATH '$.departmentName' ERROR ON ERROR
)) AS backup
LEFT JOIN esign_documents AS d
  ON CAST(CAST(d.id AS CHAR) AS BINARY) = CAST(backup.backup_id AS BINARY);
```

回填後 existing_count／target_count 必須等於備份筆數；回復後 existing_count／original_count 必須等於備份筆數。另核對軟刪除數、原建立人、業務時間及證據摘要，不能只看 UPDATE 回應。

## 回復與程式回滾

1. 重新停止寫入及下載，載入同一份原始備份，開始交易並依序執行 lock、preflight、restore、verify。restore 只還原明列 IDs 的原始 code/name，保留當下 updated_at 與證據；重跑安全。任何文件現值不再等於原值或指定目標，整批停止，不能局部還原。
2. 核對原值筆數、業務時間、證據及切換後新文件完全不變，通過才 COMMIT。失敗 ROLLBACK，保持維護狀態。
3. 程式只回到能保持部門隔離的相容版本。舊全員匯出版本不能直接恢復對外下載。若新建文件仍依賴快照欄位，保留 schema，不能無條件執行 migration down 丟棄歸屬。
4. 只有已備份且確認無相依資料時才單獨評估 schema down；本程序不自動 down。up/down/up 與資料回復是不同操作。

## 演練與現場紀錄

隔離演練結果由實際測試寫入 validation.md；現場需另記錄維護時間、代碼核對、備份位置、舊集合／軟刪除／已同值／實際改動／回復筆數、證據摘要核對與正式重登入驗收。這些現場操作本次尚未執行，不以隔離演練代替 UAT 驗收。
