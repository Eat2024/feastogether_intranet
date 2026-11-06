# 01: 可重跑的授權目錄初始化

**What to build:** 維運者透過現有隔離 console 明確初始化目前兩個子功能的權限目錄與三個初始角色；重跑有確定結果，既有角色設定及歷史資料安全保存。

**Blocked by:** [027-03](../../027-super-user-access/issues/03-narrow-repl-entry.md)

**Status:** claimed

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T001、T002、T003、T004、T005、T006、T007、T008、T009、T010。

## Acceptance Criteria

- [x] 正式目錄只有 esign／platform 與已確認的 12 項能力，platform 管理能力不可指派；同仁初始能力固定，另有文件建立者及電子簽管理員。
- [x] 真 MySQL 拒絕跨子功能角色權限／指派，同 module 同名競爭只能成功一次；停用角色占名，刪除後名稱可重用而 code 永不重用。
- [x] 角色、權限與兩種關聯具正確唯一鍵、軟刪除恢復及 scope FK；不以 JSON／單一 users.role 取代多角色關聯。
- [x] 明確 sync 執行才寫入；HTTP startup／GET 不自動初始化。第二次 sync 不重設一般角色自訂能力或停用狀態，不插重複關聯或 no-op audit。
- [x] 目錄初始化、變更與必要裁切稽核同交易，audit 失敗全部回滾，不保存員編、憑證、文件、簽名。
- [x] 空測試庫 up/down/reapply 通過；已有授權稽核或受保護資料時拒絕破壞性 down。維護 context 過期不得繞過執行。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。


### 2026-11-06 實作結果（028-01-catalog）

- 完成 T001～T010；五張授權表、雙側 scope FK、active name 唯一性、軟刪除恢復、唯讀目錄校驗、明確 console sync 與同交易白名單 audit。
- 真 MySQL schema／catalog／ConsoleModule 驗收通過，沒有 production catalog 測試子功能、逐人 baseline 寫入或啟動 seed。一般角色自訂與停用不被重跑覆蓋；同仁由程式固定。
- `pnpm -C server test --runInBand`：126 suites／1282 tests；`test:schema`：7 suites／45 tests；`test:e2e:security --testPathPatterns=authorization`：2 suites／10 tests；全部通過。
- root build／lint、client test 4項／check:bundle 通過；lint 只有既有 271 warnings、0 errors。詳細 endpoint 盤點、隔離測試環境與限制見 quickstart「028-01」。
- schema.sql 由空測試庫自動匯出；沒有寫入開發／正式資料。027 schema 歷史測試固定原版本，其餘最新 schema 驗收更新五表清單。
- catalog 服務驗證採真 DB e2e 而非內部 collaborator mock；稽核裁切與 permission modifier 是獨立單元測試。失敗案例先建立，再補實作；首輪 schema drift 與既有硬編版本預期已修正。
- 此票仍為 claimed，待 merger 合入整合分支後補 commit 並改 resolved。後續授權 guard／管理 API／業務保護尚未完成，不能正式切換。
