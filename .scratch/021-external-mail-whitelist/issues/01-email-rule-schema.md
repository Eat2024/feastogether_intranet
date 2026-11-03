# 01: 白名單資料表支援信箱規則

**What to build:** 讓 `mail_recipient_whitelist` 可存放並驗證 `email` 規則：放寬規則值長度、擴充 CHECK、同步 entity 與 schema，並補維護與回滾說明。寄送政策尚未使用信箱規則，寄信行為不變。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Source:** [Spec 021](../../../specs/021-external-mail-whitelist/spec.md)、[Plan](../../../specs/021-external-mail-whitelist/plan.md)、[Data Model](../../../specs/021-external-mail-whitelist/data-model.md)、[Tasks](../../../specs/021-external-mail-whitelist/tasks.md)。

**Scope:** US3 的資料面，對應 T001–T006。

- [x] 新 migration `MailWhitelistEmailRule1793664001000` 放寬 `value` 為 VARCHAR(255)、更新 `type`／`value` 註解，以同名重建兩條 CHECK 加入 `email`；已註冊於 `mysql.options.ts`。
- [x] `email` 值必須為小寫、恰好一個 `@`、`@` 前後非空、不含空白或控制字元、最多 255 字元；部門仍限 50、員編仍限 20 字元。
- [x] down 還原原欄位與 CHECK，不刪資料；有 `email` 列（含已撤銷）時 down 失敗且資料不變。
- [x] entity type 加 `'email'`、`value` length 255，與 migration 一致；`schema.sql` 由隔離 DB 重新產生，diff 只有白名單表。
- [x] `018 maintenance.md` 補上信箱規則格式、`example.test` 範例與回滾前置步驟；不提交真實信箱。
- [x] `test:schema` 全數通過，含新增正負向與回滾案例；不新增資料表、欄位、索引、seed 資料或環境變數。
- [x] 驗收通過後整合至功能整合分支，追加驗證與 commit 紀錄，再改為 resolved。

## Comments & Implementation Results

後續結果追加於此，保留上述驗收條件。

### 2026-11-03 實作結果（`implement/spec021-01`）

- 實作 commit：`1aa4f65`（`implement/spec021-01`），pre-commit hook（root lint、server 單元測試）通過。
- 基準：整合分支 `docs/spec-021-external-mail-whitelist` tip `54e298b`；隔離 MySQL 8.4.11（`127.0.0.1:13321`、`feastogether_intranet_test*`），未操作 UAT。
- T001 基線：變更前 `pnpm -C server test:schema` 4 suites／24 tests 通過。
- TDD 紅燈：`mail-whitelist-schema.e2e-spec.ts` 合法 `email` 寫入被 `chk_mail_recipient_whitelist_type` 拒絕；回滾案例因找不到 `MailWhitelistEmailRule1793664001000` 失敗；`mysql.options.spec.ts` migration 清單缺新名稱失敗。
- 綠燈：新增 migration、註冊與 entity 後三者通過。另以變異測試把 regex 結尾改回 `$`，非法值案例失敗（見下方差異），還原 `\z` 後通過。
- 新增／改寫案例：`email` 合法值含 255 字元；拒絕大寫、前後與中間空白、結尾換行、BEL 控制字元、缺 `@`、兩個 `@`、`@` 開頭或結尾、256 字元；部門 51、員編 21 仍被拒。回滾案例：有效與已撤銷信箱列都會讓 down 因 CHECK 失敗且資料、migration 紀錄不變；刪除後 down 的 `SHOW CREATE TABLE` 與未套用 021 的 DB 完全相同，再 up 可寫入信箱。
- `schema.sql` 由隔離 DB 套用全部 migration 後 mysqldump 產生，diff 只有 `mail_recipient_whitelist` 的 `type`／`value` 與兩條 CHECK。
- 驗證：`pnpm -C server test:schema` 4 suites／25 tests 通過；`pnpm -C server test --runInBand` 109 suites／1,081 tests 通過；`pnpm -C server lint:check` 0 errors（268 warnings 皆在未變更檔案）；`pnpm -C server build` 通過。
- 未新增資料表、欄位、索引、seed 資料或環境變數；寄送政策仍依 type 篩選，信箱列在 Ticket 02 前不影響寄信。

與 plan 的差異（已同步 021 plan／data-model）：

1. 同一 `ALTER TABLE` 內同名 CHECK 先刪後加：MySQL 8.4.11 接受，維持單句，不需兩句備案。
2. 巢狀 `[:space:]`／`[:cntrl:]`：可用（空白、Tab、全形空白、BEL 皆被拒），不需明確字元集合備案。但 ICU 的 `$` 在結尾換行前也成立，`'a@example.test\n'` 會被收下，因此 regex 結尾改用 `\z`（SQL 字串寫作 `'\\z'`）。
3. `server/test/schema-migration.e2e-spec.ts` 的部門 migration 案例原本直接 `undoLastMigration()`，新 migration 成為最新後會退錯版本；改為先 `revertAfter(ds, 'DepartmentDocumentVisibility1793664000000')`，沿用既有慣例。plan 檔案表已補列。
4. 018 maintenance 回滾段落另附刪除信箱列的交易 SQL（先快照、核對 `ROW_COUNT()`），範例只用 `tester@example.test`。

### 2026-11-03 整合

- 主控檢視 migration 與 diff 後，以 fast-forward 整合至 `docs/spec-021-external-mail-whitelist`（`54e298b..a7dbc7e`），無衝突；Status 改為 resolved。
