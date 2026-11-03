# Tasks: 非 production 白名單開放指定收件信箱

**Input**: `specs/021-external-mail-whitelist/` 的 spec、plan、research、data-model 與 quickstart。

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[data-model.md](data-model.md)。

**Tests**: 測試任務先於對應實作，先確認新案例在尚未實作時失敗。只使用 `feastogether_intranet_test` 前綴資料庫與合成人資／SMTP，不操作 UAT。

**Organization**: 先完成 DB 支援（US3 的資料面），再完成寄送政策（US1、US2）。僅 server，不改 client。所有任務目前均未執行。

## Phase 1: Setup

- [x] T001 依 `specs/018-nonproduction-mail-whitelist/quickstart.md` 前置條件準備隔離 MySQL 8.4 與 Redis（DB 前綴 `feastogether_intranet_test`、Redis DB 非 0），確認 `pnpm -C server test:schema` 在變更前通過，作為基線。

## Phase 2: Foundational — DB 支援信箱規則（Ticket 01）

**Purpose**: 讓 `mail_recipient_whitelist` 能存放並驗證 `email` 規則；政策尚未使用，寄送行為不變。

- [x] T002 [US3] 在 `server/test/mail-whitelist-schema.e2e-spec.ts` 先改寫與新增案例：`['email', 'a@example.test']` 由非法改合法；`email` 合法值含 255 字元地址；非法值含大寫、前後與中間空白、換行、缺 `@`、兩個 `@`、`@` 開頭或結尾、256 字元；部門 51 字元、員編 21 字元仍被拒；有 `email` 列（含已撤銷）時 `MailWhitelistEmailRule1793664001000` 的 down 失敗且資料不變，刪除後 down／up 成功。於 `server/src/infrastructure/database/mysql/mysql.options.spec.ts` 的 migration 清單加入新名稱。確認新案例失敗。
- [x] T003 [US3] 新增 `server/src/infrastructure/database/migrations/1793664001000-MailWhitelistEmailRule.ts`，依 [data-model.md](data-model.md) 以單一 `ALTER TABLE` 重建兩條同名 CHECK、放寬 `value` 至 255 並更新 `type`／`value` 註解；down 還原原定義、不刪資料。於 `server/src/infrastructure/database/mysql/mysql.options.ts` 註冊。若 MySQL 拒絕同句同名刪加或巢狀 POSIX 字元類，依 plan 改為兩句或明確字元集合，並記錄於本票。
- [x] T004 [US3] 更新 `server/src/infrastructure/mail/mail-recipient-whitelist.entity.ts`：`MailRecipientWhitelistType` 加 `'email'`，`value` length 255，註解與 migration 一致。
- [x] T005 [US3] 以隔離 DB 套用全部 migration 後依 018 方式 mysqldump 重新產生 `server/src/infrastructure/database/schema.sql`，確認 diff 只有白名單表；`pnpm -C server test:schema` 全數通過（含既有 `revertAfter` 經過新 migration down）。
- [x] T006 [US3] 更新 `specs/018-nonproduction-mail-whitelist/maintenance.md`：有效格式加入 `email`（小寫完整地址、最多 255 字元），新增範例只用 `example.test`；回滾段落加入「回滾 021 migration 前須備份並刪除所有 `type = 'email'` 列（含已撤銷）」。

**Checkpoint**: Ticket 01 可獨立合併；寄信結果與變更前相同，只是 DB 可寫入信箱規則。

## Phase 3: US1／US2 — 寄送政策套用信箱規則（Ticket 02）

**Goal**: 命中信箱規則的外部收件人可收到邀請、催簽與 OTP；只放行完整地址，全部命中時不查人資。

**Independent Test**: 新增一筆信箱規則，讓合成人資來源丟錯，OTP 與外部催簽仍寄出；同網域其他地址、plus alias、子網域、相近地址被阻擋。

