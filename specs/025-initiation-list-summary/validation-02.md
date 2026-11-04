# Ticket 02 驗證紀錄

日期：2026-11-04。基線：impl/025-integration `4fd3a3a`，ticket 01 已 resolved。實作位於 impl/025-02，無 migration、env 或 dependency 變更。

## 結果

- T009：HTTP 真實資料庫讀取驗證 queued／processing／retry 三階段，建立人及同部門原可讀者可重讀相同摘要；跨部門者列表沒有該文件、詳情回 404。摘要精確只含日期與 totalCount，無名單、信箱、租約或 job ID。
- T010：修正列表日期篩選／排序仍使用舊草稿日期的缺陷，改用 documentListDisplay；顯示與日期篩選統一台北日曆日。建立時間與日期在 LA 瀏覽器時區仍顯示台北，詳情頁既有時間 helper 不變。進度排序同步使用畫面顯示數值。
- T011：三階段均實測標題、草稿設定、簽署人替換、刪除與重複發起回 409 ESIGN_INITIATION_IN_PROGRESS；工作識別不能開啟簽署任務、本人任務列表沒有未完成文件。既有 processing 大矩陣及並發異動測試亦通過。

## Red → Green 與工具

已確認測試接縫為既有列表 HTTP 合約及瀏覽器列表行為，與核准的 tasks／plan 一致。

- 修改前，已受理期間 2026/11/04、舊草稿期間一月，日期篩選回空陣列；獨立驗收腳本 `/tmp/025-02-list-query-check.cjs` 的預期文件 ID 斷言失敗。
- 修正後同腳本在 `TZ=America/Los_Angeles` 與 `TZ=Asia/Taipei` 通過：期間篩選、開始／結束排序、台北日期顯示。
- client 無測試框架，本次未新增框架；上述是一次性可重跑驗收腳本，並非宣稱有 client test suite。

## 真實 MySQL／HTTP

專用測試 DB：`feastogether_intranet_test025b`；本機 Redis 16325 DB2；fake mail、local storage，無真實寄信。
啟動器 `/tmp/run025-02-test.cjs` 只讀取原設定並安全覆蓋本機測試連線，不輸出秘密。

```bash
node /tmp/run025-02-test.cjs --conditions=development ./node_modules/jest/bin/jest.js --config ./test/jest-e2e.json --runInBand --forceExit esign-initiation-query esign-initiation-locks --testNamePattern='^(?!.*22 份大型工作輸入)'
```

結果：2 suites、23 tests passed、1 skipped，耗時 7.57 秒。原 022「22 份大型工作輸入」案例仍假設列表不讀任務，且 getManager spy 不再覆蓋新的一致性交易，因此留待 ticket 04 按新需求更新，未宣稱整個 query suite 全數完成。其餘舊 worker-before-draft 情境已更新為新 initiating 摘要合約。

原始輸出：`/tmp/025-02-e2e.log`。

## 真實瀏覽器

Chrome headless + 本票 Next（13028）+ Nest（13027），合成部門／文件。從已可靠受理的真實工作讀取列表，未 mock 列表回應。

腳本：`/tmp/spec025-02-browser-harness.cjs`、`/tmp/spec025-02-browser-check.cjs`。

通過情境：

- 使用受理期間的日期篩選、開始時間升／降冪排序。
- LA 瀏覽器時區仍顯示台北日期 2026/11/04、建立時間 2026/11/04 09:13。
- reload、同 session 第二分頁、同部門讀者 reload 均看到一致摘要與 0/1。
- 跨部門讀者看不到文件。
- 390px 寬度下建立時間表頭存在，表格可水平捲動。
- Page errors：0。

截圖：`/tmp/025-02-filter-sort.png`、`/tmp/025-02-mobile.png`。只含合成資料。

## Build／Lint

- 初次使用外部 symlink node_modules 時 Turbopack 拒絕超出 filesystem root；這是 worktree 環境問題。以 frozen lockfile、offline pnpm install 安裝既有依賴後，root `pnpm build` 成功（server + client）。
- root `pnpm lint` 成功；server 272 項既有 warning、0 error。
- `git diff --check` 通過。
- Next dev 自動追加的 AGENTS 區塊已還原，未提交與本需求無關的規則變更。

## 限制與後續

本票沒有執行 5213 人效能矩陣，屬 ticket 04；終態雙連線一致性與舊回應覆蓋防護屬 ticket 03。
未部署 UAT，未開 PR、未推送。等待 merger 整合後才可將票標 resolved。

## 最終 review 修正註記

本票驗收時將列表期間改為台北日曆日，後續 review 發現與既有編輯器的本地日曆日語意不一致。上述固定 UTC fixture 的 LA 顯示結果僅為當時版本證據，不能代表實際選日期的正確性。最終版本已恢復簽署期間的原有本地日曆日格式化與篩選；建立時間仍固定台北。實際點選日曆的 red／green 證據見 [review-fix.md](review-fix.md)。
