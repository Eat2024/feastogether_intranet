# Data Model: mail_recipient_whitelist

使用者已核准七欄，沒有第八個操作人、環境、信箱或啟用旗標。以下已實作為 entity／migration／schema，僅在隔離測試 DB 建表驗證。

## Entity 與欄位

Entity `MailRecipientWhitelist` 放於 `server/src/infrastructure/mail/mail-recipient-whitelist.entity.ts`，繼承 AuditableEntity；repository 同 feature、由 MysqlModule 註冊。

| 欄位 | Property | 型別／NULL／預設 | 驗證 |
|---|---|---|---|
| id | id | bigint，PK，自動遞增 | 沿既有 repository 流水號慣例 |
| type | type | varchar(20)，NOT NULL，無預設 | 只允許 department、employee，精確大小寫 |
| value | value | varchar(50)，NOT NULL，無預設 | 非空白；部門 1–50 字元 `[A-Za-z0-9_-]`，員工 1–20 字元 `[A-Za-z0-9]`，保留前導零 |
| remark | remark | varchar(255)，NULL，預設 NULL | 顯示／維護備註，不參與授權 |
| created_at | createdAt | datetime(6)，NOT NULL | 沿 BaseEntity 建立時間，UTC |
| updated_at | updatedAt | datetime(6)，NOT NULL | 沿 AuditableEntity 修改時間，UTC |
| deleted_at | deletedAt | datetime(6)，NULL | NULL 表有效，其餘為撤銷時間 |

type／value 使用 utf8mb4_0900_bin 精確比較；不能 trim／轉大小寫後偷偷合併不同代碼，非法資料拒絕。表與欄位加繁體中文 comment。

- 唯一索引 `uq_mail_recipient_whitelist_type_value`：`(type, value)`，涵蓋已撤銷資料。
- CHECK：類型 enum 範圍、value 非空且依 type 滿足上述長度／字元。DB 與維護步驟採一致驗證；MySQL 實際 constraint 行為需 schema integration test 證明。
- 有效讀取 `deleted_at IS NULL`；初始小表不增加沒證據需要的 secondary index，後續資料量需求再以 EXPLAIN 決定。
- 不建立 value 到 users／hr_departments 的 FK，因員工可能未登入系統且上游部門代碼不是本機 bigint。

## 初始規則

| type | value | remark |
|---|---|---|
| department | 1029030000 | IT策略本部系統開發部 |
| department | 1029090000 | IT策略本部系統開發二部 |
| department | 1029010000 | IT策略本部資訊安全部 |
| employee | 09005001 | 額外允許同仁 |

不加入上層 1029000000，不遞迴自動加入子部門，不存 Email。四筆皆以字串作參數。

## 維護與種子

- 新增：插入不存在的 `(type,value)`；唯一鍵處理並發重複，不能產生兩條有效規則。
- 撤銷：設定 deleted_at、更新 updated_at；保留原 row。
- 恢復：維護人明確確認後清空原 row.deleted_at、更新 updated_at；不可另 insert 相同 key。
- 更改規則範圍：撤銷舊值、加入新值，不把已存在的規則偷偷變成不同員工。
- 初始資料程序只插缺少列，重跑不更改既有 remark／deleted_at，不自動復活已撤銷列。種子與 schema migration 分離，沒有啟動 seed。
- 執行維護 SQL 前先列出預期影響 key／原值，提交後核對筆數；可用既有受控 DB 工具，不新增管理 API、UI 或環境變數。
- 真實維護與備份由環境管理人操作，不提交憑證／實際信箱到 repo。本輪沒有執行此程序。

## Migration 與回滾

- 新 migration 建表、constraint、唯一鍵；同步 mysql.options.ts entity／migration 註冊、schema.sql 與 schema tests。已有通知 result 包含 skipped，不另加通知狀態或表。
- down 移除白名單表會丟失維護紀錄，只在備份且所有依賴程式已停止時執行；不以 down 作暫時繞過白名單手段。
- 回滾政策程式前停止非 production 的 server 寄信入口與 worker，避免舊版無限制寄信；先保留資料修復，不自動清空表。
- seed 回滾只處理本次實際新增且仍與 seed 後原值一致的 row；不撤銷或刪除維護人後續異動，需核對快照與影響數。

## 非持久資料

單次寄送檢查中的候選員編、可信信箱、命中規則、allowed／blocked 集合僅在記憶體使用，不新增 Redis cache、允許信箱表或批次快照。檢查開始後的規則異動於下一次檢查生效；已交 SMTP 不可追回。
