# 08: 整合驗證與交接

**What to build:** 所有 tickets 整合後，完整跑過 server 與 root 的驗證，在 quickstart 記錄實際結果與未驗證的限制，並確認 Spec 006／023 的取代註記仍正確，讓這個分支可以進 PR review。

**Status:** claimed

**Blocked by:** [01](01-portal-connection.md)、[02](02-org-chart-from-portal.md)、[03](03-login-staff-from-portal.md)、[04](04-portal-user-sync-core.md)、[05](05-daily-schedule.md)、[06](06-manual-cli-runbook.md)、[07](07-remove-feastogether-hr-paths.md)

**Size:** S

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T033–T034；FR-012（Spec 006／023 註記）；SC-001–SC-010 的總驗收。

## Acceptance Criteria

- [x] `pnpm -C server lint:check`、`test`、`build`、`test:e2e`，以及 root 的 `pnpm lint`、`pnpm build` 都通過；client 沒有變更。
- [x] quickstart 追加實際結果，並逐項列出 SC-001–SC-010 的驗證方式；沒有驗證到的項目要寫出原因。
- [x] Spec 006 與 Spec 023 的 Spec 024 註記和實際取代範圍一致。
- [x] UAT 上線前的維運步驟（`server.env` 加入 `PORTAL_MYSQL_*`、部署後先跑 dry-run）已寫在 runbook 或交接說明中；不操作 UAT，不建立遠端 PR，除非使用者要求。
- [x] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。

2026-11-03：ticket 07 發現根目錄 README.md 仍寫帳密登入沿用 `/api/v1/hr/staff_lookup` 資格檢查；08 一併核對 README 與其他文件是否還提到這三條饗賓人路徑或 HEX 匯入。

2026-11-03（implementer，branch `feat/024-t08`，基於 integration tip `f86378f`；commits `7f04d39`、`4568f2f`、`85bd326`）：T033–T034 完成。

- T033 驗證（全部在本分支，`.env.test` 用 `feastogether_intranet_test_t08`、Redis DB 9，跑之前先清空 DB 9）：
  - `pnpm -C server lint:check`：0 errors；269 warnings 都在既有檔案，與 tickets 01–07 的基準相同。
  - `pnpm -C server test`：117 suites／1207 tests 全過（三次 commit 的 pre-commit hook 也都通過）。
  - `pnpm -C server build`：通過。
  - `pnpm -C server test:e2e`：41/41 suites、437/437 tests，約 180 秒，第一次就全過，沒有遇到偶發失敗，不需要重跑。
  - `pnpm -C server test:e2e:security`：14/14 suites、84/84 tests。
  - root `pnpm lint`：server 0 errors（同上 269 warnings），client 0 problems。
  - root `pnpm build`：server 與 client 都通過。client 從 dev 基準 `1ab6b99` 起沒有任何變更。
  - `rg "hr/(org_chart|staff_lookup|staff_emails)" server/src` 沒有結果；匯入、CLI、worker 與 Portal 模組沒有檔案讀寫。
  - 結果、SC-001–SC-010 對照表與 UAT 上線交接步驟已追加到 `quickstart.md`。
- T034 與文件一致性：
  - Spec 006 註記：改為已實作，補上取代的 FR-002、API Contract「上游」列與 `FEASTOGETHER_*` 設定描述；快取 key 改以 Portal 連線設定區隔；逾時改為每個 Portal 查詢各 10 秒。
  - Spec 023 註記：改為已實作，補上 SC-003 末句、錯過 04:00 時補跑一次、500 人停用門檻與手動確認、登入以完整員編精確比對。
  - research §7 的 Decision 補上「`next` 已到期就不 upsert」，與 Rationale 一致。
  - 根目錄 `README.md`：帳密登入改寫為直接查 Portal 做在職資格檢查，連線設定加上 `PORTAL_MYSQL_*`。
  - `docs/deployment/uat-cicd.md`：`server.env` 的內容加上 Portal 唯讀連線（FR-012 的部署說明）。
  - `server/docs/internal-electronic-signature-data-dictionary.md`：`users.email` 說明與「員工資料來源界線」段落改為每日匯入、部門樹與登入讀 Portal，以及停用規則。
  - 其他 `specs/` 以外的文件已搜尋，沒有其他地方把三條饗賓人路徑、HEX TSV 匯入或「不連 Portal」寫成現況。
- ticket 01 未勾的「錯誤訊息不含設定值」：依 tickets 02、03、04 的 e2e 結果勾選，並在 ticket 01 追加引用。
- 未驗證／限制（詳見 quickstart 對照表）：
  - 沒有連真實 Portal，沒有操作 UAT，也沒有建立遠端 PR。
  - 10 秒期限以每個 SQL 查詢計，不是每次方法呼叫；部門樹在 Portal 慢但有回應時最多約 20 秒，沒有測。
  - 7 天排程是用 BullMQ 的下次執行時間推算，沒有實際跑 7 天。
  - 沒有執行 `test:schema`（024 沒有 migration 或 entity 變更）、`s3-export` e2e（需要 `moto_server`）與 performance benchmark。
- 範圍外發現（未修改）：Spec 023 的 Status 行仍寫「來源切換及可重跑維護工具待實作」，這是 023 自己的狀態，與 024 無關。
