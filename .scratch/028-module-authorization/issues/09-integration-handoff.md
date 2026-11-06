# 09: 完成核定指派與完整保護切換驗收

**What to build:** 維運依核定名單及可演練流程切換新授權版本，保留既有身分／會話／文件／證據；所有入口確實受保護，失敗不回退全域放行。

**Blocked by:** [028-05](05-employee-role-assignment.md)、[028-07](07-lifecycle-actors.md)、[028-08](08-authorized-exports.md)、[027-08](../../027-super-user-access/issues/08-integration-handoff.md)

**Status:** ready-for-agent

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T052、T054、T055、T056、T057、T058、T059、T060。

## Acceptance Criteria

- [ ] 備份副本驗證 schema、兩次 sync／指派冪等、原 user ID／關聯／證據保持；既有員工只自動同仁，禁止從歷史建立／匯出行為升權。
- [ ] 上線前核定必要角色指派與 resolver 核對完成；repository 不儲存員編名單或秘密。
- [ ] 明確停止舊 HTTP／worker，新實例全部同 schema／catalog 版本才接流量，不混跑舊放行版本，不新增永久flag或fallback。
- [ ] catalog 不完整或任一路由漏明確分類時拒絕 readiness；實際 HTTP 驗證所有路徑的身分／能力／資源政策，不只看metadata。
- [ ] 既有 session 免重登、撤權下一請求、真 Super 業務 worker、外部簽署／公開驗證／檔案／證據回歸全部有結果；403／目標422不錯誤登出。
- [ ] response／log／audit 無憑證、員編body、完整入口、Portal raw error、簽名；不恢復已移除的簽署事件歷程。
- [ ] 只有無需保存新資料的空測試庫可down；正式以向前修復或一致備份回復保護 audit／Super 資料，失敗保持停用不全域放行。
- [ ] 適用 server lint／unit／e2e／security／schema／build 與 root client相容 build／lint完成；不能執行者明列環境限制，不以mock宣稱通過；029能力契約一致。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
