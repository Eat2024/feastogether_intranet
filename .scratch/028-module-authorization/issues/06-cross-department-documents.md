# 06: Super 與管理員建立及管理跨部門文件

**What to build:** 一般建立者維護自己的文件，具有明確能力的管理者可合法跨部門閱讀及編輯；Super 以自身維護身分建立文件並指定有效歸屬部門，前端既有列表能正常呈現。

**Blocked by:** [028-03](03-employee-signing-boundaries.md)

**Status:** resolved

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T035、T036、T037、T038、T039、T040、T041、T042。

## Acceptance Criteria

- [x] 文件、欄位與簽署人編輯保存 employee／super 真 actor；Super 員工 FK 為 NULL，不造假 user，不更改指定簽署人的員工關聯；NULL-aware CHECK 拒非法組合。
- [x] 歷史有 user 記 employee、原空稽核 slot 記 legacy_unknown；document 舊最後管理者保留未知，不補造歷史，不修改人事共用稽核行為。
- [x] Super 建立必填1～50字有效 departmentCode，Portal exact-match 取可信名稱，無效400／上游503；employee 不接受部門覆寫。
- [x] 管理他人文件只放寬建立人／部門，保留原 creator／department、所有狀態、鎖與證據限制，寫入重新核對目前能力。
- [x] role=all 必須 read-all，Super 預設 all、員工維持原範圍；任意 department query 不可越權。
- [x] 既有 client 僅調整 actor DTO／nullable顯示及 super送all／employee送dep；顯示 Super user 而非假員編、0或undefined，不新增管理UI。
- [x] 真 schema 與文件管理 e2e 通過，既有關聯／證據保持；有新受保護資料拒絕破壞性 down。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。

- 2026-11-07：完成 T035–T042，狀態保留 claimed 等待 merger。文件／欄位／簽署人局部 actor migration、NULL-aware CHECK、歷史回填與 schema.sql 完成；未修改共用人事基底或簽署證據。
- 管理入口改 CurrentActor，交易內重新核對能力並保留 creator/department；詳情 canManage 與 isCreator 分離。簽署人備註與候選清單／org-chart／resolutions 也完成 Super 相容，仍保留能力、Origin、狀態與欄位裁切。
- 已合入 integration 46f9163（04/05）；核心 commit e7552fa，整合及補充入口 commit 280ef0a。簽署生命週期與一般匯出留07/08，目前仍拒絕未遷移的Super操作，不宣稱整份028完成。
- 驗證：server unit 128 suites／1309 tests、root build、root lint（271既有warnings、0errors）、client build/lint/check:bundle通過。初版完整security 27 suites／196 tests全綠；新增note/candidates真HTTP紅→綠3案例通過。
- 合入04/05後完整security 28/30 suites、206/208 tests；完整schema 6/8 suites、45/47 tests。四項皆因主機兩次約1000秒暫停超過原測試時限，沒有業務assertion失敗；不調timeout。定向補驗及環境限制見quickstart最終紀錄。
- 定向補驗完成：受影響security 2 suites／8 tests、schema 2 suites／19 tests全綠；client test4項通過。合併後未宣稱單次完整全綠，09統一回歸。詳情契約及07/08介面交接已寫入quickstart，無文件detail OpenAPI schema需要同步。

### 2026-11-07 整合紀錄

- 實作及整合 tip `9e5dd14`（核心 `e7552fa`、整合與補充入口 `280ef0a`，分支 `028-06-documents`）已 fast-forward 合入 `028-module-authorization`；已核對本票與 quickstart 證據，狀態改為 `resolved`。
- unit 128 suites／1309 tests、root build／lint、client test 4項與 bundle 檢查通過。合併後完整 security 206/208、schema 45/47；環境暫停逾時的套件定向重跑 security 8項／schema 19項全綠，未宣稱單次完整全綠，028-09 統一回歸。
- 028-07／028-08 前置已解除；生命週期、匯出與 readiness 尚待完成，未執行正式部署。
