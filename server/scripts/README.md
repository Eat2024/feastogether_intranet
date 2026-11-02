# ZIP 保存政策轉換

`normalize-export-retention.ts` 是 Spec 019 的一次性工具，不由 server 或 worker 自動執行，也不建立資料表或重新產生 ZIP。

先停止舊版匯出 worker、排空處理中工作並暫停匯出寫入，備份 DB 及檔案 metadata。工具不會停止其他程序。實際操作前核對環境與盤點報告，不能把正式清單、執行紀錄或檔案提交至 Git。

從 `server/` 執行，使用既有設定檔（自行替換受控路徑）：

```bash
node --conditions=development --env-file=/受控位置/環境設定 \
  -r ts-node/register scripts/normalize-export-retention.ts \
  --output /受控位置/zip-retention-review.json
```

預設只盤點，output 必須是新檔。報告含目標指紋、job/document/file ID、原政策前值與產物指紋，不含姓名、信箱、檔名、object key 或完整快照。每個產物以串流核對大小與 SHA-256。

- ready：原檔存在且核對成功，可轉不限期保存。
- unchanged：已 completed、期限 null、檔案 active，不需寫入。
- unavailable：缺檔、損毀、查核失敗或資料異常，不恢復、不重建；需另查儲存服務／備份。
- fixed=true：該文件最新曾完成工作；即使不可用也不改選其他 ZIP。其他可用歷史仍可依原識別下載。

核對後，用原報告或從中保留已核准項目的清單（不自行改其前值或指紋）顯式執行：

```bash
node --conditions=development --env-file=/受控位置/環境設定 \
  -r ts-node/register scripts/normalize-export-retention.ts \
  --apply /受控位置/zip-retention-review.json \
  --receipt /受控位置/zip-retention-apply.json
```

apply 前先以 0600、禁止覆寫的新檔保存原清單並同步磁碟，包含可供受控回復的前值。逐筆交易鎖定 job/file 並再次驗證原檔、政策及指紋，只更動 status、expiresAt、archiveStatus 與必要 updatedAt；不改建立時間、快照或檔案。結果存於 `<receipt>.results.json`。

結果為 applied、unchanged、unavailable 或 changed。changed 表示盤點後資料已變動，應重新盤點核對。可用原清單重跑，成功項目回 unchanged 且不寫入；每次須使用新 receipt 路徑。各項目獨立交易，程序中斷不會自動回滾已提交項目，可依 receipt 及重新盤點確認進度。

exit code：0 為指定項目處理完成；2 為有 unavailable/changed 未處理；1 為工具未完成。來源原始錯誤不印到 console，避免洩漏連線或物件資訊。

套用後重新盤點，確認 active 產物不被孤兒清理，驗證固定 ZIP 下載，再啟動新 worker／恢復流量。**不得直接恢復舊版到期清理 worker**。回滾須停流量並使用受控前值與相容版本／整體備份；工具不提供自動回滾，不能恢復已刪除原檔。

驗證指令（僅使用 feastogether_intranet_test* 隔離 DB）：

```bash
pnpm exec tsc -p scripts/tsconfig.json --noEmit
pnpm exec eslint scripts/normalize-export-retention.ts test/export-retention.e2e-spec.ts
pnpm test:e2e --testPathPatterns=export-retention
```
