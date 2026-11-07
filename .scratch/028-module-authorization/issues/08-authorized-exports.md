# 08: 授權一般匯出與下載，封閉個人副本旁路

**What to build:** 一般匯出與下載依明確 read/create/all 能力及資料範圍執行，保存真正匯出者；本人副本保持獨立資格，不能藉歷史路徑冒領。

**Blocked by:** [028-06](06-cross-department-documents.md)

**Status:** resolved

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T048、T049、T050、T051。

## Acceptance Criteria

- [x] 一般 excel／zip 只 employee 或 super；pdf 本人副本只 employee／external 且 signer 非空，Super 不可建立本人 pdf 紀錄，DB CHECK 明確處理 NULL。
- [x] 匯出產生、重試與既有檔下載記錄按實際分支要求 create 或 read；跨部門需 export.all 搭配 base，來源查詢亦受保護。
- [x] worker 保存真實提交 actor；已受理工作可完成，後續 job／歷史／檔案查詢、retry與download逐次驗當前能力與範圍。
- [x] pdf歷史與個人副本只給本人，即使管理者／Super 有全部一般匯出能力也不能繞過；外部憑證不被員工權限取代。
- [x] 既有輸出 DTO／client nullable相容、姓名顯示Super user、檔名不出現undefined；真 worker 產檔與下載完整性驗收通過。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。

- 2026-11-07：T048–T051 完成，保留 claimed 交整合者結案。一般 read/create/all 改 actor-aware，包含文件 export view/detail capabilities；actor CHECK 與歷史回填、Super nullable DTO、本人 PDF 旁路均完成。core `cb2fa3a`、能力補強 `451b578`；整合 07 的 `73f18f8` 後以短名隔離庫 `feastogether_intranet_test_j` 從零套 25 個 migrations，dump 保留 lifecycle 與 export 欄位。
- 驗證：真 HTTP/Worker ZIP＋下載 hash、read/create/all/撤權/本人副本等 targeted 6 suites／23 tests 通過；完整 security 首輪 28 suites／202 tests 通過，3 舊 schema fixture suites 失敗已於整合 targeted 修復。完整 schema 9/10 suites、48/49 tests，僅舊外部 PDF seed 漏 actor；修後 schema-constraints 1 suite／3 tests 全綠，其餘 9 suites 保留完整通過證據。完整整合回歸由 09 接續，未宣稱本輪單次完整 security/schema 全綠。
- root build、root lint（零 errors）、server unit、client test 與 public bundle 邊界檢查通過。沒有新正式 env/dependency、假員工、外部本人資格擴權或部署。測試 DB 名過長的保護拒絕與欄位 comment drift 已修，未放寬 schema 安全保護。

### 2026-11-07 整合紀錄

- 實作與整合 tip `93b60e0`（`028-08-exports`，包含 028-07 整合版本 `73f18f8`）已 fast-forward 合入 `028-module-authorization`；已核對本票與 quickstart 證據，狀態改為 `resolved`。
- root build／lint、unit 128 suites／1309 tests、client test 4項／bundle 與真 HTTP/worker 定向6 suites／23 tests 通過。完整 schema 48/49 的舊 seed 已修正並定向3項全綠，保留完整與定向結果差異，不宣稱本輪單次完整全綠。
- 新隔離庫套完25 migrations產生的快照保留生命週期與匯出欄位。028-09 前置已解除，接續完整整合回歸及切換驗收；未執行正式部署。
