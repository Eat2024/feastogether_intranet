# 09: 正式登入回歸與 UAT 切換程序演練

**What to build:** 產出可審查的一次性回填與回復程序，僅在隔離 DB 演練並驗證各正式登入入口。

**Blocked by:** [05](./05-department-read-ui.md)、[06](./06-creation-snapshot.md)、[08](./08-department-export-ui.md)

**Status:** ready-for-agent

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；US3；FR-009/012；SC-005。

**Tasks:** T037、T038、T039、T040、T041；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [ ] 帳密、WebView、OAuth 與既有 session 覆蓋補碼、缺值清空、調職及後續查 DB 新值；dev-login 只用合成部門，不新增登入旁路。
- [ ] uat-cutover.md 包含停寫／停下載、備份、schema、舊 ID 集合盤點、指定代碼核對、回填、相容程式部署、正式重登入驗收再開放；quickstart 順序一致。
- [ ] 回填僅用明列舊 ID（含軟刪除），歸 1029030000／IT策略本部系統開發部；不改 User、createdByUserId、updated_at 或簽署證據，不提交真實備份。
- [ ] T039 收集到 schema 測試並驗證程序中的實際 SQL：筆數、精確集合、重跑、非預期非空停止、原值回復、切換後新資料與證據不變。
- [ ] T037／T039 與完整隔離切換演練結果寫入 validation.md，明確標示尚未執行真實 UAT；回滾不能直接重開全員可下載的舊版本。

## 原始任務範圍

- [ ] T037 [P] [US3] 在 `server/test/password-login.e2e-spec.ts`、`server/test/webview-session.e2e-spec.ts`、`server/test/oauth-login.e2e-spec.ts` 增補既有帳號補代碼、缺值清空、調職及舊 session 後續讀 DB 新值的測試；dev-login fixtures 明確使用合成部門，不新增通用測試登入旁路。
- [ ] T038 [P] [US3] 建立 `specs/017-department-document-visibility/uat-cutover.md`，提供可審查的一次性唯讀盤點、維護窗口、備份、顯式 ID 清單回填及按原值回復的 SQL／執行步驟；固定字串 `1029030000`／「IT策略本部系統開發部」，包含軟刪除舊文件、不更新 User／createdByUserId／updated_at／證據、不呼叫 HR 於 migration、不提交真實備份，真實 UAT 寫入留待部署指示。
- [ ] T039 [US3] 建立 `server/test/department-backfill.e2e-spec.ts` 並加入 `server/test/jest-schema.json` 收集規則，在隔離 DB 驗證 T038 的實際 SQL／同一資料操作：精確 ID 集合、重跑、非預期非空值停止、回復原值、切換後資料不被覆蓋、代碼精確比對、影響筆數及證據摘要不變。
- [ ] T040 [US3] 將 `specs/017-department-document-visibility/uat-cutover.md` 與 `quickstart.md` 的順序對齊：先停寫／停下載、備份與 schema、盤點舊集合、確認指定代碼對應、回填核對、部署相容程式、正式重登入同步後驗收再開放；回滾不得直接讓舊全員下載版本恢復對外服務。
- [ ] T041 [US3] 執行 T037／T039 與隔離切換演練，將新舊文件筆數、回填／回復結果、各登入入口與既有 session 驗收摘要寫入 `specs/017-department-document-visibility/validation.md`；明確區分「隔離演練完成」與「尚未執行 UAT 回填」。
