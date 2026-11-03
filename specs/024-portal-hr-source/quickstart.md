# 驗證指南：Portal 直連取代饗賓人人資查詢

只使用合成資料，不連真實 Portal，也不使用真實名冊。契約見 [contracts/portal-source.md](contracts/portal-source.md)，分類規則見 [data-model.md](data-model.md)。

## 前置準備

- 本機 MySQL 與 Redis，`.env.test` 依 `.env.test.example` 設定。資料庫名稱必須以 `feastogether_intranet_test` 開頭，Redis DB 不可為 0。
- `test/synthetic-portal.helper.ts` 會自動建立臨時資料庫 `${DB_MYSQL_DB}_portal_<uuid>`，並把 `PORTAL_MYSQL_*` 指向它；測試結束後刪除。

## 自動化驗證

```bash
pnpm -C server lint:check
pnpm -C server test        # 組樹、匯入規則、員工資料查詢、scheduler、SQL 欄位白名單
pnpm -C server build
pnpm -C server test:e2e    # 合成 Portal 資料庫：部門樹、三個登入入口、每日匯入、CLI
```

e2e 要覆蓋下列情境：

1. **部門樹**
   - 多根、深層、上層停用、無員工部門、空資料、所屬部門無效的員工：結果與 fgapi 規則一致（SC-002）。
   - 重複代碼或循環：回傳 502 且不寫快取。
   - 快取 1,799 秒內命中，1,800 秒後重新查詢；未登入一律 401。
2. **登入**
   - 帳密、WebView、OAuth 三個入口，分別測試：試用、正式、其他狀態、查無、同員編多筆、員編只差大小寫或尾端空白、欄位不合法（SC-003）。
   - Portal 停止回應：15 秒內回報來源不可用（SC-007）。
   - 測試期間，饗賓人 `hr/*` 的 stub 一被呼叫就讓測試失敗（SC-001）。
3. **每日匯入**
   - 5,001 位合成人員，姓名含 4-byte 字元與前導零員編：建立、更新與分類正確；第二次執行變更數為 0（SC-005）。
   - 混入缺姓名、Email 格式錯與衝突列：只略過這些員編，log 中不出現它們（SC-010）。
   - 停用：Portal 非在職的人被停用，查不到的人不停用；恢復在職不會自動啟用；超過 500 人時整批不寫入（SC-009）。
   - Portal 無法連線：本機變更數為 0。
   - 匯入過程中同時有登入：登入等待匯入完成，沒有部分寫入。
   - 執行後工作目錄沒有新增任何檔案（SC-008）。
4. **排程**
   - scheduler 以 `portal-user-sync:daily`、`0 4 * * *`、`Asia/Taipei` 呼叫 upsert。
   - 兩個 worker 實例對同一個 Redis：同一次排程只處理一次（SC-006）。
5. **隱私**
   - 合成資料表的 `person_pass`、`person_id_no`、`birthdate` 填入哨兵值；這些值不得出現在任何回應、log 或本機資料中（SC-008）。

## UAT 人工驗證（部署後）

