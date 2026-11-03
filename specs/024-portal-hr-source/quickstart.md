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
