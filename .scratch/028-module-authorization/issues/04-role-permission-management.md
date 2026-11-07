# 04: Super 維護角色與權限並查稽核

**What to build:** Super 可由 API 或 REPL 查目錄、建立與維護一般角色、配置權限並核對必要稽核，兩種入口遵守相同的版本與範圍規則。

**Blocked by:** [028-02](02-effective-permissions.md)、[027-07](../../027-super-user-access/issues/07-credential-activation.md)

**Status:** claimed

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T024、T026、T027、T028、T032、T033。

## Acceptance Criteria

- [x] 只有有效 Super HTTP actor 或有效隔離維護 context 能管理；一般員工／電子簽管理員一律403，寫入驗 Origin，管理結果 no-store。
- [x] 角色名稱修整後1～100字、code由後端產生且不可變，未知輸入拒絕；角色與 permission 查詢、分頁、詳細、建立、更名、停用及刪除符合契約。
- [x] 每次實質更動驗 expectedVersion，過期409；無變更不加版／audit。同名409；仍被指派不可刪，停用保留關聯卻不授權。
- [x] permission 完整集合只接受同 module 已登錄可指派項目，modifier 具同角色 base；同仁不得改／停／刪，platform 維護權不能指派，不能動態新增權限／子功能。
- [x] API／REPL 共用服務與交易；成功與 audit 同時存在、失敗均回滾，查 audit 僅白名單差異且沒有修改／刪除入口。
- [x] 正負契約驗收涵蓋輸入上限、未知欄位、安全 ID 序列化、版本與名稱衝突，不做管理前端。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。

### 2026-11-07 實作結果（028-04-roles）

- 新增 Super-only 角色／目錄／稽核 API，成功回應 no-store，寫入沿 OriginGuard 並要求明確可信來源；一般員工與電子簽管理員皆拒絕。
- API 與 `authz` REPL 共用嚴格 DTO、CRUD／配權服務與維護交易。角色版本 CAS、no-op、不變 code、同名競態、使用中刪除、同仁及平台權限保護均由服務驗證。
- 維護寫入逐次核對 fingerprint／generation，交易先鎖 singleton，再依 users（本票不鎖員工）→ role ID → permission ID → relations；先取角色排他鎖再做 catalog current read，避免 shared 升鎖競態。
- 所有變更與白名單 audit 同交易；資料庫 trigger 模擬 audit 故障時回安全503，角色與權限關聯均回滾。管理 response 的 ID／audit 內 roleIds、userId 輸出字串。
- 授權管理 body/query 不進 access log，包含百分比編碼路徑。新增專用輸入錯誤定義以符合契約的 `REQUEST_FORMAT_INVALID`，不更改其他功能原 `INVALID_REQUEST`。
- T026 的 `AssignmentDto` 已提供下一票：員編原樣保留，ID安全整數、每集合最多50、去重與未知欄位拒絕。

**驗證**

- 單元：128 suites／1,289 tests 通過（含管理輸入與access log新增案例）。
- 授權定向整合：4 suites／15 tests 通過（baseline、revocation、catalog及本票5組角色管理情境）；本票含真Fastify／MySQL／ConsoleModule、並發名稱與版本、audit故障rollback。
- server build／lint:check、root build／lint、client 4 tests／check:bundle 全部通過；271個既有 lint warnings、0 errors，無新增warning。
- 完整 security 最終以 `caffeinate -i pnpm -C server test:e2e:security` 序列執行，25 suites／193 tests全部通過（47.865秒）。先前主機休眠期間出現120秒逾時（全套記370／2733秒、schema定向411秒）；防休眠且錯開固定3030/3031測試port後收斂，未修改timeout或正式規則。


**交付範圍**：無migration、dependency、正式環境設定或管理前端變更；員工指派API留028-05。此票尚保留claimed，合入整合分支後由merger結案。