1. 確認容器可以連到 Portal：依 runbook [手動執行](../../server/docs/portal-user-import.md#手動執行) 跑一次 `sync --dry-run`。

   檢查摘要中的在職人數是否接近 5,166、略過的人數與原因，以及要停用的人數。
2. 停用人數超過 500 時，先確認停用人數合理，再帶 `--allow-deactivations <N>` 執行一次。
3. 隔天早上確認 worker log 有 `portal_users.sync_completed`，而且 `outcome` 為 `applied`。
4. 開啟選人部門樹，用 OAuth 與帳密各登入一次。確認 server log 沒有 `hr/org_chart`、`hr/staff_lookup`、`hr/staff_emails` 的請求紀錄。

## 實際結果（2026-11-03，ticket 08）

在 `feat/024-t08`（基於 integration tip `f86378f`，含 tickets 01–07）執行，只用合成資料、本機 MySQL 8.4 與 Redis。

| 指令 | 結果 |
| --- | --- |
| `pnpm -C server lint:check` | 0 errors；269 warnings 都在既有檔案，與 tickets 01–07 記錄的基準相同 |
| `pnpm -C server test` | 117 suites／1,207 tests 全過 |
| `pnpm -C server build` | 通過 |
| `pnpm -C server test:e2e` | 41 suites／437 tests 全過，約 180 秒，第一次就通過 |
| `pnpm -C server test:e2e:security` | 14 suites／84 tests 全過 |
| `pnpm lint` | server 0 errors（同上 269 warnings）；client 0 problems |
| `pnpm build` | server（`nest build`）與 client（`next build`）都通過 |

- client：從 dev 基準 `1ab6b99` 到本分支沒有任何變更。
- `rg "hr/(org_chart|staff_lookup|staff_emails)" server/src` 沒有結果。`FeastogetherModule` 只被 `auth.module.ts` import（另有 `security-oauth-login` e2e 自組的 module）。
- 偶發失敗：本次沒有出現。已知的兩個偶發失敗：
  - `core-esign-flow`「10 人共用 3 欄位…」：見 `specs/015-export-history/implementation-notes.md`，ticket 05 遇過一次。
  - `internal-email-capacity`：多個 worktree 共用同一台 MySQL 時，5,001 人測試會超過 180 秒（tickets 01、03）。
- 沒有執行：
  - `test:schema`：024 沒有 migration 或 entity 變更。
  - `s3-export` e2e：需要 `moto_server`。
  - `test/performance` benchmark。

### SC-001–SC-010

| SC | 驗證方式 | Ticket | 未驗證／限制 |
| --- | --- | --- | --- |
| SC-001 | `org-chart` e2e 中饗賓人 client 的 get／post 一被呼叫就拋錯，結尾斷言呼叫數為 0。三個登入入口的 e2e 斷言 `hr/staff_lookup`（`FeastogetherClient.get`）呼叫數為 0，帳密登入仍經 `staff/login`。`mail-whitelist-runtime` 對任何 `hr/*` 呼叫都會失敗。`server/src` 已搜尋不到這三條路徑。 | 02、03、07、08 | 每日匯入與手動匯入沒有執行期的「呼叫數 0」斷言；兩者的 module 不依賴饗賓人模組，靠模組依賴與程式碼移除確認。 |
| SC-002 | `org-chart.builder` 單元測試 11 個案例、`org-chart` e2e 15 個測試，涵蓋多根、深層、上層停用或不存在、無員工部門、空資料、所屬部門無效的員工、排序與欄位。預期樹依 fgapi 規則手算。 | 02 | 沒有和真實 `hr/org_chart` 回應逐筆比對。 |
| SC-003 | `eligible-staff` 單元測試 17 個；e2e：`password-login` 15、`oauth-login` 9、`webview-session` 11。涵蓋試用、正式、其他狀態、查無、多筆、只差大小寫或尾端空白、欄位不合法、權限被收回。 | 03 | Portal 不回應（逾時）只在帳密登入 e2e 驗證；WebView 與 OAuth 共用同一個服務，只驗證立即失敗。「長度超過限制」只有單元測試，因為合成 Portal 的欄位長度比 DTO 上限短。 |
| SC-004 | `oauth-login` e2e：當天才寫入 Portal 的新進同仁可以立即登入。`password-login` e2e：密碼通過但 Portal 已非在職就拒絕。登入的員工資料查詢不快取。 | 03 | — |
| SC-005 | `portal-user-sync` e2e：5,001 人（4-byte 中文、全形符號、前導零）。<br>第一次：建立 4,999、更新 1、保護 1；ID、部門外鍵、`last_login_at` 與簽署人快照都不變。<br>第二次：`users` 全表含微秒 `updated_at` 完全相同。<br>匯入交易進行中，登入寫入會等待；寫入途中失敗會整批回滾。 | 04 | `too_long` 只有單元測試。沒有連真實 Portal；5,001 人只在本機 MySQL 測量，單次約 1–2 秒。 |
| SC-006 | `portal-user-sync-worker` e2e：<br>兩個 worker 連同一個 Redis，只有一個 `portal-user-sync:daily`、一個 delayed job。<br>用 BullMQ 的 `defaultRepeatStrategy` 從 Redis 中的 `next` 推 7 次，都是連續 7 天的台北 04:00。<br>錯過 04:00 時只補跑一次；job 失敗不重試。<br>`portal-user-sync` e2e：Portal 故障（`ER_NO_SUCH_TABLE`、`ER_ACCESS_DENIED_ERROR`）時本機 0 變更；不合法資料只略過該員編。 | 04、05 | 7 天是用下次執行時間推算，沒有實際跑 7 天；錯過 04:00 的狀態以 mock 的 `Date.now` 模擬。<br>沒有測：worker 剛好在 04:00 整啟動的毫秒級時間窗；匯入途中 worker 當掉時，BullMQ 的 stalled 機制會讓同一個 job 再跑一次。 |
| SC-007 | `portal-directory` 與 `org-chart` e2e：設定缺漏時 HTTP app 照常啟動，查詢時才失敗。<br>連線池在第一次查詢才建立；沒有建合成 Portal 的 e2e 套件，HTTP app 與 worker 都在 `PORTAL_MYSQL_DB` 指向不存在的資料庫時啟動，簽署流程的 e2e（登入用替身）全過。<br>Portal 不回應時，部門樹約 10 秒回 502，帳密登入 15 秒內回 `STAFF_LOOKUP_FAILED`；7 個並發查詢都在約 10 秒拒絕。登入失敗時不改查饗賓人，也不以本機舊資料放行。 | 01、02、03 | 10 秒期限以「每個 SQL 查詢」計，不是每次方法呼叫。部門樹依序執行兩個查詢，Portal 慢但有回應時最多約 20 秒，超過 15 秒；這個情況沒有測。<br>WebView 與 OAuth 的逾時沒有獨立 e2e。 |
| SC-008 | 單元測試鎖定送出的 SQL 與合約逐字相同，不讀 `person_pass`、`person_id_no`、`birthdate`。<br>合成 Portal 的哨兵值不出現在查詢結果、部門樹回應、本機資料與 log。<br>部門樹、帳密登入與匯入失敗時，回應、log、錯誤訊息與 stack 都不含 Portal 主機、帳號、資料庫名稱或員編。<br>匯入前後工作目錄的檔案清單相同；匯入、CLI、worker 與 Portal 模組都沒有檔案讀寫。 | 01、02、03、04、08 | 只比對工作目錄的檔案清單，沒有檢查整台主機。 |
| SC-009 | `portal-user-sync` e2e：<br>Portal 狀態 2、4／5 的人被停用。<br>查無、只差大小寫、已停用、軟刪除的帳號不動；Portal 恢復在職後不自動恢復。<br>501 人整批不寫入並記 `sync_blocked`；確認 500 仍擋，確認 501 才套用；剛好 500 人可以套用。<br>CLI e2e：501 人時 `sync` 與 `--allow-deactivations 500` 都以 1 結束且不寫入，帶 501 才套用。 | 04、06 | 狀態查詢（4b）失敗沒有獨立 e2e，與在職名單查詢（4a）共用同一個錯誤分類路徑。 |
| SC-010 | `portal-user-sync` e2e：缺姓名、Email 格式錯、員編不合法、同員編資料不同、只差大小寫的資料列，只略過該員編，其餘照常匯入；被略過員工的本機資料不變，log 不含這些員編。CLI dry-run 的略過清單只輸出到 stdout。 | 04、06 | `too_long` 只有單元測試；Portal 每個欄位的上限都比本機短，以現有 schema 不會出現。 |

### 其他未驗證項目

- 沒有連真實 Portal，也沒有在 UAT 部署或執行 CLI。runbook 中的 `intranet-uat-worker-1` 是依 Compose 命名規則推得的容器名稱。
- 啟動 `WorkerModule` 的 e2e 會在測試 Redis 留下 `portal-user-sync:daily`（見 ticket 05）。保留到隔天 04:00 之後再跑 e2e，第一個 worker 會補跑一次；因為對應的 Portal 資料庫不存在，只會記一筆 `sync_failed`，不改資料。

- 新進同仁第一次登入與 04:00 匯入同時發生時，匯入新建同一員編會撞唯一鍵，該次匯入以 `failed_write` 結束、整批 rollback，不會部分寫入；維運可手動執行 `sync` 補上（見 runbook「Portal 故障」）。這是已知限制，沒有 e2e。
- 無法解碼文字（U+FFFD）的測試是把 U+FFFD 直接存進合成 Portal，沒有重現真實 Portal 的錯誤位元組。只偵測 mysql2 解碼時產生的 U+FFFD；若 MySQL 伺服器轉換字元集時已換成 `?`，與一般問號無法分辨，不在偵測範圍。

### UAT 上線交接（尚未執行）

1. 部署前，在 `/home/feasteng/deploy/intranet-uat/server.env` 加入五個 `PORTAL_MYSQL_*`，並確認容器到 Portal 的網路，以及帳號對 `sys_person`、`chi_department` 的 SELECT 權限。見 runbook「設定」與 `docs/deployment/uat-cicd.md`。
   - 這個版本一部署，部門樹與三個登入入口就改查 Portal。設定缺漏時，登入回 `STAFF_LOOKUP_FAILED`，部門樹回 502。
2. 部署後、第一次 04:00 前，照上方「UAT 人工驗證」第 1、2 步執行 dry-run。
   - 要停用的人數不超過 500 時，04:00 的每日匯入會直接套用，所以要在那之前確認人數合理。
3. 隔天照「UAT 人工驗證」第 3、4 步確認。
