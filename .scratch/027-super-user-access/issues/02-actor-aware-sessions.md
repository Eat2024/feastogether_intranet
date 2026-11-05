# 02: 擴充可辨識操作者的共用會話，保持員工相容

**What to build:** 先將既有會話擴充為可辨識 employee／super_user 的共用生命週期，使後續三種入口能原子替換身分；完成後以既有員工回歸與隔離整合測試證明相容性。

**Status:** ready-for-agent

**Blocked by:** [01-super-user-credential-config](01-super-user-credential-config.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T001、T002、T004、T006、T007、T008、T009、T010、T012、T013、T014、T053。

**切片說明:** 這是 `to-tickets` 允許先完成的 prefactoring。它同時涵蓋持久約束、repository、會話交易與驗證；不把單純建表當成功能交付，也不提前開放 Super user 業務權限。新登入路徑與前端尚未公開。

## Acceptance Criteria

- [ ] 核對現有變更與測試入口，將新增 security/schema 測試納入實際執行範圍；所有 DB 測試只用受保護的隔離測試庫。
- [ ] 增量擴充既有會話並建立入口 singleton／append-only 安全事件；落實資料模型全部型別、NULL、CHECK、FK、unique 與索引約束，保留既有員工、文件關聯及歷史資料。
- [ ] employee 保留原 user 回應；super_user 無員工 FK、無偽造員編，僅 employee 設員工 request／CLS context。查會話使用可接受非員工的關聯方式。
- [ ] 會話固定八小時不滑動；過期、撤銷、員工停用或維護版本失配均拒絕。每次驗維護會話查 DB 有效版本，不使用權限／版本快取。
- [ ] 撤舊、簽新、replacement 關聯與成功安全事件同交易；固定鎖序，失敗 rollback 保留舊會話，已被替換舊 token 再使用回 409。cookie 原值只在 commit 後交回呼叫端。
- [ ] 安全事件僅白名單種類與欄位，credential 拒絕另短交易；不保存帳密、入口、token、IP、UA、body 或文件資料，不恢復簽署事件鏈。
- [ ] 實際驗證空庫與既有資料 migration、apply/down/reapply、約束與 employee 回填；有維護事件或維護 session 時拒絕破壞性 down。以專案工具產出 schema 快照。
- [ ] 共用會話的行為測試及既有員工回歸通過；本張不要求尚未存在的隱藏登入頁或週排程。

## Comments & Implementation Results

（尚未開始）
