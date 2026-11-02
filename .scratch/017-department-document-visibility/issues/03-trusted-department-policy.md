# 03: 可信登入同步、錯誤與共用存取政策

**What to build:** 正式登入同步可信部門，提供唯讀與一般匯出各自的授權判斷及合成測試資料。

**Blocked by:** [02](./02-department-schema.md)

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；FR-003/004/008/010/011；授權與錯誤契約。

**Tasks:** T006、T007、T008、T009、T010；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [x] 帳密／WebView 與 OAuth 以可信 HR 資料同步，明確缺值寫 SQL NULL 清除舊碼，上游失敗沿既有錯誤處理；不得用本機部門 ID、客戶端欄位或 IT fallback。
- [x] 前後端對齊 ESIGN_DEPARTMENT_UNAVAILABLE／409 與指定繁體中文訊息，session token 格式不變。
- [x] 有效員工可依建立人或同部門讀取；一般匯出必須同部門且沒有建立人例外；NULL 不互相授權，既有建立人寫入／草稿鎖保留。
- [x] 對應單元測試先紅後綠；兩部門、無部門、同名異碼及舊文件 fixtures 可用，新 E2E／安全測試收集規則已登記。

## 原始任務範圍

- [x] T006 [P] 在 `server/src/features/auth/services/auth.service.spec.ts`、`server/src/features/auth/services/oauth-identity.service.spec.ts` 補登入部門新增／更新／缺值／上游失敗測試；落實「空白／空字串不作有效代碼」「上游明確缺值以 SQL NULL 清除舊值，不用 TypeORM undefined 跳過更新」，不把本機 departmentId 當上游代碼。
- [x] T007 [P] 在 `server/src/common/errors/app-error-code.ts`、`server/src/common/errors/app-errors.ts` 與 `client/src/api/errorCodes.ts` 加入 `ESIGN_DEPARTMENT_UNAVAILABLE`／409／「無法取得您的部門資料，請重新登入或聯絡系統管理員」，沿既有錯誤包裝，不新增 env 或 fallback。
- [x] T008 在 `server/src/features/auth/services/auth.service.ts` 與 `server/src/features/auth/services/oauth-identity.service.ts` 同步可信 HR 部門代碼／名稱；OAuth 依驗證後員編查既有 HR service，必要時更新 `server/src/features/auth/auth.module.ts` 的既有 provider wiring；不改 session token 格式或前端可寫欄位，通過 T006。
- [x] T009 在 `server/src/features/esign/services/esign-access-policy.service.spec.ts` 補建立人、同部門、跨部門、空代碼、失效帳號的政策測試，再於 `server/src/features/esign/services/esign-access-policy.service.ts` 使用既有 UserRepository 取得有效員工部門並提供「建立人或同部門可讀」及「必須同部門匯出」兩種明確判斷；保留 checkEsignCreator／草稿鎖的嚴格寫入規則，不新增通用 RBAC 層。
- [x] T010 建立 `server/test/department-visibility.helper.ts` 的合成兩部門、無部門、同名異碼及舊文件 fixtures；於 `server/test/jest-e2e.json`、`server/test/jest-e2e-security.json` 登記後續 `esign-department-visibility.e2e-spec.ts`／`security-esign-department.e2e-spec.ts`，使新測試確實被既有 testRegex 收集，不繞過安全 setup。

## Ticket 03（T006–T010）

- 登入同步新增14個行為斷言先紅後綠，相關3 suites／65 tests通過；OAuth使用現有HR且無需新增provider。
- 政策先確認缺少新方法／constructor參數失敗，再實作後47 tests通過；涵蓋精確字串、NULL／空白、失效員工、調職建立人讀取與匯出差異、交易鎖User。
- 完整server unit 108 suites／1,032 tests通過，server lint 0 errors／267 warnings，server build通過。既有policy constructor mocks僅補新增repository依賴。
- 合成fixtures與E2E／security收集規則已建立，HTTP功能案例待ticket04建立執行；三種登入E2E待ticket09，不宣稱已驗收。
- 前後端新增 ESIGN_DEPARTMENT_UNAVAILABLE／409；無新env／session格式。未連線UAT。

直接提交功能整合分支；commit以 `git log --grep="feat(spec017): enforce trusted department policies"` 查得。
