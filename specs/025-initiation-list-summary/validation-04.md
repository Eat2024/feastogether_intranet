# Ticket 04 — 大名單與整體驗收

## 環境與邊界

- 基線：整合分支 `55fe5ee`，包含 tickets 01～03；工作分支 impl/025-04。
- 本機原生 MySQL，僅使用 `feastogether_intranet_test025d`（瀏覽器／worker）及 `feastogether_intranet_test025e`（自動測試），合成 Portal 使用相同安全前綴與隨機後綴。
- 自建 Redis localhost:16329，瀏覽器／worker DB1，自動測試 DB2。強制 NODE_ENV=test、ESIGN_MAIL_DRIVER=fake、local storage；沒有真實 SMTP。
- Chrome、真實 Next（13046）及 Nest（13045）；瀏覽器資料不是 API 攔截 fixture。測試腳本及私有 session 檔放 /tmp，不提交個資／憑證。
- 測試邊界為既有 HTTP 列表／受理、repository 大型排序回歸、實際瀏覽器可見列及獨立 worker。未新增 framework、dependency、schema 或 production 設定。

## 大型 JSON 回歸修復與敏感度

原 `esign-initiation-query` 大型測試替換 getManager，新的列表已改用 transaction manager，因此原測試只看到其他查詢，沒有真正觀察排序查詢。補上必須捕捉排序 SELECT 的斷言後，保留舊 spy 的敏感度測試失敗（Expected >0／Received 0）；改為同一真實交易 manager 後通過。

- 22 份工作各包含 5,213 位合成收件人，大於 256 KiB；sort_buffer_size 固定 262144，指定原 UAT 的 deleted_at 索引路徑。
- 排序 SQL 不含 input_json、JSON_EXTRACT 或工作明細 JSON；只有一筆無排序日期投影，API 不回傳完整輸入。
- 有有效工作之單文件基準與增加 22 份文件後 SELECT 次數相同；每份摘要 totalCount=5213，正式 pendingCount 仍為0。
- `esign-document-list-scale` 同時保留已發起大型簽署快照回歸，追加 5,213 人受理輸入與日期／人數驗證。
- 兩連線一致性回歸中，列表 transaction 保持開啟時，真正工作執行可由另一連線提交成功或失敗；不需等列表解除讀取，證明未加悲觀鎖阻塞 worker。下一次列表收斂至終態。

## 瀏覽器 60 樣本矩陣

每個人數建立 20 份不同文件，worker 暫停。從瀏覽器送出真實 POST（前置解析完成位置）起，經受理、完整頁面導航、實際列表列可見且斷言日期／0/N 正確為止。P95 採 nearest-rank。

| 人數 | 樣本 | POST P95 | 提交至列表可見 P95 |
| --- | ---: | ---: | ---: |
| 1 | 20 | 11.5 ms | 265.1 ms |
| 100 | 20 | 9.8 ms | 202.6 ms |
| 5,213 | 20 | 83.9 ms | 316.3 ms |

這 60 次使用已確認的合成外部收件人，從瀏覽器直接送真實 POST，再載入產品列表；沒有模擬內部員編解析，也不是完整編輯器逐次點選流程。這些數值支持 SC-001 所定義「前置解析完成後至列表可見」目標，不代表 5,213 位內部員工從最初點擊的端到端等待時間。

另實際透過產品編輯器，對已儲存的 5,213 位合成外部收件人點擊「發起簽署」：

- 點擊 → 列表可見：2600.8 ms。
- 點擊 → 發起請求開始：179.7 ms（外部名單無員編解析）。
- 發起請求開始 → 列表可見：2421.1 ms。
- 顯示發起中、確認期間、0/5213；等待31秒且重新整理後仍正確，之後才啟動 worker。
- Browser page errors：0。建立時間及窄螢幕完整驗收已在 tickets01／02完成。

原始證據：`/tmp/025-04-matrix.json`、`/tmp/025-04-matrix.log`、`/tmp/025-04-5213-visible.png`；harness 為 `/tmp/spec025-04-browser-harness.cjs` 與 `/tmp/spec025-04-browser-matrix.cjs`。

## 獨立 worker 與通知

矩陣與實際按鈕樣本全部受理後，fork 真實 WorkerModule：API PID55823、worker PID55988，證明不同程序；resume 唯一自建測試 queue。61份文件全部 succeeded、attemptCount=1，totalCount=processedCount=正式簽署人數=distinct publicId 人數，沒有重複指派。

| 人數 | 文件數 | 背景執行最短～最長 |
| --- | ---: | ---: |
| 1 | 20 | 0.007～0.044秒 |
| 100 | 20 | 0.020～0.034秒 |
| 5,213 | 21 | 0.768～1.051秒 |

以上背景時間只計 startedAt→completedAt，不含排隊、列表呈現或郵件投遞。通知 queue 暫停且 adapter 為 fake，不宣稱真實寄信耗時／收件匣成功。原始不含憑證的結果在 `/tmp/spec025-04-summary.json`。

另新增真實通知 processor 回歸：外部合成收件人不在白名單，通知實際記錄 skipped／MAIL_RECIPIENT_NOT_WHITELISTED，但 job 保持 succeeded、列表 active、initiation=null、pendingCount=1。這是寄信略過與發起狀態分離的執行證據，不只是程式範圍推論。

## 驗證指令與結果

- `node /tmp/run025-04-e2e.cjs --conditions=development ./node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand --forceExit esign-initiation-query esign-initiation-list-consistency esign-initiation-locks esign-initiation-acceptance esign-document-list-scale`：5 suites／43 tests 全通過，沒有跳過舊大型案例。
- `node /tmp/run025-04-e2e.cjs --conditions=development ./node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand --forceExit esign-initiation-capacity`：14 tests 全通過；追加5,212位有效員工加1位不存在員工的失敗案例，整份回到草稿、無部分指派。
- `pnpm -C server test --runInBand`：119 suites／1218 tests 通過。
- `pnpm build`：server build 與標準 Next Turbopack build 通過。
- `pnpm lint`：0 errors，server 272項既有 warnings，client 通過；新增 Job 型別警告已修正。
- 隔離 wrapper 僅私下讀取本機 credentials，強制測試 DB 名稱及 fake/local；未變更 repo .env。

## 發布與限制

- server 先提供 nullable initiation，再部署 client。舊 client 可忽略新欄位；新 client 對舊 server 缺少摘要時保留原顯示，不能捏造資訊。
- 無 migration／新增 env／dependency；回滾僅程式碼，工作受理資料與正式簽署證據保持原有規則。
- 範圍為摘要、建立時間、日期篩選與快取；沒有更動員工同步、白名單政策、worker正式寫入或簽署權限。
- 未部署 UAT；本機合成資料結果不保證 UAT 延遲。外部名單無員編解析，不能聲稱已量測完整內部員工解析時間。
- 尚待整合分支的最終 code review；本紀錄不代表 review 已完成。

- 自建 API13045、Next13046、獨立 worker 已停止；自建 Redis16329 於驗收結束停止，未觸碰其他票或使用者服務。