- [ ] T007 [US1][US2] 在 `server/src/infrastructure/mail/mail-recipient-policy.service.spec.ts` 先新增案例：只有信箱規則時命中者允許、`other@`／`tester+uat@`／`tester@sub.`／`tester1@` 阻擋且組織樹與 `staff_emails` 呼叫 0 次；全部命中信箱規則時人資 `post` 丟錯仍允許；信箱與員編規則並存時只以未命中地址查人資並取聯集；仍有未命中者且人資故障時拋 `MailWhitelistCheckFailedError`。確認失敗。
- [ ] T008 [US1][US2] 依 plan Implementation Design 第 4 點修改 `server/src/infrastructure/mail/mail-recipient-policy.service.ts`：規則加 `emails` 集合，`loadActiveRules()` 改用依 type 取值的小函式；`allowedRecipients()` 先比對信箱規則，全部命中即回傳，否則沿用原解析並取聯集。不在政策服務重複正規化，不新增 log。通過 T007 與既有政策測試。
- [ ] T009 [US1] 在 `server/test/mail-whitelist-otp.e2e-spec.ts` 新增案例：以合成簽署人信箱建立 `email` 規則、設定 `sourceFailed = true`，OTP 回 200、可驗證、`external_otp.sent` 一筆、人資逐人查詢 0 次；`beforeEach` 一併清除該信箱規則。
- [ ] T010 [US1] 在 `server/test/mail-whitelist-worker.e2e-spec.ts` 新增案例：外部催簽收件人命中 `email` 規則且合成人資來源丟錯時，結果為 delivered 並寫入原有成功紀錄；比照既有「外部催簽被政策阻擋」案例的安排方式。

**Checkpoint**: US1、US2 驗收完成；寄送邊界、worker processor、OTP service 與 client 皆未修改。

## Phase 4: Polish & Cross-Cutting

- [ ] T011 [P] 在 `specs/018-nonproduction-mail-whitelist/spec.md`（Assumptions「不新增 email 白名單型別」、FR-002、FR-004、US4-2）、`data-model.md`（「不存 Email」）、`contracts/mail-whitelist.md`（可信收件人政策）相關段落加一行「已由 [Spec 021](../021-external-mail-whitelist/spec.md) 修訂」；不改寫 018 歷史驗證紀錄。
- [ ] T012 執行 [quickstart.md](quickstart.md) 全部指令，記錄實際結果、通過數與未驗證項目於 quickstart；server 使用 `lint:check`。
- [ ] T013 進行最後 code review（Standards 與 Spec 雙軸），修正確認的發現；逐項核對 spec FR／SC，只勾選實際完成的任務，交付摘要分述後端、migration、文件變更與限制，不部署、不對 UAT 執行 migration。

## Dependencies & Execution Order

```text
T001 → T002 → T003 → T004 → T005 → T006   (Ticket 01)
                                    ↓
             T007 → T008 → T009、T010     (Ticket 02)
                                    ↓
                     T011 → T012 → T013
```

- T009 與 T010 修改不同檔案，可並行；T011 可與 Phase 3 並行。
- Ticket 02 依賴 Ticket 01 的 entity type 與 DB CHECK，才能在 e2e 寫入 `email` 規則。

## Requirement Coverage

| 需求 | 主要任務 |
| --- | --- |
| FR-001、FR-002 | T007、T008 |
| FR-003 | T007–T010 |
| FR-004 | T009、T010 |
| FR-005 | T002、T003 |
| FR-006 | T002、T003、T006 |
| FR-007 | T005、T006（seed 不變） |
| FR-008 | 既有 018 runtime 測試；T012 重跑 |
| FR-009 | T008（不新增 log）、T013 |
| FR-010 | T002、T003、T006 |
| SC-001–SC-005 | T002、T007、T009、T010、T012 |

**任務統計**：13 項；Setup 1、Ticket 01 共 5、Ticket 02 共 4、跨功能 3。
