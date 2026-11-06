# Spec 028 tickets 索引

來源：[Spec](../../specs/028-module-authorization/spec.md)、[Tasks](../../specs/028-module-authorization/tasks.md)。使用者於 2026-11-06 確認既有 9 張拆分並要求建立正式本機 tickets；共涵蓋 60 項 tasks，每項只有一張主要負責票。

整合分支：`028-module-authorization`，基於 `origin/027-super-user-access` 的 `f01be80c059137e63b25e50f794c75732e9ea47c` 建立。027 尚未合入 dev 不阻擋本分支開工；後續同步 027 修正，最終交付須通過 027 與 028 整合驗收。

所有票單初始狀態為 `ready-for-agent`，這不代表依賴已解除；開始前須確認所有前置票為 `resolved`。完成驗收並合入本功能整合分支後才改為 `resolved`，追加驗證與 commit 紀錄。

| Ticket | 交付行為 | Blocked by | Tasks 數量 |
| --- | --- | --- | ---: |
| [028-01](issues/01-catalog-initialization.md) | 可重跑的授權目錄初始化 | 027-03 | 10 |
| [028-02](issues/02-effective-permissions.md) | 同一會話查詢即時有效能力 | 028-01、027-04 | 10 |
| [028-03](issues/03-employee-signing-boundaries.md) | 同仁可閱讀與本人簽署，受限操作全部拒絕 | 028-02、027-05 | 4 |
| [028-04](issues/04-role-permission-management.md) | Super 維護角色與權限並查稽核 | 028-02、027-07 | 6 |
| [028-05](issues/05-employee-role-assignment.md) | 預先指派有效員工角色與即時撤銷 | 028-04 | 5 |
| [028-06](issues/06-cross-department-documents.md) | Super 與管理員建立及管理跨部門文件 | 028-03 | 8 |
| [028-07](issues/07-lifecycle-actors.md) | 管理者執行文件生命週期並保留真實操作者 | 028-06 | 5 |
| [028-08](issues/08-authorized-exports.md) | 授權一般匯出與下載，封閉個人副本旁路 | 028-06 | 4 |
| [028-09](issues/09-integration-handoff.md) | 完成核定指派與完整保護切換驗收 | 028-05、028-07、028-08、027-08 | 8 |

## 執行順序與交付界線

- 先執行 028-01；其後 028-02，再分為 028-03 → 028-06 → 028-07／028-08，以及 028-04 → 028-05；全部匯入 028-09。
- 028-06 可用明確角色 fixtures 驗證，正式切換仍需 028-05 的核定指派。
- 028-07 與 028-08 的共用 schema、migration 與 mapper 變更須協調、序列整合。
- 028-02 完成後可交接 029 的本人能力契約；不代表完整授權已可正式上線。
- 沿用 027 的登入、會話與隔離 console；不另造登入、不新增管理前端、不把 mock 功能算作正式交付。
- 本次只有票單建立與靜態驗證，尚未實作功能、執行 migration 或宣稱功能測試通過。

## 靜態驗證

9 張票完整涵蓋 T001～T060，沒有缺漏或重複主要歸屬；依賴無循環，來源與前置票單連結均存在。正式狀態以各票為準，原提案保留作為拆分依據。
