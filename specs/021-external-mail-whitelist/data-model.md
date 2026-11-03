# Data Model: mail_recipient_whitelist 信箱規則

沿用 Spec 018 的七欄表，不新增欄位或索引。以下只列變更。

## 欄位變更

| 欄位 | 變更前 | 變更後 |
|---|---|---|
| type | varchar(20) bin，註解「department 部門、employee 員工」 | 型別不變，註解「department 部門、employee 員工、email 收件信箱」 |
| value | varchar(50) bin，註解「完整部門代碼或員編，保留前導零」 | varchar(255) bin，註解「完整部門代碼、員編或小寫收件信箱」 |

Entity：`MailRecipientWhitelistType = 'department' | 'employee' | 'email'`，`value` length 255。

## CHECK

約束名稱不變（`chk_mail_recipient_whitelist_type`、`chk_mail_recipient_whitelist_value`），以 DROP／ADD 重建。

```sql
CONSTRAINT `chk_mail_recipient_whitelist_type`
  CHECK (`type` IN ('department', 'employee', 'email')),
CONSTRAINT `chk_mail_recipient_whitelist_value` CHECK (
  (`type` = 'department' AND CHAR_LENGTH(`value`) BETWEEN 1 AND 50 AND NOT REGEXP_LIKE(`value`, '[^A-Za-z0-9_-]', 'c'))
  OR (`type` = 'employee' AND CHAR_LENGTH(`value`) BETWEEN 1 AND 20 AND NOT REGEXP_LIKE(`value`, '[^A-Za-z0-9]', 'c'))
  OR (`type` = 'email' AND `value` = LOWER(`value`) AND REGEXP_LIKE(`value`, '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$', 'c'))
)
```

- 長度上限由欄位 VARCHAR(255) 保證，email 分支不再重複檢查。
- `value = LOWER(value)` 在 bin collation 下區分大小寫，含大寫即違反。
- 實作時以 schema 測試確認 MySQL 8.4 的 ICU regex 支援巢狀 `[:space:]`／`[:cntrl:]`；若不支援，改為等價的明確字元集合。

## 唯一鍵

`uq_mail_recipient_whitelist_type_value (type, value)` 不變；欄位放寬後鍵長約 (20 + 255) × 4 = 1,100 bytes，低於 3,072 bytes。

## 初始與維護資料

- seed 不變，不含任何信箱規則。
- 信箱規則以 018 maintenance 的受控程序新增、撤銷、恢復；值必須為小寫完整地址。範例只使用 `example.test`，實際地址不提交。

## Migration 與回滾

- `MailWhitelistEmailRule1793664001000`，排在 `DepartmentDocumentVisibility1793664000000` 之後。
- down 還原 VARCHAR(50) 與原 CHECK；存在任何 `type = 'email'` 列（含已撤銷）時整句失敗、資料不變。回滾前須備份並刪除這些列。
