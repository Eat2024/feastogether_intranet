# Ticket 03 驗證紀錄

基線：impl/025-integration 4fd3a3a；工作分支 impl/025-03。範圍 T012–T014；未變更 worker 正式寫入及寄信政策。

## 實作

- 受理快取更新抽成同 feature 的 withAcceptedInitiation：只有同文件、queued／processing 回應且目前為 draft／initiating 才補摘要。active／expired／finalizing／completed／stopped 不被舊受理回應降級。
- 原有 TanStack Query 輪詢符合需求，沒有為驗證而改寫。
- 新增獨立 esign-initiation-list-consistency e2e，避免與 ticket02 修改既有查詢測試互相衝突；已登記於既有 jest-e2e 設定。

## 測試邊界與 red → green

依核准 plan 的列表 HTTP、受理快取與真實瀏覽器邊界驗證。

1. 真實 MySQL／HTTP：列表讀取到文件後以 barrier 暫停，另連線執行真正 EsignInitiationJobService.process 並確認 terminal，再完成列表查詢。成功及失敗當輪皆為完整 initiating 舊快照，下一次讀取才為 active／draft；重試等待仍保留摘要。3／3 通過。
2. 敏感度反證：暫時將列表隔離改成 READ COMMITTED，測試失敗（initiating 卻 pendingCount=1）。恢復 REPEATABLE READ 後 3／3 通過；沒有提交該暫時修改。
3. 快取助手的原邏輯 red：active 被 queued 回應改成 initiating。修正後 10 個 Node assertion 案例通過（5 種正式狀態、2 種準備狀態、2 種終態回應、非目標文件）。檢查腳本 /tmp/test025-03-cache.cjs；client 未新增測試框架或 test script，不宣稱有既有 client 自動測試套件。

## 真實瀏覽器

Chrome headless + Next webpack dev13036 + Nest13035；使用本票隔離本機資料庫 feastogether_intranet_test02503、Redis16327 DB1，fake mail/local storage，合成員工。

/tmp/spec025-03-browser-harness.cjs 建立已受理 success／failure／retry 文件；/tmp/spec025-03-browser-check.cjs 使用真正列表 UI 及實際後端 process，沒有 mock 列表成功結果。

- 初始三列皆為發起中；retry 有 attemptCount1 與 nextAttemptAt，保持受理摘要。
- 暫時令列表讀取回503，沒有顯示簽署中；恢復連線後仍為發起中。
- 觸發實際處理後，success 在2291ms顯示簽署中、failure在1789ms恢復草稿、retry最終失敗在2292ms恢復草稿（均小於5秒）。
- 全部終態後觀察4.5秒，列表請求數不再增加；離頁後亦沒有列表請求。
- pageerrors0。畫面 /tmp/025-03-terminal.png。

## 指令與限制

- node /tmp/run025-03-test.cjs --conditions=development ./node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand --forceExit esign-initiation-list-consistency
- pnpm --config.verify-deps-before-run=false -C server build：通過。
- pnpm --config.verify-deps-before-run=false -C client exec next build --webpack：通過。因隔離 worktree 的 node_modules symlink 超出 Turbopack root，使用 webpack；原 root 的標準 build 交由最後整合驗收。
- client lint 與新增 e2e lint：通過。
- 本票沒有5213人效能結論，完整矩陣留 ticket04。瀏覽器未專門注入 QueryClient 內部狀態；較晚受理回應降級案例以同一實際呼叫 helper 的10項 assertion 驗證。
