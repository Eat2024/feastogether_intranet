# 01: 白名單資料表支援信箱規則

**What to build:** 讓 `mail_recipient_whitelist` 可存放並驗證 `email` 規則：放寬規則值長度、擴充 CHECK、同步 entity 與 schema，並補維護與回滾說明。寄送政策尚未使用信箱規則，寄信行為不變。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Source:** [Spec 021](../../../specs/021-external-mail-whitelist/spec.md)、[Plan](../../../specs/021-external-mail-whitelist/plan.md)、[Data Model](../../../specs/021-external-mail-whitelist/data-model.md)、[Tasks](../../../specs/021-external-mail-whitelist/tasks.md)。

**Scope:** US3 的資料面，對應 T001–T006。

- [ ] 新 migration `MailWhitelistEmailRule1793664001000` 放寬 `value` 為 VARCHAR(255)、更新 `type`／`value` 註解，以同名重建兩條 CHECK 加入 `email`；已註冊於 `mysql.options.ts`。
- [ ] `email` 值必須為小寫、恰好一個 `@`、`@` 前後非空、不含空白或控制字元、最多 255 字元；部門仍限 50、員編仍限 20 字元。
- [ ] down 還原原欄位與 CHECK，不刪資料；有 `email` 列（含已撤銷）時 down 失敗且資料不變。
- [ ] entity type 加 `'email'`、`value` length 255，與 migration 一致；`schema.sql` 由隔離 DB 重新產生，diff 只有白名單表。
- [ ] `018 maintenance.md` 補上信箱規則格式、`example.test` 範例與回滾前置步驟；不提交真實信箱。
- [ ] `test:schema` 全數通過，含新增正負向與回滾案例；不新增資料表、欄位、索引、seed 資料或環境變數。
- [ ] 驗收通過後整合至功能整合分支，追加驗證與 commit 紀錄，再改為 resolved。

## Comments & Implementation Results

尚未實作。後續結果追加於此，保留上述驗收條件。
