# Spec 030 實作驗證

## Ticket 01：按需更新（2026-11-06）

使用隔離 worktree `impl/030-01` 與合成帳號、簽署人、PDF；未連線 UAT，未提交環境 secret。US1 可示範，US2／US3 與整體發布尚未完成。

### TDD 與實際結果

- Public service 測試先看到新增第 2 人仍回傳舊 completed 工作（預期新 pending），及缺少 `documentState` 的失敗；實作後 9 個情境通過。涵蓋同數異 ID、改名不重包、讀取不寫入、current/work 分離、進行中／failed 共用、缺檔及無簽署。
- 全 server unit：119 suites、1198 tests 通過。
- `esign-export.e2e-spec.ts`：7 tests 通過。真實 MySQL／Redis／worker／local storage，驗證 1→2 份、讀取新增 100 筆不建工作、最新下載 10 次工作數不變、最新缺檔不回退、同部門及移部門權限，以及既有 worker 復原／Range 保護。
- ZIP 解開後確認兩個 entry：`副本__合成簽署人_<publicId>.pdf`、`副本_後來簽署_<publicId>.pdf`，分別逐 byte 比對不同的有效 PDF 來源。
- Chromium 真實 Next/API/worker 整合：1 人完成 → 加第 2 人 → 過時提示 → 點更新 → 2 份結果與下載；未 mock network。1 test 通過，畫面顯示 2/2 簽署、2 份 ZIP、「下載本次成果」。
- server lint：0 errors／291 warnings（包含既有 warnings）；client lint、server build、client webpack build 通過。
- 使用者確認沒有 ZIP expired 資料後，移除本票 ZIP service／repository 工作狀態相容分支與對應斷言，以及無 caller 的 archiveFile。依後續澄清，保留共用 EsignExportStatus／ExportHistoryView 的 expired（不推斷 Excel／PDF 資料），保留 expiresAt 欄位／index／API，不做 migration。文件期限及來源檔案 archive 狀態不受影響。

### 執行命令

以下在隔離 worktree 執行；pnpm 設定僅避免依賴 symlink 觸發重裝，不略過任何測試或 hook。

```bash
pnpm --config.verify-deps-before-run=false -C server test --runInBand
pnpm --config.verify-deps-before-run=false -C server test:e2e --runTestsByPath test/esign-export.e2e-spec.ts
pnpm --config.verify-deps-before-run=false -C server lint:check
pnpm --config.verify-deps-before-run=false -C server build
pnpm --config.verify-deps-before-run=false -C client lint
pnpm --config.verify-deps-before-run=false -C client build --webpack
pnpm --config.verify-deps-before-run=false -C client exec tsc --noEmit
```

瀏覽器 harness 保存在本機 `/tmp/spec030-browser/ticket01-browser.e2e-spec.ts`（合成 fixture；session cookie 僅在記憶體），截圖為 `/tmp/spec030-browser/ticket01-updated.png`。使用既有環境加外部 Playwright，不變更 repository dependencies。重跑時先複製 harness 至 `server/test/spec030-browser.e2e-spec.ts`，完成後移除臨時測試：

```bash
API_PROXY_TARGET=http://127.0.0.1:3031 pnpm --config.verify-deps-before-run=false -C client dev --webpack --port 3030
# 另一個 terminal；harness 啟動合成 API 在 3031
AUTH_TRUSTED_ORIGINS=http://localhost:3030 CORS_ORIGIN=http://localhost:3030 pnpm --config.verify-deps-before-run=false -C server test:e2e --testRegex spec030-browser.e2e-spec.ts --runTestsByPath test/spec030-browser.e2e-spec.ts
```

本機輸出保存在 `/tmp/spec030-01-{unit-all,e2e,browser,server-lint,client-lint,server-build,client-build}.log`；移除 expired 分支後 e2e 一度因既有 read-ahead 計數包含目的端啟動前的完整性讀取而失敗（102／171；原門檻 64）。將計數限定為目的端已啟動但尚未消費期間後，保持原門檻再跑 7/7 通過，輸出 `/tmp/spec030-01-e2e-recheck.log`。針對性初次輸出是 `/tmp/spec030-01-e2e-final.log` 與 `/tmp/spec030-01-client-typecheck.log`。這些暫存證據不是正式持久化 CI artifact。

### 驗收覆蓋及限制

| 成功條件 | 本票證據／後續 |
| --- | --- |
| SC-001 | 已驗證 1→2 份及真實 ZIP 內容 |
| SC-002 | 已驗證新增 100 筆、反覆預覽不建工作 |
| SC-003 | 已驗證最新重複下載 10 次；10 session 並發待 ticket02 |
| SC-004 | 固定 13→14 範圍與離頁恢復待 ticket02 |
| SC-005 | 原子取代與舊版停用待 ticket03 |
| SC-006 | 真實刪檔與恢復待 ticket03 |
| SC-007 | 已取代歷史、舊連結待 ticket03／整合 |
| SC-008 | 6,000 份容量驗證待整合票 |

未驗證 S3、舊版清理、完整並發／重試、雙 session 取代。Next 預設 Turbopack build 因隔離工作區的外部 node_modules symlink 失敗，webpack build 已通過；最終整合工作區仍須執行預設 root build/lint。沒有 client test script，瀏覽器證據不等同 client 單元測試。T005 的新增 exportState 僅屬 export preview，沿用既有 document summary 型別，無須修改 esignDocuments.ts。

### Ticket 01 整合驗證

- Merger 核對 6d93e69 相對 25a3fef 的差異與上述實際測試證據，fast-forward 整合成功。
- 在整合 worktree 執行預設 `pnpm build`（未傳 webpack）成功，包含 Nest build 與 Next Turbopack build；日誌 `/tmp/spec030-merge01-build.log`。隔離 worktree 的 symlink 限制不影響整合 build。
- 額外核對文件期限型別及推導未變、共用匯出 expired 保留、expires_at/index/API 沒有 schema 變更，無關使用者檔案保持未追蹤且未修改。
