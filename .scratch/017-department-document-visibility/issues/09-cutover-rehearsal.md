# 09: 正式登入回歸與 UAT 切換程序演練

**What to build:** 產出可審查的一次性回填與回復程序，僅在隔離 DB 演練並驗證各正式登入入口。

**Blocked by:** [05](./05-department-read-ui.md)、[06](./06-creation-snapshot.md)、[08](./08-department-export-ui.md)

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；US3；FR-009/012；SC-005。

**Tasks:** T037、T038、T039、T040、T041；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [x] 帳密、WebView、OAuth 與既有 session 覆蓋補碼、缺值清空、調職及後續查 DB 新值；dev-login 只用合成部門，不新增登入旁路。
- [x] uat-cutover.md 包含停寫／停下載、備份、schema、舊 ID 集合盤點、指定代碼核對、回填、相容程式部署、正式重登入驗收再開放；quickstart 順序一致。
- [x] 回填僅用明列舊 ID（含軟刪除），歸 1029030000／IT策略本部系統開發部；不改 User、createdByUserId、updated_at 或簽署證據，不提交真實備份。
- [x] T039 收集到 schema 測試並驗證程序中的實際 SQL：筆數、精確集合、重跑、非預期非空停止、原值回復、切換後新資料與證據不變。
- [x] T037／T039 與完整隔離切換演練結果寫入 validation.md，明確標示尚未執行真實 UAT；回滾不能直接重開全員可下載的舊版本。

## 原始任務範圍

- [x] T037 [P] [US3] 在 `server/test/password-login.e2e-spec.ts`、`server/test/webview-session.e2e-spec.ts`、`server/test/oauth-login.e2e-spec.ts` 增補既有帳號補代碼、缺值清空、調職及舊 session 後續讀 DB 新值的測試；dev-login fixtures 明確使用合成部門，不新增通用測試登入旁路。
- [x] T038 [P] [US3] 建立 `specs/017-department-document-visibility/uat-cutover.md`，提供可審查的一次性唯讀盤點、維護窗口、備份、顯式 ID 清單回填及按原值回復的 SQL／執行步驟；固定字串 `1029030000`／「IT策略本部系統開發部」，包含軟刪除舊文件、不更新 User／createdByUserId／updated_at／證據、不呼叫 HR 於 migration、不提交真實備份，真實 UAT 寫入留待部署指示。
- [x] T039 [US3] 建立 `server/test/department-backfill.e2e-spec.ts` 並加入 `server/test/jest-schema.json` 收集規則，在隔離 DB 驗證 T038 的實際 SQL／同一資料操作：精確 ID 集合、重跑、非預期非空值停止、回復原值、切換後資料不被覆蓋、代碼精確比對、影響筆數及證據摘要不變。
- [x] T040 [US3] 將 `specs/017-department-document-visibility/uat-cutover.md` 與 `quickstart.md` 的順序對齊：先停寫／停下載、備份與 schema、盤點舊集合、確認指定代碼對應、回填核對、部署相容程式、正式重登入同步後驗收再開放；回滾不得直接讓舊全員下載版本恢復對外服務。
- [x] T041 [US3] 執行 T037／T039 與隔離切換演練，將新舊文件筆數、回填／回復結果、各登入入口與既有 session 驗收摘要寫入 `specs/017-department-document-visibility/validation.md`；明確區分「隔離演練完成」與「尚未執行 UAT 回填」。

## 切換程序與隔離演練紀錄（T038／T039／T040）

2026-11-02：以下程序及隔離驗證完成，待 root 整合本票的登入驗證與提交。

- 新增 uat-cutover.md，包含唯讀員工／文件盤點、停寫／停下載、備份、schema、固定代碼核對、明列 ID JSON、交易鎖定、整批 preflight、回填、原值回復、相容部署及正式重登入驗收再開放；quickstart 順序同步。
- 回填與回復 UPDATE 內嵌完整批次防護，任一 ID 缺失／重複、不完整備份或未知非空歸屬即整批 0 寫入；省略人工 preflight 也不能部分更新。使用同一 connection、JSON_TABLE、FOR UPDATE OF d；沒有永久表、stored procedure、依賴、排程或 env。
- department-backfill.e2e-spec.ts 直接解析並執行文件 SQL，不另寫鏡像實作；已加入 jest-schema 收集。只在本機專用 MySQL 的 feastogether_intranet_test017 前綴隔離 DB 執行。
- TDD：先以未實作回填的只讀占位確認有效紅燈，預期實改 2 筆卻沒有回填。Fixture constraint 與 JSON_TABLE 鎖定語法前置問題已先排除，不把前置失敗當紅燈。
- 綠燈：回填套件 9 tests 全過。目標 3 筆（含 1 軟刪除、1 已同值），首次回填實改 2、重跑 0、回復原值 2、再回復 0；第 4 筆切換後文件完全不變。User、原建立人、簽署人／signature／file／audit metadata 摘要及含微秒 updated_at 不變。
- 負向案例含未知代碼（含尾端空白精確差異）、不同名稱、缺失 ID、重複 ID、缺原值欄位、空集合、備份原值本身未知，以及回復前被異動的任一文件；全部整批拒絕。
- 變異檢查：暫時拿掉 UPDATE 的 valid_count 批次防護後，unknown-code、wrong-name、備份原值未知 3 案轉紅；已還原防護。
- 最後完整 `pnpm -C server test:schema`：4 suites／24 tests 通過；新測試 ESLint 0 errors／warnings，git diff --check 通過。此範圍只有程序文件與測試，未改 runtime。
- 尚未執行 UAT 回填、現場盤點、真實備份或部署；不能以本機演練當成 UAT 已完成。舊全員下載版本不可直接恢復對外服務。

整合：三種正式登入 E2E 3 suites／14 tests 通過；A→B→NULL 後舊 cookie 依目前 User 授權，HR 失敗不覆寫；完整紀錄見 validation.md。提交以 `git log --grep="rehearse department cutover"` 查閱。
