# 04: Super 維護角色與權限並查稽核

**What to build:** Super 可由 API 或 REPL 查目錄、建立與維護一般角色、配置權限並核對必要稽核，兩種入口遵守相同的版本與範圍規則。

**Blocked by:** [028-02](02-effective-permissions.md)、[027-07](../../027-super-user-access/issues/07-credential-activation.md)

**Status:** ready-for-agent

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T024、T026、T027、T028、T032、T033。

## Acceptance Criteria

- [ ] 只有有效 Super HTTP actor 或有效隔離維護 context 能管理；一般員工／電子簽管理員一律403，寫入驗 Origin，管理結果 no-store。
- [ ] 角色名稱修整後1～100字、code由後端產生且不可變，未知輸入拒絕；角色與 permission 查詢、分頁、詳細、建立、更名、停用及刪除符合契約。
- [ ] 每次實質更動驗 expectedVersion，過期409；無變更不加版／audit。同名409；仍被指派不可刪，停用保留關聯卻不授權。
- [ ] permission 完整集合只接受同 module 已登錄可指派項目，modifier 具同角色 base；同仁不得改／停／刪，platform 維護權不能指派，不能動態新增權限／子功能。
- [ ] API／REPL 共用服務與交易；成功與 audit 同時存在、失敗均回滾，查 audit 僅白名單差異且沒有修改／刪除入口。
- [ ] 正負契約驗收涵蓋輸入上限、未知欄位、安全 ID 序列化、版本與名稱衝突，不做管理前端。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
