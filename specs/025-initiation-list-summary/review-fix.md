# Final review fix — FR-013 確認日期與列表日期一致

## 問題與決策

Review 指出新列表的固定台北期間格式化，與既有編輯器 `dayBoundary()` 的瀏覽器本地日曆日不一致。FR-013 要求沿用既有日期規則且確認日期不偏移；使用者只有針對「建立時間」要求新增欄位，沒有要求改造全部簽署期間時區。

最小修正僅在 listQuery.ts：期間 formatListDate 沿用既有 formatDate，日期篩選回到相同本地日曆日。受理摘要來源、排序、正式統計、資料庫／API 時間、編輯器保存及送出均不變。formatCreatedTime 仍固定 Asia/Taipei。沒有修改全域 dates helper 或 project instructions。

## Red → Green（真實瀏覽器）

- 專屬測試庫 feastogether_intranet_test025r、Redis16331、fake mail/local storage、Nest13045、Next13046；合成員工與文件，不寄真實郵件。
- Chrome timezone America/Los_Angeles，實際在兩個 DateCalendar 點選開始 `2026/11/10`、結束 `2026/11/30`，再按「發起簽署」。
- 送出期間為 `2026-11-10T08:00:00.000Z`～`2026-12-01T07:59:59.999Z`，符合原本瀏覽器本地日界線。
- Red：列表顯示 `2026/11/10`～`2026/12/01`，對 `2026/11/30` 的斷言失敗。
- Green：相同實際操作顯示 `2026/11/10`～`2026/11/30`、`0/1`，重新整理後一致。
- 日期篩選：12/01 單日不包含文件，11/30 單日包含；使用 endAt 升冪排序路徑仍正常。
- 原始 createdAt `2026-11-04T01:13:00Z` 仍顯示台北 `2026/11/04 09:13`，page errors 0。
- 初次 green 重跑因先前同名合成文件仍存在造成 locator 非唯一；改用本次文件唯一編號定位後重跑通過，無修改產品行為來避測。

## 證據

- 瀏覽器腳本：`/tmp/spec025-review-browser-check.cjs`
- Red：`/tmp/025-review-red.log`
- Green：`/tmp/025-review-green.log`
- 點選日曆截圖：`/tmp/025-review-selected-dates.png`
- 最終列表截圖：`/tmp/025-review-list-green.png`
- `pnpm -C client lint` 與標準 `pnpm -C client build` 均通過；輸出位於 `/tmp/025-review-lint.log`、`/tmp/025-review-build.log`。

先前 validation-02 固定 UTC fixture 的台北期間證據保留為歷史紀錄，以本次實際編輯器流程驗收為準。此修正不重跑無影響的 60 次容量矩陣；未宣稱量測值是新時區流程的效能證據。
