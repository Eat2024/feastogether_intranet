# Implementation Plan: 非 production 白名單開放指定收件信箱

**Branch**: `docs/spec-021-external-mail-whitelist` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: `specs/021-external-mail-whitelist/spec.md`

## Summary

在 `mail_recipient_whitelist` 新增 `email` 規則類型。政策服務先以信箱規則比對收件地址，全部命中就直接回傳，不查人資來源；仍有未命中者才走 Spec 018 原本的部門／員編解析，兩者取聯集。資料庫以一支 migration 放寬 `value` 至 255 字元並擴充兩條 CHECK。

寄送邊界（guarded sender）、worker、OTP、HTTP 與 client 都不改。不新增資料表、欄位、環境變數、API、快取或依賴。

## Technical Context

**Language/Version**: TypeScript；沿用 workspace 版本。

**Primary Dependencies**: 既有 NestJS 11、TypeORM 0.3、MySQL 8.4；不新增套件。

**Storage**: 既有 `mail_recipient_whitelist`；修改 `value` 長度、`type`／`value` 註解與兩條 CHECK，不新增欄位或索引。

**Testing**: 政策服務 Jest 單元測試；`test:schema` 的白名單 schema／migration；`test:e2e`、`test:e2e:security` 各補一個 OTP 與外部催簽案例。

**Target Platform**: 非 production 的 server 與 worker；production 不讀白名單。

**Project Type**: pnpm workspace，本次僅 server。

**Performance Goals**: 收件人全部命中信箱規則時，人資查詢 0 次；其他情況與 Spec 018 相同。

**Constraints**: 信箱規則值屬個資，repo 只放 `example.test` 合成地址；log／錯誤不輸出規則內容。

**Scale/Scope**: 一支 migration、一個 entity、一個政策服務方法，加對應測試與文件。

## Constitution Check

| 原則 | 設計前／後結果 |
| --- | --- |
| KISS／YAGNI | 通過：沿用既有表與政策服務，只多一種規則類型；不做網域、萬用字元或管理介面。 |
| Server 權威 | 通過：判定仍在 server 共用寄送邊界，HTTP 與 worker 同一路徑。 |
| 最小揭露 | 通過：不新增 log；既有錯誤只含穩定 reasonCode，不含規則值。 |
| 清楚邊界 | 通過：只改 `infrastructure/mail` 與 DB schema，features、worker、client 不動。 |
| 驗證 | 通過：單元測試覆蓋比對規則，schema 測試覆蓋 CHECK 與回滾，e2e 覆蓋 HTTP 與 worker 各一條路徑。 |
| 流程 | 通過：本次停在 plan，待使用者確認後才建立 tasks 與程式。 |

無 constitution 例外。

## Project Structure

### Documentation (this feature)

```text
specs/021-external-mail-whitelist/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── checklists/requirements.md
```

### Source Code (repository root)

| 位置 | 預計變更 |
| --- | --- |
| `server/src/infrastructure/database/migrations/1793664001000-MailWhitelistEmailRule.ts` | 新 migration：`value` 放寬 255、更新註解、以同名重建兩條 CHECK 加入 `email`；down 還原原定義。 |
| `server/src/infrastructure/database/mysql/mysql.options.ts` | 註冊新 migration。 |
| `server/src/infrastructure/database/schema.sql` | 同步表定義。 |
| `server/src/infrastructure/mail/mail-recipient-whitelist.entity.ts` | `MailRecipientWhitelistType` 加 `'email'`；`value` length 255、註解更新。 |
| `server/src/infrastructure/mail/mail-recipient-policy.service.ts` | 規則多一組 `emails`；先比對信箱規則，剩餘地址才解析部門／員編。 |
| `server/src/infrastructure/mail/mail-recipient-policy.service.spec.ts` | 新增信箱規則案例。 |
| `server/src/infrastructure/database/mysql/mysql.options.spec.ts` | migration 清單加新名稱。 |
| `server/test/mail-whitelist-schema.e2e-spec.ts` | `email` 由非法改合法；新增信箱格式正負向與回滾案例。 |
| `server/test/schema-migration.e2e-spec.ts` | 部門 migration 案例先 `revertAfter` 固定在自身版本再 down（新 migration 成為最新後必要，Ticket 01 補列）。 |
| `server/test/mail-whitelist-otp.e2e-spec.ts` | 信箱規則命中且人資來源故障時 OTP 仍可寄出並驗證。 |
| `server/test/mail-whitelist-worker.e2e-spec.ts` | 外部催簽命中信箱規則時人資來源故障仍 delivered。 |
| `specs/018-nonproduction-mail-whitelist/{spec.md,data-model.md,contracts/mail-whitelist.md,maintenance.md}` | 加註被 021 修訂之處；maintenance 補信箱規則格式、範例與回滾前置步驟。 |

