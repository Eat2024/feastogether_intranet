# 02: 同一會話查詢即時有效能力

**What to build:** 當前操作者可查自己的最小有效能力，維運者可辨識 baseline 與 explicit 來源；後端逐請求讀取角色聯集，作為後續業務與選單的共同授權來源。

**Blocked by:** [028-01](01-catalog-initialization.md)、[027-04](../../027-super-user-access/issues/04-hidden-login.md)

**Status:** resolved

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T011、T012、T013、T014、T015、T020、T021、T022、T023、T053。

## Acceptance Criteria

- [x] 新／既有有效員工沒有任何指派也有固定同仁能力，已有額外角色仍保留同仁，GET 前後沒有新增關聯。
- [x] 多角色能力取聯集，重複 grant 撤一個仍保留；跨 module 同名角色不互授，停用／刪除／不在 compiled catalog 的 grant 排除。
- [x] Super 回全部已登錄能力；employee 停用／刪除或 session 無效仍拒絕。角色名稱、cookie、前端傳入值不能決定能力。
- [x] 本人能力契約只含 actor 與排序去重 modules／permissions，no-store，不含完整角色、其他員工或任何憑證，供 029 直接使用。
- [x] 角色／權限／指派異動提交後，兩服務實例的舊 session 下一請求讀到新權限；交易目前讀沒有長快照或授權快取回退。已受理工作不承諾取消。
- [x] guard 明確區分登入即可、全部／任一能力與 Super-only；403 不等同失效登入，資源不可見仍404，catalog／DB 不可用503。
- [x] REPL 有效能力查詢與 HTTP 同 resolver，清楚標出 baseline／explicit；讀取不自動 sync、不依賴即時 Portal。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。


### 2026-11-07 實作與驗證

- 完成本票全部10項tasks；本人HTTP、核心resolver、ALL/ANY/Super-only guard、交易current read、REPL來源及錯誤對照已接入。
- 測試seams沿既有spec/ticket：純能力聯集介面、真MySQL+session/Fastify、獨立pool雙實例、ConsoleModule閉包；未建立mock權限後門。
- 紅綠紀錄：本人HTTP首先因缺helper/路由實作失敗，完成後通過；REPL來源重疊案例先因差集遺失baseline grant失敗，改為同一份有效grant投影後通過。
- 全單元127 suites/1285 tests；root build/lint與client bundle通過。授權定向10項、全security重跑24 suites/188 tests均通過；環境時鐘失敗與修正詳見quickstart「028-02」。
- 未宣告的舊入口仍保留027保護；完整esign矩陣與readiness待後續票，不宣稱可正式切換。正式管理API變更路徑的雙實例覆驗由028-05/T034接續。
- status保留claimed，等待整合分支合併後由merger標resolved。

### 2026-11-07 整合紀錄

- 實作 commit `3ae12bb`（`028-02-permissions`）已 fast-forward 合入 `028-module-authorization`；已核對上述驗收與 quickstart 紀錄，本票狀態改為 `resolved`。
- 後續 028-03／028-04 可基於此整合版本開始；正式管理 API 的雙實例覆驗與全電子簽保護仍依後續 tickets 完成，不代表完整 028 已可正式切換。
