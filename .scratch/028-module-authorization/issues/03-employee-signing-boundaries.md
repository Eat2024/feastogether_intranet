# 03: 同仁可閱讀與本人簽署，受限操作全部拒絕

**What to build:** 有效同仁可完成同部門閱讀和本人簽署／拒簽／副本流程；後端所有既有電子簽入口依能力保護，不讓未授權建立、匯出或個人副本旁路通過。

**Blocked by:** [028-02](02-effective-permissions.md)、[027-05](../../027-super-user-access/issues/05-shared-identity-switching.md)

**Status:** claimed

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T016、T017、T018、T019。

## Acceptance Criteria

- [x] 無額外角色員工可讀同部門既有可見狀態的列表／詳情／來源 PDF；仍裁切簽名、邀請及敏感欄位，不可見資源不洩漏存在。
- [x] 本人跨部門簽署、拒簽與副本依本人指派、期限、狀態與證據規則判斷；缺可信部門不會一律否定另行成立的本人資格。
- [x] 同仁不能建立／管理文件、查候選人目錄、一般匯出、export view、一般歷史／下載；全部入口有對應能力，服務分支不能用寬鬆 OR 放行。
- [x] 同部門也不能取得別人的個人副本，含既有 departmentFile 與 pdf 歷史；管理員／Super 不能代簽或代拒簽。
- [x] 外部邀請／OTP 與公開驗證保持原邊界，Super cookie 不產生外部本人資格。
- [x] OAuth／WebView 的同一種 session 均通過正向與負向 e2e，未完成 actor 改造的 Super 業務仍拒絕。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。

- 2026-11-07：完成 T016–T019。七組內部 controller 依能力矩陣宣告；export view、Excel／ZIP 下載分支於 service 驗實際能力。一般閱讀不再把缺 export.read 的員工標成可匯出。
- 本人 completed-file 與 pdf 歷史改驗 employee 指派，取消以同部門／建立人取他人副本的旁路；本人缺部門仍可簽署與取副本。簽署／拒簽保留原本人、期限、狀態與證據規則，Super 尚未 actor 改造入口仍403。
- 新增真 DB／HTTP 授權矩陣 e2e；既有 security business fixtures 明確授予 document_creator，沒有 production fallback 或 baseline 升權。單元測試 127 suites／1285 tests、server build、lint（0 errors）通過。完整 security 最終結果見 quickstart 028-03。
