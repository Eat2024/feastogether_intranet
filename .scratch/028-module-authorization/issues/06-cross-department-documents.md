# 06: Super 與管理員建立及管理跨部門文件

**What to build:** 一般建立者維護自己的文件，具有明確能力的管理者可合法跨部門閱讀及編輯；Super 以自身維護身分建立文件並指定有效歸屬部門，前端既有列表能正常呈現。

**Blocked by:** [028-03](03-employee-signing-boundaries.md)

**Status:** claimed

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T035、T036、T037、T038、T039、T040、T041、T042。

## Acceptance Criteria

- [ ] 文件、欄位與簽署人編輯保存 employee／super 真 actor；Super 員工 FK 為 NULL，不造假 user，不更改指定簽署人的員工關聯；NULL-aware CHECK 拒非法組合。
- [ ] 歷史有 user 記 employee、原空稽核 slot 記 legacy_unknown；document 舊最後管理者保留未知，不補造歷史，不修改人事共用稽核行為。
- [ ] Super 建立必填1～50字有效 departmentCode，Portal exact-match 取可信名稱，無效400／上游503；employee 不接受部門覆寫。
- [ ] 管理他人文件只放寬建立人／部門，保留原 creator／department、所有狀態、鎖與證據限制，寫入重新核對目前能力。
- [ ] role=all 必須 read-all，Super 預設 all、員工維持原範圍；任意 department query 不可越權。
- [ ] 既有 client 僅調整 actor DTO／nullable顯示及 super送all／employee送dep；顯示 Super user 而非假員編、0或undefined，不新增管理UI。
- [ ] 真 schema 與文件管理 e2e 通過，既有關聯／證據保持；有新受保護資料拒絕破壞性 down。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
