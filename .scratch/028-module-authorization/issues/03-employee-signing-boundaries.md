# 03: 同仁可閱讀與本人簽署，受限操作全部拒絕

**What to build:** 有效同仁可完成同部門閱讀和本人簽署／拒簽／副本流程；後端所有既有電子簽入口依能力保護，不讓未授權建立、匯出或個人副本旁路通過。

**Blocked by:** [028-02](02-effective-permissions.md)、[027-05](../../027-super-user-access/issues/05-shared-identity-switching.md)

**Status:** ready-for-agent

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T016、T017、T018、T019。

## Acceptance Criteria

- [ ] 無額外角色員工可讀同部門既有可見狀態的列表／詳情／來源 PDF；仍裁切簽名、邀請及敏感欄位，不可見資源不洩漏存在。
- [ ] 本人跨部門簽署、拒簽與副本依本人指派、期限、狀態與證據規則判斷；缺可信部門不會一律否定另行成立的本人資格。
- [ ] 同仁不能建立／管理文件、查候選人目錄、一般匯出、export view、一般歷史／下載；全部入口有對應能力，服務分支不能用寬鬆 OR 放行。
- [ ] 同部門也不能取得別人的個人副本，含既有 departmentFile 與 pdf 歷史；管理員／Super 不能代簽或代拒簽。
- [ ] 外部邀請／OTP 與公開驗證保持原邊界，Super cookie 不產生外部本人資格。
- [ ] OAuth／WebView 的同一種 session 均通過正向與負向 e2e，未完成 actor 改造的 Super 業務仍拒絕。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
