# 白名單受控維護

此程序供環境管理人在已核對環境的 DB 工具執行；應用程式不自動執行 seed。開發驗證僅使用 `feastogether_intranet_test*` 隔離資料庫。操作紀錄保留於受控維運管道，不提交連線憑證或實際信箱。

## 上版與初始規則

1. 停止非 production 的舊 worker 與可能寄 OTP 的 HTTP 入口；新舊版本不可混跑寄信。
2. 核對 `SELECT DATABASE(), @@hostname, @@port`、備份原資料，再依既有 migration 流程套用 schema。新表僅七欄，migration 不加入任何規則。
3. 在同一維護連線設定 `SET time_zone = '+00:00'`，開始 `START TRANSACTION`。以以下查詢列出四個目標 key 的原值，保存操作前快照；不存在的 key 才是本次預期新增項目。

```sql
SELECT id, type, value, remark, created_at, updated_at, deleted_at
FROM mail_recipient_whitelist
WHERE (type = 'department' AND value IN ('1029030000', '1029090000', '1029010000'))
   OR (type = 'employee' AND value = '09005001')
ORDER BY type, value FOR UPDATE;
```

4. 執行 `server/src/infrastructure/mail/seed-mail-recipient-whitelist.sql`，立刻檢查 `SELECT ROW_COUNT()` 與預期缺少 key 數一致，再重跑上述查詢保存新增 id 及完整列快照。第一次空表應新增四筆；重跑應為零，既有備註與撤銷時間不得變動。若不符則 `ROLLBACK`，符合才 `COMMIT`。並行維護遇唯一鍵衝突時回滾後重新核對，不使用 `INSERT IGNORE` 掩蓋錯誤。
5. 提交後再次核對有效規則，不應包含上層 `1029000000`。若已有被撤銷的初始列，不因 seed 重新啟用；需要另行核准明確恢復。
6. 同步部署 guarded sender、worker 結果處理與 OTP 分支，完成合成／受控驗收後才開放寄送。

## 新增、撤銷及恢復

每次維護皆在同一連線／交易內先查原值並 `FOR UPDATE`，列出預期 key 與影響筆數。以下 `?` 代表 DB 工具的字串參數，不是可直接執行的字面值；員編須傳完整字串，不轉數字、不 trim 或改大小寫；信箱須由維護人先轉為小寫完整地址再傳入。

有效格式由 DB 同時強制（`email` 類型由 [Spec 021](../021-external-mail-whitelist/spec.md) 新增）：`type` 精確為 `department`、`employee` 或 `email`；部門值 1–50 個 ASCII 英數、底線或連字號；員編 1–20 個 ASCII 英數；信箱值為小寫完整地址，最多 255 字元，恰好一個 `@` 且前後非空，不含空白或控制字元。部門與員編不得填空白、換行或 Email。值的大小寫精確區分，含大寫的信箱會被拒絕。DB 不做完整信箱格式驗證，規則值須為寄送端可接受的地址，否則永遠不會命中。

信箱規則範例（僅示意，實際地址不提交 repo）：`type = 'email'`、`value = 'tester@example.test'`。

```sql
START TRANSACTION;
SELECT id, type, value, remark, created_at, updated_at, deleted_at
FROM mail_recipient_whitelist WHERE type = ? AND value = ? FOR UPDATE;
```

依已核對原值選擇唯一一種動作：

```sql
-- 新增：只適用從未存在的 key；重複（含已撤銷列）由唯一鍵拒絕。
INSERT INTO mail_recipient_whitelist (type, value, remark) VALUES (?, ?, ?);

-- 撤銷：保留原列，預期一筆；UTC 時間不依客戶端時區。
UPDATE mail_recipient_whitelist
SET deleted_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6)
WHERE id = ? AND type = ? AND value = ? AND deleted_at IS NULL;

-- 明確恢復：必須已取得恢復授權；沿用原 id，不重新 INSERT。
UPDATE mail_recipient_whitelist
SET deleted_at = NULL, updated_at = UTC_TIMESTAMP(6)
WHERE id = ? AND type = ? AND value = ? AND deleted_at IS NOT NULL;
```

動作後立即讀取 `ROW_COUNT()`，應為一筆；再讀同一 key 核對預期變更，符合才 `COMMIT`，否則 `ROLLBACK`。不直接更改既有規則的 type/value；改範圍應撤銷舊 key 再新增新 key。提交後下一次開始的寄送檢查採用新規則，無須重啟；已交 SMTP 的信件無法追回，先前 skipped 不會自動補寄。

## 回滾

- 回滾程式前先停止所有非 production 寄送入口與 worker，避免舊程式無白名單保護。優先保留表與資料修復，不以刪表或設定 production 繞過政策。
- seed 回滾只能處理本次新增且仍與 seed 後完整快照一致的列。交易內依新增 id 鎖定並比較 type/value/remark/created_at/updated_at/deleted_at，任一異動即停止處理該列，交由維護人判斷；不得刪除／撤銷其他既有列。對確認未改動列，以同 id、原 type/value 與原 updated_at 條件軟刪除，核對影響數後提交。若需要維持撤銷歷史，不刪除 row。
- 回滾 Spec 021 migration（`MailWhitelistEmailRule1793664001000`，只還原 `value` 長度、註解與 CHECK，不刪表）前，須先備份並刪除所有 `type = 'email'` 列（含已撤銷）。仍有信箱列時 down 會因 CHECK 整句失敗、資料不變。

```sql
START TRANSACTION;
SELECT id, type, value, remark, created_at, updated_at, deleted_at
FROM mail_recipient_whitelist WHERE type = 'email' ORDER BY id FOR UPDATE;
-- 保存上列完整快照至受控維運管道後：
DELETE FROM mail_recipient_whitelist WHERE type = 'email';
-- ROW_COUNT() 須等於快照筆數，符合才 COMMIT，否則 ROLLBACK。
```

- schema `down` 會刪除整張表與維護歷史。只有完成備份、停止所有依賴程式且確認可丟棄表時，才依既有 migration 回滾程序執行；隔離驗證可執行 up/down/up。
