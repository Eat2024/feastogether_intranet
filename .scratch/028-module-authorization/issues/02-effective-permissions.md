# 02: 同一會話查詢即時有效能力

**What to build:** 當前操作者可查自己的最小有效能力，維運者可辨識 baseline 與 explicit 來源；後端逐請求讀取角色聯集，作為後續業務與選單的共同授權來源。

**Blocked by:** [028-01](01-catalog-initialization.md)、[027-04](../../027-super-user-access/issues/04-hidden-login.md)

**Status:** ready-for-agent

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T011、T012、T013、T014、T015、T020、T021、T022、T023、T053。

## Acceptance Criteria

- [ ] 新／既有有效員工沒有任何指派也有固定同仁能力，已有額外角色仍保留同仁，GET 前後沒有新增關聯。
- [ ] 多角色能力取聯集，重複 grant 撤一個仍保留；跨 module 同名角色不互授，停用／刪除／不在 compiled catalog 的 grant 排除。
- [ ] Super 回全部已登錄能力；employee 停用／刪除或 session 無效仍拒絕。角色名稱、cookie、前端傳入值不能決定能力。
- [ ] 本人能力契約只含 actor 與排序去重 modules／permissions，no-store，不含完整角色、其他員工或任何憑證，供 029 直接使用。
- [ ] 角色／權限／指派異動提交後，兩服務實例的舊 session 下一請求讀到新權限；交易目前讀沒有長快照或授權快取回退。已受理工作不承諾取消。
- [ ] guard 明確區分登入即可、全部／任一能力與 Super-only；403 不等同失效登入，資源不可見仍404，catalog／DB 不可用503。
- [ ] REPL 有效能力查詢與 HTTP 同 resolver，清楚標出 baseline／explicit；讀取不自動 sync、不依賴即時 Portal。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
