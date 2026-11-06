# 01: 可重跑的授權目錄初始化

**What to build:** 維運者透過現有隔離 console 明確初始化目前兩個子功能的權限目錄與三個初始角色；重跑有確定結果，既有角色設定及歷史資料安全保存。

**Blocked by:** [027-03](../../027-super-user-access/issues/03-narrow-repl-entry.md)

**Status:** ready-for-agent

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T001、T002、T003、T004、T005、T006、T007、T008、T009、T010。

## Acceptance Criteria

- [ ] 正式目錄只有 esign／platform 與已確認的 12 項能力，platform 管理能力不可指派；同仁初始能力固定，另有文件建立者及電子簽管理員。
- [ ] 真 MySQL 拒絕跨子功能角色權限／指派，同 module 同名競爭只能成功一次；停用角色占名，刪除後名稱可重用而 code 永不重用。
- [ ] 角色、權限與兩種關聯具正確唯一鍵、軟刪除恢復及 scope FK；不以 JSON／單一 users.role 取代多角色關聯。
- [ ] 明確 sync 執行才寫入；HTTP startup／GET 不自動初始化。第二次 sync 不重設一般角色自訂能力或停用狀態，不插重複關聯或 no-op audit。
- [ ] 目錄初始化、變更與必要裁切稽核同交易，audit 失敗全部回滾，不保存員編、憑證、文件、簽名。
- [ ] 空測試庫 up/down/reapply 通過；已有授權稽核或受保護資料時拒絕破壞性 down。維護 context 過期不得繞過執行。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
