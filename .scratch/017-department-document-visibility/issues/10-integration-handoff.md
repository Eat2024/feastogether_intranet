# 10: 契約同步、查詢驗證與整合交付

**What to build:** 對齊受影響規格與 API 契約，完成整合驗收與可追溯交付報告。

**Blocked by:** [09](./09-cutover-rehearsal.md)

**Status:** ready-for-agent

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；全部 FR／SC；quickstart.md；department-access.md。

**Tasks:** T042、T043、T044、T045、T046；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [ ] 同步 Spec 003 OpenAPI／規格、Spec 015 匯出契約及 Spec 002／014 登入同步說明，清楚標示 Spec 017 取代全員匯出規則且保留歷史決策。
- [ ] 以隔離代表性資料執行文件與匯出查詢 EXPLAIN，記錄部門條件、索引、分頁與計數一致性；若調索引同步 migration/schema/data-model。
- [ ] 受影響單元、schema、E2E、安全 E2E、root pnpm lint 與 pnpm build 通過；有失敗先定位修復，不把環境失敗標成通過。
- [ ] 逐入口及前端直接路由核對授權／敏感資料，完成兩部門每部門至少兩位建立人、六種狀態及 UI 雙帳號驗收，validation.md 對照全部 FR／SC。
- [ ] 交付分列 client／server／migration-config、實測命令結果、未執行 UAT 動作與回滾限制；無新增表、dependency、env、排程，tasks 僅勾選有證據完成者。

## 原始任務範圍

- [ ] T042 [P] 更新 `specs/003-core-esign-flow/contracts/openapi.yaml` 與 `specs/003-core-esign-flow/spec.md`，記錄 dep、isCreator 與唯讀 DTO／建立快照；更新 `specs/015-export-history/spec.md`、`specs/015-export-history/contracts/export-history-http-api.md`，明確由 Spec 017 取代全員匯出規則；對齊 `specs/002-webview-sso-session/spec.md`、`specs/014-account-password-login/spec.md` 的登入同步敘述，不抹除歷史決策。
- [ ] T043 [P] 在隔離代表性資料對 `server/src/features/esign/repositories/document.repository.ts`、`export-job.repository.ts` 查詢跑 EXPLAIN，於 `specs/017-department-document-visibility/validation.md` 記錄部門條件、索引與分頁／計數一致性；若需要調整索引，同步 migration/schema/data-model，不新增 pagination 或快取架構。
- [ ] T044 依 `specs/017-department-document-visibility/quickstart.md` 執行受影響 server 單元測試、schema、E2E、安全 E2E、root pnpm lint 與 pnpm build，將命令、結果與未完成限制記錄於 `specs/017-department-document-visibility/validation.md`；有失敗先定位修復，不把環境失敗標成通過。
- [ ] T045 依 `specs/017-department-document-visibility/contracts/department-access.md` 逐項檢查所有讀取／寫入／匯出入口與前端直接路由，確認無其他跨部門旁路、無 token／signature／Email 非必要洩漏；將 FR／SC 對照和最終 UI 雙帳號驗收補入 `specs/017-department-document-visibility/validation.md`。
- [ ] T046 以 `specs/017-department-document-visibility/validation.md` 與 `uat-cutover.md` 產出交付摘要，分列 client／server／migration-config、已執行檢查、未執行 UAT 動作與回滾限制；核對無新增表／dependency／env／排程，tasks 只勾選有證據完成的項目。
