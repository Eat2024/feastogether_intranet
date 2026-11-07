# 09: 完成核定指派與完整保護切換驗收

**What to build:** 維運依核定名單及可演練流程切換新授權版本，保留既有身分／會話／文件／證據；所有入口確實受保護，失敗不回退全域放行。

**Blocked by:** [028-05](05-employee-role-assignment.md)、[028-07](07-lifecycle-actors.md)、[028-08](08-authorized-exports.md)、[027-08](../../027-super-user-access/issues/08-integration-handoff.md)

**Status:** resolved

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T052、T054、T055、T056、T057、T058、T059、T060。

## Acceptance Criteria

- [x] 備份副本驗證 schema、兩次 sync／指派冪等、原 user ID／關聯／證據保持；既有員工只自動同仁，禁止從歷史建立／匯出行為升權。
- [ ] 上線前核定必要角色指派與 resolver 核對完成；repository 不儲存員編名單或秘密。
- [ ] 明確停止舊 HTTP／worker，新實例全部同 schema／catalog 版本才接流量，不混跑舊放行版本，不新增永久flag或fallback。
- [x] catalog 不完整或任一路由漏明確分類時拒絕 readiness；實際 HTTP 驗證所有路徑的身分／能力／資源政策，不只看metadata。
- [x] 既有 session 免重登、撤權下一請求、真 Super 業務 worker、外部簽署／公開驗證／檔案／證據回歸全部有結果；403／目標422不錯誤登出。
- [x] response／log／audit 無憑證、員編body、完整入口、Portal raw error、簽名；不恢復已移除的簽署事件歷程。
- [x] 只有無需保存新資料的空測試庫可down；正式以向前修復或一致備份回復保護 audit／Super 資料，失敗保持停用不全域放行。
- [x] 適用 server lint／unit／e2e／security／schema／build 與 root client相容 build／lint完成；不能執行者明列環境限制，不以mock宣稱通過；029能力契約一致。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。

### 2026-11-07 實作與隔離驗收

- HTTP完整controller宣告／catalog與schema集合readiness；worker async provider在Bull consumer及scheduler lifecycle前拒絕缺目錄。Guard移除漏宣告放行並拒絕不合法runtime metadata。console保持無gate與無啟動sync。
- 新增cutover／readiness／routes／privacy真MySQL與HTTP驗收：027全合成備份完整還原、25migrations、兩次sync與合成核定指派、既有ID／關聯／證據／session、即時撤權、77實際路由401/403/404/Public矩陣、Pino/audit裁切與403/422不登出。
- 027 logout沿Public＋Origin保留匿名／失效cookie冪等200；GET session改AuthenticatedOnly。契約記錄相容理由與真HTTP結果；401實際code修為UNAUTHORIZED。
- 合併legacy fixture commit `19d1577` 與輕量重播修復 `bd7a59f`，不放寬本人副本或大型payload SQL斷言；舊登入helper無隱含升權。reconnect特殊測試另以專用Redis16322/DB9驗證後清除容器。
- 09沒有新增migration、DB表、環境變數、cookie、排程、flag或fallback；028既有25migrations保持一致。沒有增加管理UI或將client mock功能描述為正式完成。

### 外部維運前置（刻意保留未勾）

真實核定員工名單與部署未獲執行指示，本次只使用合成核定fixture。上線前仍須核定額外角色、resolver逐人核對、027代理/CDN/APM入口log遮罩與來源限制、DB與檔案儲存一致備份、停止所有舊HTTP/worker後以同版本啟動。流程已寫入operations，沒有宣稱正式窗口已完成；repository實作／隔離驗收與正式部署前置分開交付。

### 最終驗證

- server unit129 suites／1310 tests；完整business56 suites／569 tests，預設skip的專用reconnect另跑1suite／1test通過。
- 完整security修正Swagger描述後38 suites／226 tests全通過；完整schema10 suites／49 tests全通過。完整root build、root lint（server271既有warnings／0errors，client lint通過）、client4tests與最後bundle檢查均通過。
- 實際compiled Swagger63 paths無隱藏入口提示，保留actor wire契約；029三menu keys與OpenAPI no-store／actor／HTTP錯誤code已核對。
- 狀態保留 `claimed` 供merger最終code-review與整合；正式部署兩項AC依前述外部前置保留未勾。

### 2026-11-07 Repository 整合紀錄

- 實作與最終驗收 tip `abea097`（`028-09-integration`，包含 legacy fixtures `19d1577` 與輕量重播修復 `bd7a59f`）已 fast-forward 合入 `028-module-authorization`；已核對 quickstart 的實測紀錄，本票 repository 實作與隔離驗收結案為 `resolved`，後續仍進行整合分支 code review。
- unit 129 suites／1310 tests、business 56 suites／569 tests 與獨立 reconnect 1項、security 38 suites／226 tests、schema 10 suites／49 tests、root build／lint、client test 4項／bundle 均通過。
- 真實核定名單與實際停止舊服務／切換部署兩項 AC 刻意保留未勾，沿前述外部維運前置交付；此結案不代表正式部署或核定指派已完成，不能以合成驗收替代。
