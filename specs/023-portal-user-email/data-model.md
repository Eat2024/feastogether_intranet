# 資料模型與更新界線

## users（既有；無新增 schema）

| 來源 | 目標 | 限制／規則 |
| --- | --- | --- |
| person_empid | empid | 必填，1–20 碼 ASCII 英數字串，DB varchar(32)；保留大小寫及前導零，精確匹配 |
| person_name | name | trim 後必填，最多 100 字元 |
| department_id | department_code | 可空，最多 50 字元；來源代碼不可寫入本機 department_id 外鍵 |
| department_name | department_name | 可空，最多 150 字元 |
| title | title_name | 可空，最多 100 字元 |
| email | email | trim、小寫、最多 255 字元；非空必須通過既有 Email 驗證；空值為 NULL，可清除舊值；非唯一、select:false |
| person_status | person_status | 僅 0→試用、1→正式；其他來源列不匯入，分類計數 |

本機使用資格沿用 is_active／deleted_at；不突然加上 person_status 中文字串必須相等的限制，以免排除既有合法帳號。新帳號 is_active=true；既有 is_active=false 或 deleted_at 非空整筆略過，不恢復。現有 id、empid、department_id、last_login_at、created_at 與登入／關聯資料不由來源覆寫。updated_at 只在有實際差異時改變。

SQL 欄位 collation：users 一般欄位 utf8mb4_unicode_ci；department_code 為 utf8mb4_0900_bin。查詢必須參數化並明確處理跨 collation；不能依不區分大小寫的唯一鍵誤合併不同員編。比對成功後仍以精確字串核對原員編。

## 匯入 artifact（私有檔案，非資料表）

- schema version、批次 ID、來源 hash／取得時間、目標 DB 身分、預覽時間、映射版本、明確排除員編（需操作員理由）、分類統計。
- 每筆操作含原本 ID／完整必要原值／updated_at、預期新值與 create/update/noop/protected 分類。
- 狀態：validated preview → applied；失敗不提交。apply 前重新讀取並鎖定目標，與預覽原值不一致則拒絕整批。新增同員編被其他交易插入亦拒絕。
- 保存原值 artifact 成功後才允許 apply；私有目錄 0700、檔案 0600，拒絕寫入 repo，日誌僅顯示數量與批次 ID。
- commit 前產生受控操作紀錄；commit 成功後補記新建 ID。若 DB commit 與完成檔寫入之間失敗，視為需人工對帳，不盲目重跑 apply 或宣稱回滾成功。
- 回復前在交易內核對所有目前值與批次寫入後值。已修改、任何新建帳號有外鍵引用或無法確認無引用，均整批拒絕自動回復；必要時從 information_schema 檢查所有 users FK，並檢查非 FK 的 session／audit 使用紀錄。無法證明安全則交由人工修復，不能刪除。
- 回復只還原本批管理欄位及原 updated_at；不得覆蓋後續登入資料；原值或新值比對不足以排除後續使用時必須拒絕。支援 rollback 前預覽。

## 簽署與通知（既有）

users 是可變主檔，esign_signers.email 與身分／部門／職稱快照為發起交易內固定值。users 後續更新不改寫文件快照、通知結果、audit 或證據。缺 Email 不改變簽署資格，通知 skipped／RECIPIENT_UNAVAILABLE。

## 白名單（既有）

employee：精確員編有效 users.email；department：精確 department_code 的直接員工信箱；email：完整正規化地址直接允許。union 後與本次收件地址取交集；共享信箱不合併帳號，維持信箱集合政策。新信箱不替換舊文件收件目標。