不需變更：`guarded-invitation-mail-sender.service.ts`（已在呼叫政策前正規化地址）、`mail-recipient-whitelist.repository.ts`（已讀全部有效規則）、`seed-mail-recipient-whitelist.sql`（初始資料不含信箱）、worker processor、OTP service、client、`.env.example`。

**Structure Decision**: 留在既有 `infrastructure/mail`，不新增 module、repository 或 helper 檔。

## Implementation Design

1. **Migration up**：單一 `ALTER TABLE` 依序 `DROP CHECK` 兩條、`MODIFY type`（只改註解）、`MODIFY value VARCHAR(255)`、`ADD CONSTRAINT` 同名兩條 CHECK。MySQL 8 的 InnoDB DDL 為原子操作，失敗不會留下半套。若 MySQL 拒絕同一 statement 內同名先刪後加，改為兩個 statement（先刪與改欄位、再加回），以 schema 測試確認。定義見 [data-model.md](data-model.md)。實測（Ticket 01，MySQL 8.4.11）：同句同名刪加可行，維持單一 `ALTER TABLE`；巢狀 POSIX 字元類可用，但 regex 結尾錨點須用 `\z`（ICU 的 `$` 會在結尾換行前成立）。
2. **Migration down**：同樣單一 `ALTER TABLE` 還原 VARCHAR(50) 與原 CHECK。仍有 `email` 列（含已撤銷）時，MySQL 會因 CHECK 拒絕而整句失敗，不靜默刪資料；維護人須先備份並刪除信箱規則列再回滾（寫入 018 maintenance）。
3. **Entity**：type union 加 `'email'`，`value` length 改 255，兩個欄位註解與 migration 一致。
4. **政策服務**：

   ```ts
   interface RecipientWhitelistRules {
     employeeIds: ReadonlySet<string>;
     departmentIds: ReadonlySet<string>;
     emails: ReadonlySet<string>;
   }

   async allowedRecipients(emails: readonly string[]): Promise<Set<string>> {
     try {
       const rules = await this.loadActiveRules();
       const allowed = new Set(emails.filter((email) => rules.emails.has(email)));
       const remaining = emails.filter((email) => !allowed.has(email));
       if (!remaining.length) return allowed;
       const employeeIds = await this.collectCandidateEmployeeIds(rules);
       if (!employeeIds.size) return allowed;
       const matched = await this.matchRecipientEmails(employeeIds, remaining);
       return new Set([...allowed, ...matched]);
     } catch {
       throw new MailWhitelistCheckFailedError();
     }
   }
   ```

   `loadActiveRules()` 改用一個小函式依 type 取值集合，避免三段重複的 filter／map。收件地址已由 guarded sender 正規化，DB CHECK 保證規則值為小寫，直接 `Set.has` 比對即可，不在政策服務重複正規化。
5. **文件**：018 各文件只在相關段落加一行「已由 Spec 021 修訂」並連結，不改寫 018 歷史驗證紀錄。

## Validation Strategy

- 單元：只有信箱規則時命中者允許、同網域／plus alias／子網域／相近地址阻擋，組織樹與 `staff_emails` 呼叫 0 次；全部命中信箱規則時人資來源丟錯仍允許；信箱與員編規則並存時只拿未命中地址查人資並取聯集；仍有未命中者且人資故障時拋 `MailWhitelistCheckFailedError`。
- Schema：`email` 合法值（含 255 字元）可寫入；大寫、前後或中間空白、換行、缺 `@`、兩個 `@`、`@` 開頭或結尾、256 字元被拒；部門仍限 50、員編仍限 20；有信箱列時 down 失敗且資料不變，刪除後 down／up 成功。既有 `revertAfter` 測試會自動經過新 migration 的 down。
- E2E：OTP 與外部催簽各一案，安排信箱規則並讓合成人資來源丟錯，確認寄出、稽核與 Spec 018 結果一致。
- 指令見 [quickstart.md](quickstart.md)。

## Complexity Tracking

無違反 constitution 的複雜度例外。
