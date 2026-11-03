# 資料模型：Portal 直連取代饗賓人人資查詢

本規格不新增資料表、欄位或 migration。下面描述讀取的 Portal 資料、寫入本機 `users` 的對應方式，以及匯入的分類規則。

## Portal 人員列（`sys_person`，唯讀）

| 欄位 | 型別 | 用途 |
| --- | --- | --- |
| `person_empid` | varchar(20)，不分大小寫的 collation | 員編。查詢後在程式中以 `===` 精確比對 |
| `person_name` | varchar(50) utf8mb4 | 姓名 |
| `person_status` | int | 0 試用、1 正式；其他任何值都是非在職 |
| `department_id` | varchar(11) | 來源部門代碼，空字串代表沒有部門 |
| `department_name` | varchar(40) | 部門名稱 |
| `title` | varchar(20) | 職稱，空字串代表沒有職稱 |
| `email` | varchar(50) | Email，空字串代表沒有信箱 |

禁止讀取 `person_pass`、`person_id_no`、`birthdate` 以及上表以外的欄位。

## Portal 部門列（`chi_department`，唯讀）

| 欄位 | 型別 | 用途 |
| --- | --- | --- |
| `department_ch_id` | varchar(20) | 部門代碼，必須不是空白且不重複 |
| `department_name` | varchar(50) | 名稱 |
| `department_parent_guid` | varchar(100) | 上層部門代碼；空字串視為沒有上層 |
| `startdate` | varchar(20) | 原樣輸出 |
| `stopdate` | varchar(20)，可為 NULL | NULL 代表未停用；只讀取未停用的部門 |

## 無法解碼的文字

mysql2 遇到無法解碼的位元組時會換成 U+FFFD，不會報錯。任一查詢讀回的字串含 U+FFFD，整次查詢視為來源錯誤（spec Edge Cases「Portal 中文編碼」）：組織樹回 502、不寫快取；登入回 `STAFF_LOOKUP_FAILED`；匯入以 `failed_source` 結束、不寫入本機。

## 選人部門樹（回應契約不變）

沿用 Spec 006／019：部門節點包含 `department_ch_id`、`department_name`、`department_parent_guid`、`startdate`、`stopdate: null`、`children`、`employees`；員工包含 `person_empid`、`person_name`、`title`。組樹規則見 research §4。

## 登入時的員工資料（沿用 `StaffLookupDto` 規則）

| 欄位 | 來源 | 驗證 |
| --- | --- | --- |
| `person_empid` | `person_empid` | `^[A-Za-z0-9]+$`，最長 32 字，必須與輸入完全相同 |
| `person_name` | `person_name` | 不可空白，最長 100 字 |
| `department_id` | `department_id` | 可為空；有值時須符合 `^[A-Za-z0-9_-]+$`，最長 50 字 |
| `department_name` | `department_name` | 可為空，最長 150 字 |
| `title` | `title` | 可為空，最長 100 字 |
| `person_status` | `person_status` | 只接受 0 或 1 |
| `person_status_name` | 由狀態推得 | 0 為「試用」、1 為「正式」 |

Portal 的 `person_name`、`department_id`、`department_name`、`title` 是 `NOT NULL DEFAULT ''`。驗證前先 trim，空字串轉為 null（與 fgapi `SyncUsersFromPortal` 相同）。員編不 trim，尾端空白不算相符。

精確比對後必須剛好一筆。寫入本機的方式與現行相同：
- 帳密登入與 WebView：寫入 `name`、`personStatus`、`departmentCode`（空白轉 null）、`departmentName`、`titleName`。
- OAuth：只寫入 `departmentCode`、`departmentName`；姓名來自 OAuth profile。
- 兩者都不寫 `departmentId` 外鍵。

## 本機 `users`：匯入寫入的欄位

| Portal | 本機屬性（欄位） | 規則 |
| --- | --- | --- |
| `person_empid` | `empid`（`empid`） | 精確字串，保留前導零與大小寫 |
| `person_name` | `name`（`name`） | trim 後不可空白，最長 100 字 |
| `person_status` | `personStatus`（`person_status`） | 0 為「試用」、1 為「正式」 |
| `department_id` | `departmentCode`（`department_code`） | trim，空白轉 null，最長 50 字；不寫 `department_id` 外鍵 |
| `department_name` | `departmentName`（`department_name`） | trim，空白轉 null，最長 150 字 |
| `title` | `titleName`（`title_name`） | trim，空白轉 null，最長 100 字 |
| `email` | `email`（`email`，`select:false`） | trim 後轉小寫，空白轉 null（會清除舊值），必須是合法 Email，最長 255 字 |
| （無） | `isActive`（`is_active`） | 新建時為 true；停用規則見下方 |

不寫入的欄位：`departmentId`、`lastLoginAt`、`createdAt`、`deletedAt`。

## 匯入分類

每次執行，對每個員編只產生一個結果：

| 結果 | 條件 | 動作 |
| --- | --- | --- |
| `create` | Portal 在職、資料合法，本機沒有這個員編 | 新建，`isActive = true` |
| `update` | Portal 在職、資料合法，本機在職且欄位有差異 | 只更新有差異的欄位 |
| `noop` | Portal 在職、資料合法，本機欄位完全相同 | 不寫入，`updated_at` 不變 |
| `protected` | Portal 在職，但本機帳號已停用或已軟刪除 | 不寫入，也不恢復 |
| `deactivate` | 本機在職；Portal 有這個員編，但沒有任何 0／1 的資料列 | `isActive = false` |
| `skipped:<原因>` | 該員編的 Portal 在職資料不合法或互相衝突 | 不寫入，也不停用 |
| （不列入） | 本機員編在 Portal 查不到 | 不動 |

`skipped` 的原因有：`missing_name`、`invalid_email`、`too_long`、`invalid_empid`、`conflict`（同員編資料不同，或員編只差大小寫）。完全相同的重複資料列合併計算，不算衝突。Portal 員編與本機既有員編只差大小寫時也算 `conflict`，因為本機 `empid` 唯一鍵不分大小寫。

## 帳號啟用狀態的轉換

```text
is_active = true  --(Portal 明確非在職，且未超過停用門檻)--> false   # 由匯入執行
is_active = false --(匯入)--> 不轉換                                 # 只能走既有人工程序恢復
```

- 停用門檻：每次 500 人，是程式常數。
- 每日匯入：停用人數超過門檻時，整批不寫入。
- 手動 CLI：停用人數超過門檻時，帶 `--allow-deactivations <N>`，且 N 等於本次停用人數，才會套用；沒有超過門檻時不需要這個參數。

## 匯入結果摘要（只寫 log，不寫入資料庫）

| 欄位 | 說明 |
| --- | --- |
| `trigger` | `schedule` 或 `manual` |
| `sourceAcquiredAt` | 讀取 Portal 的時間（UTC） |
| `sourceRows` / `eligibleEmployees` | Portal 在職資料列數、合法的唯一員工數 |
| `created` / `updated` / `unchanged` / `protected` / `deactivated` | 各分類人數 |
| `skipped` | 依原因分類的人數，不含員編 |
| `outcome` | `applied`、`dry_run`、`blocked_deactivation_threshold`、`failed_source`、`failed_write` |

這份摘要不包含員編、姓名、Email 或其他個資。

`failed_source`／`failed_write` 只出現在失敗 log；`run` 失敗時拋出不含原始錯誤的例外，不回傳摘要。
