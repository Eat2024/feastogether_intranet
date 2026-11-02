# 02: 部門欄位與資料庫遷移

**What to build:** 新增員工可信部門代碼及文件建立部門快照欄位，保持舊資料可相容。

**Blocked by:** [01](./01-baseline.md)

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；FR-003/004；data-model.md。

**Tasks:** T003、T004、T005；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [ ] 三欄型別、nullable、代碼 utf8mb4_0900_bin、索引與 entity／migration 註冊／schema.sql 一致；保留前導零、大小寫與原 departmentId 外鍵。
- [ ] 測試先驗證預期失敗，再通過 schema metadata、精確比較、NULL 舊資料及 up/down/up；既有文件證據不變。
- [ ] migration 不含 IT 預設值、HR 呼叫或 UAT 資料回填。

## 原始任務範圍

- [ ] T003 在 `server/src/features/users/entities/schema-metadata.spec.ts`、`server/src/features/esign/entities/schema-metadata.spec.ts` 與 `server/test/schema-migration.e2e-spec.ts` 補三欄、字串精確比較、NULL 舊資料、索引及 up/down/up 測試；驗證回滾不修改既有文件證據，先確認預期失敗。
- [ ] T004 在 `server/src/features/users/entities/user.entity.ts` 與 `server/src/features/esign/entities/esign-document.entity.ts` 新增 departmentCode／createdByDepartmentCode／createdByDepartmentName，逐字落實 data-model 約束：「varchar(50), nullable」「varchar(50), nullable」「varchar(150), nullable」及「新建成功必須非空」；代碼使用 `utf8mb4_0900_bin`，保持字串、前導零及大小寫，原 departmentId 外鍵不變。
- [ ] T005 建立 `server/src/infrastructure/database/migrations/1793664000000-DepartmentDocumentVisibility.ts`，於 `server/src/infrastructure/database/mysql/mysql.options.ts` 註冊，並更新 `server/src/infrastructure/database/schema.sql`；新增三個 nullable 欄位與 `idx_esign_documents_department_deleted_updated_id`（created_by_department_code, deleted_at, updated_at, id），down 反向移除；不得加 IT 預設值、呼叫 HR 或執行 UAT 回填，通過 T003。

## 實作驗證紀錄

2026-11-02：實作與驗證完成，待 root 提交整合後改 resolved。

- TDD：metadata 先因新欄位不存在失敗（2 failed／62 passed）；新增 migration E2E 先因 Unknown column department_code 失敗。
- 三欄、部門排序索引、migration 註冊及 schema dump 一致；migration timestamp 改為 1793664000000，避開 Spec 018 已使用的 1793577600000。
- `pnpm -C server test --runInBand --runTestsByPath src/features/users/entities/schema-metadata.spec.ts src/features/esign/entities/schema-metadata.spec.ts`：2 suites／64 tests 通過。
- 專用 MySQL 127.0.0.1:13317、DB feastogether_intranet_test017 前綴環境下 `pnpm -C server test:schema`：3 suites／15 tests 通過，涵蓋 NULL 舊資料、前導零／大小寫／尾端空白精確比較、索引順序、up/down/up、既有簽署 payload 與業務時間不變、無 schema drift。
- `pnpm -C server build` 通過；本票修改 TS 檔案的 ESLint 通過（0 errors／warnings）；git diff --check 通過。
- schema.sql 由隔離 DB 套用 migration 後以容器 mysqldump 匯出，只增加三欄與一索引。
- User.departmentName 與既有 nullable EsignSigner.departmentSnapshot 的 TS 型別補上 null，供後續缺值清除並保持指派相容，未改這兩個既有欄位的 DB 定義。
- 舊 migration 回滾案例改明列既有業務／證據欄位比較，避免本次新增欄位隨 down 移除造成假失敗；原回滾拒絕與資料不變斷言保留。
- 未操作 UAT、未回填部門、未呼叫 HR；新建成功必須非空由後續 ticket 06 的交易規則驗證。

整合：直接提交功能整合分支，commit 以 `git log --grep="feat(spec017): add department schema"` 定位。
