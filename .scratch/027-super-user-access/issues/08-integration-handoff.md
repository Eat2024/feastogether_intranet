# 08: 完成部署、回復與三入口整合驗收

**What to build:** 將已完成的登入、員工相容、網址輪換與憑證撤銷整合為可部署交付，讓維護者有明確首次部署、變更帳密及回復操作與實測證據。

**Status:** ready-for-agent

**Blocked by:** [05-shared-identity-switching](05-shared-identity-switching.md)、[06-weekly-entry-rotation](06-weekly-entry-rotation.md)、[07-credential-activation](07-credential-activation.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T052、T054、T055。

## Acceptance Criteria

- [ ] 設定範例及維運文件說明兩項 server-only 設定、hash／REPL、首次部署停舊版再 migration／初始化／開流量、帳密版本啟用與回復；不寫實際 secret，不因回退重新開放員工密碼入口。
- [ ] 文件及必要 agent 指引反映 actor 邊界及 028 前業務 403；修改 agent 文件前使用適用技能，不描述不存在的授權功能。
- [ ] 執行適用 server lint:check、unit、build、e2e、security、schema，以及 client lint/build 與 root build/lint；記錄實際結果與未執行原因，不宣稱不存在的 client 自動測試。
- [ ] 最終驗收涵蓋八小時 cookie、iframe、無效 HTML／RSC、所有一般 log 遮罩、雙實例撤銷、REPL 副作用及三入口切換；倉庫外代理部署阻擋必須解除或明列未完成，不能誤報可正式交付。
- [ ] 實作與 API／維運契約逐項核對，交付摘要分列前端、後端、migration/config、限制與證據；沒有角色表、管理 UI、OAuth 前端、029 選單或提前 028 業務放行。

## Comments & Implementation Results

（尚未開始）
