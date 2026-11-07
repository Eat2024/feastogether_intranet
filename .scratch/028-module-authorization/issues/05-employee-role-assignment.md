# 05: 預先指派有效員工角色與即時撤銷

**What to build:** Super 以員編查核未登入員工並配置單一子功能多角色；同一員工只建立一次，撤銷即時生效且必要差異可追查。

**Blocked by:** [028-04](04-role-permission-management.md)

**Status:** resolved

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T025、T029、T030、T031、T034。

## Acceptance Criteria

- [x] 員編只從 body 進入，1～32字且保留大小寫／前後字元；Portal 必須唯一 exact-match 有效員工，不用舊資料 fallback。
- [x] 不存在／失效／模糊422、Portal故障502、本地停用或刪除403且不復活；目標錯誤不使有效 Super session 被判401登出。
- [x] 首次登入與預指派競爭只得到同一 user ID；角色集合單 module、最多50／不重複、只一般角色，不把 implicit 同仁放進可改 roleIds。
- [x] 依固定鎖序與 expectedRoleIds CAS；同目標 no-op，不同版本409，撤銷 soft-delete／重授恢復同列，不重複關聯。
- [x] 新 user、關聯與 audit 原子提交；audit 故障沒有半套身分或指派；刪除角色與新增指派競爭仍正確。
- [x] API／REPL 相同結果、角色成員與員工角色查詢最小化；兩實例舊 session 下一請求立即更新能力，同仁始終保留。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。

### 2026-11-07 實作與驗收

- 完成 T025、T029～T031、T034。`AuthorizationAssignmentService` 重用 Portal exact-match 查核；HTTP／REPL 共用 DTO、交易及 audit。新員工由可信資料建檔，`lastLoginAt` 保持 NULL，不改既有員工登入資料或本地停用狀態。
- 指派先查 Portal，再以 singleton → user → role ID → permission ID → relations 鎖序及 READ COMMITTED 交易處理。員編唯一鍵與一次完整重試仲裁首次登入競爭；本地取得員編另以字元精確核對，不能被 DB collation 誤配。
- 一般角色集合採 expectedRoleIds CAS；同目標重送不重複 audit，撤銷／重授保留同關聯 ID。protected／跨 scope／deleted 目標拒絕；inactive 角色配置保留但不授權。audit 前後值用內部安全 number，API 再序列化 ID 字串，避免白名單裁掉合法指派。
- 新增三個管理 endpoints 及 `authz.assignRoles`／`employeeRoles`／`roleEmployees`，結果 no-store，成員只輸出 userId／name。錯誤目標422不清除Super session；Portal502、本地停用／刪除403，未知／過量輸入400。
- 新增真MySQL／Portal／HTTP／REPL測試7項，覆蓋資格／嚴格輸入、雙實例舊session撤權、關聯恢復、預指派對首次登入4輪競態、不同目標CAS、刪除對指派與稽核觸發器故障回滾。角色同名／同版本競態沿028-04已完成的測試，一起納入完整security回歸。
- 驗證：server build、unit 128 suites／1289 tests、完整security 28 suites／203 tests（caffeinate防休眠，69.4秒）通過；root lint無錯誤。首次完整security只有舊console測試禁止PortalModule而失敗，已改為符合本票契約的「Portal設定缺漏仍可啟動／讀／sync，只有assign才502」，並保留HTTP／worker／Redis／mail／storage隔離。
- 無frontend／migration／正式config／dependency變更。隔離MySQL測試庫前綴與Redis DB5只在ignored測試環境；未查正式Portal、未部署或執行核定真實員工名單。全業務e2e與正式切換仍交028-09。
- Ticket 保留 claimed；待 merger 合入整合分支後記錄 commit 並改 resolved。

### 2026-11-07 整合紀錄

- 實作 commit `c6ee750`（`028-05-assignments`）已 fast-forward 合入 `028-module-authorization`；已核對本票與 quickstart 的驗收紀錄，狀態改為 `resolved`。
- server build、unit 128 suites／1289 tests、完整 security 28 suites／203 tests 及 root lint 均有通過紀錄。028-09 仍等待文件與生命週期／匯出 tickets；未執行正式名單指派或部署。
