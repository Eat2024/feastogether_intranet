# Spec023：5,001 人切換前後容量量測

本文件保留資料來源切換當時的歷史量測；後續使用者授權的批次寫入優化結果見 [batch-write-performance.md](batch-write-performance.md)。

量測日期：2026-11-03。切換前產品程式為 `5c79e52`；切換後為本功能工作樹。每組三次，全部串行執行，使用同一個本機 MySQL／Redis。執行器為 arm64、Node v26.4.0、pnpm 11.9.0。所有名單與信箱都是合成資料，沒有真實寄信。

## 方法與限制

- 使用真實 Nest HTTP、MySQL、Redis 與通知 worker；名單解析每次最多 100 人，5,001 人共 51 次 HTTP。所有帳號在量測前已存在，因此不包含舊版查無帳號後逐人呼叫 HR、建立帳號的成本。
- 切換前信箱服務經 HttpService mock，以 setImmediate 回傳，沒有實際人資網路延遲；policy 的部門樹與信箱服務直接回傳合成資料。切換後 Email 由 users 讀取，HR 呼叫被測試禁止。不可將本表當作 UAT 提速倍數或實際 HR 延遲測量。
- 切換後 fixture 在首次寄送前將白名單對應的合成 users 寫入 DB；這段成本包含於 worker 時間，不包含於 policy 時間。切換前 fixture 使用記憶體中的合成人資名單。兩邊均使用真正的白名單 policy，沒有全域放行。
- DB query 數由 TypeORM logger 計數，含交易控制、授權查詢與業務寫入。policy 的 query／時間為所有呼叫累加，已包含於 worker；不可再次加總至 worker。Email 階段是獨立讀取測試，不應加到 initiation HTTP（後者已包含自己的 Email 讀取）。
- 每輪亦驗證故障不留下部分發起；下表列成功路徑。切換前注入 HR 故障，切換後注入本機資料查詢／狀態失效，故障注入邊界不同。
- 測量環境含測試 spy、合成寄送器與測試斷言；不是 production 壓力測試，不包含 SMTP、PDF 實際簽署或真實 HR。有效輪次順序為 before 1／2、after 1／2／3、before 3；原 before 3 可能與其他測試重疊，已棄用並補跑。存在快取與機器負載差異，亦不宣稱每輪空 DB 或冷快取。

## 每次結果

時間單位為毫秒；括號為 DB query 數。

| 版本／次數 | 解析 | Email 查核 | 發起 HTTP | 通知 worker | policy 累加 | policy 次數 |
|---|---:|---:|---:|---:|---:|---:|
| before 1 | 159 (102) | 88 (11) | 16,360 (50,095) | 64,633 (56,939) | 85 (101) | 101 |
| before 2 | 166 (102) | 82 (11) | 17,415 (50,095) | 67,282 (56,939) | 87 (101) | 101 |
| before 3 | 181 (102) | 82 (11) | 17,519 (50,095) | 63,948 (56,939) | 85 (101) | 101 |
| after 1 | 170 (102) | 61 (13) | 15,332 (50,073) | 69,406 (57,062) | 2,195 (202) | 101 |
| after 2 | 165 (102) | 60 (13) | 14,990 (50,073) | 66,856 (57,062) | 2,027 (202) | 101 |
| after 3 | 164 (102) | 58 (13) | 15,088 (50,073) | 67,719 (57,062) | 1,957 (202) | 101 |

## HR 呼叫計數

| 階段 | 切換前（每輪） | 切換後（每輪） |
|---|---:|---:|
| 解析已存在帳號 | 0 | 0 |
| 獨立 Email 查核 | 51 次 mock staff_emails；最大並行 4 | 0 |
| 成功發起 HTTP | 51 次 mock staff_emails；最大並行 4 | 0 |
| worker policy | 101 次合成組織樹 + 5,151 次合成 getStaffEmails | 0 |

前兩個信箱路徑的 51 次由 batches 計數直接量得。policy 的服務呼叫數依實際量得 101 次 policy，及舊 policy 每次取得組織樹、將固定 5,001 人分成 51 批推導；這些是直接 stub 的服務呼叫，不是實際 HTTP 請求。所有版本的真實外部 HR HTTP 請求均為 0。

## 判讀

- before 中位數：解析 166 ms、Email 查核 82 ms、發起 HTTP 17,415 ms、worker 64,633 ms。
- after 中位數：解析 165 ms、Email 查核 60 ms、發起 HTTP 15,088 ms、worker 67,719 ms。
- 已證明本機來源路徑可完成 5,001 人解析、發起與寄送查核且不需要 HR；尚未證明完整同步發起能符合前端代理等待時間。大量簽署人／通知寫入仍是獨立成本，應由 Spec022 背景發起處理。

## 可重現資料

- 完整 log：`/tmp/spec023-benchmark-before-{1,2,3}.log`、`/tmp/spec023-benchmark-after-{1,2,3}.log`。
- 結構化彙總：`/tmp/spec023-benchmark-results.json`；彙總程式：`/tmp/spec023-benchmark-summary.py`。baseline 測試差異保留於 `/tmp/spec023-benchmark-baseline-instrumentation.patch`。
- 測試：`server/test/internal-email-capacity.e2e-spec.ts`，指令 `pnpm -C server test:e2e --runTestsByPath test/internal-email-capacity.e2e-spec.ts -t '5001|6000'`。使用現有 DB／Redis 環境設定指向隔離測試資源；不得指向 UAT 或 production。
- baseline 的改動限測試量測 instrumentation、6,000→5,001 的 fixture／尾批斷言；產品程式未修改。早期尾批索引仍指向第 6,000 人的失敗／中止 log 不列入結果。

## 發起 HTTP 的單次細項追蹤

使用者追問 N+1 後，另以同樣 5,001 人增加方法層級 spy，量測不重疊區間。這是單次診斷，不加入前述三輪中位數；額外 instrumentation、執行時負載不同，總時間為 19,110 ms，不能拿它與 15,088 ms 直接當作效能退步。

| 步驟 | 呼叫次數 | 時間 ms | DB query |
|---|---:|---:|---:|
| 員工與 email 批次查核 | 1 | 53 | 11 |
| 簽署人第一次保存 | 1 | 4,424 | 10,002 |
| 欄位建立 | 1 | 7 | 4 |
| 簽署人第二次保存 | 1 | 2,983 | 10,023 |
| 通知紀錄保存 | 1 | 2,933 | 10,002 |
| 稽核事件追加 | 5,002 | 8,095 | 20,008 |
| 其他（授權、文件、入列、回應等） | — | 615 | 23 |
| 合計 | — | 19,110 | 50,073 |

主要的逐人重複讀寫在 `EsignAuditService.append`：每筆重新鎖文件、讀最新事件，再追加稽核。發起包含 5,001 筆 signer.assigned 與 1 筆 document.initiated。SignerRepository.saveMany 的 TypeORM save(array, {chunk:250}) 也不代表單一批次 INSERT，且發起保存簽署人兩輪；通知同樣使用 save(array)。

後續批次寫入優化應維持完整稽核與交易：單次鎖文件並取得起始 hash，在記憶體按順序計算 hash 鏈後批次追加；簽署人預先準備固定 email、通知批次保存並核對生成 ID／快照／hooks。不可把稽核迴圈直接改 Promise.all。本次僅量測與記錄，沒有擴大修改這些寫入語意，也未完成 Spec022 背景發起。

診斷 log：`/tmp/spec023-initiation-breakdown.log`；測試輸出標記 `SPEC023_INITIATION_BREAKDOWN`。
