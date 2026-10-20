# Spec009 匯出容量驗收（ticket09）

日期：2026-10-21（Asia/Taipei）。狀態：本機容量與故障驗收完成；部署 S3 門檻移交 ticket11。T028 **尚未完成**，不代表部署 S3 容量通過。

## 環境與方法

- Apple M5 Pro，15 logical cores，24 GiB RAM，macOS Darwin 25.6.0，Node v26.4.0；MySQL 8.4.11 與 Redis 8.8.0 同機（不是 repo 概觀所列 Redis 7，不能當該部署版本驗收）。API 與 WorkerModule 是不同 process，使用 ts-node（包含轉譯/模組載入記憶體），非 production compiled runtime。
- 真 HTTP / session / guards / MySQL migration / Redis BullMQ / LocalPrivateFileStorage；合成 HR provider；來源 fixture 直接建立於獨立 `feastogether_intranet_test_capacity_*` DB。背景副本產生亦用真 queue/processor，未暫停正常 finalization。
- 24 種有效 fixed-seed PDF，涵蓋文字向量、JPEG 掃描、PNG 掃描、混合報表；重複 250 次為 6,000 個不同來源路徑，合計 **6,244,040,250 bytes（5.815 GiB）**。hardlink 與重複內容造成 warm-cache 偏差，不是 6,000 份真實人資文件。
- 每份新文件首次建立 6,000-entry snapshot，七日重用不納入受理 latency。STORE 三輪、DEFLATE 1 / 6 各一輪；5 個受理樣本的 nearest-rank p95 等於最大值，不能推論部署 SLO。
- 正常簽署：每輪 60 個不同員工，同一份一頁文件、1 個 signature field、watermark=false；預先建立 sessions/task consent；閉迴路併發 2、無 think time。預熱 20 次不入樣本。每組前等待上一組所有 signed personal copies ready。所有 export 組測量發生在 HTTP 確認 processing 之後、最後 submit 後再確認仍 processing；失敗不從統計排除。
- 原始逐 request status/ms/timestamps、各 worker source SHA、RSS/heap/external/CPU 每 250ms 採樣與驗證摘要保留；API process 同時是 fixture/measurement orchestrator，因此全程序峰值不能直接當正式 HTTP server 記憶體需求。
- Python stdlib zipfile 獨立逐 entry 檢查唯一檔名、bytes、CRC、SHA-256、ZIP64 EOCD/locator；未把 ZIP 放入記憶體。第一份 STORE HTTP 中斷於收到至少 8 MiB 後，Range/If-Range 接續；合併檔的 bytes/SHA 與成果一致。

## 保留的失敗與診斷

第一次 6,000 份 STORE：受理 336 ms、22.85 秒完成、6,245,350,572 bytes，所有 entry 與中斷續傳 hash 通過。但 baseline / export 簽署 p95 為 16.14 / 32.91 ms（+103.9%）。該次前組僅固定等待 2 秒，後續改為確認所有副本 ready；不以此輪當正式 gate。

確認 drain 後，原版 STORE 三輪仍未達「簽署 p95 增幅 ≤20%」：

| 輪次 | 受理 ms | 匯出秒 | baseline p95 ms | export p95 ms | 增幅 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 294.47 | 21.78 | 17.68 | 31.93 | 80.6% |
| 2 | 293.68 | 22.34 | 21.07 | 33.58 | 59.4% |
| 3 | 313.28 | 22.37 | 17.85 | 36.93 | 106.9% |

修正一：用 recordId Map 取代重複線性 find/some；進度完整稽核 save 最多每秒一次，最後一份仍同步保存，租約與 generation fencing 保留。固定此版本重新跑 STORE 三輪，完整性與續傳全過，打包約 10.9 秒，但各輪簽署增幅仍 86.4% / 42.8% / 29.7%，**仍未通過 gate**。不以較低的絕對延遲為由降低規格門檻。

診斷 run `full2` 的 STORE 是舊版，後續 DEFLATE 子程序載入了修正一，因此不把該混合版本 run 用作演算法正式比較。正式比較必須以每 worker source hash 一致的完整 run 為準。

## 固定最終版本的本機結果

修正二：受理時同次保存已固定副本的 resolved metadata；worker 只查 snapshot 沒有 file 的未解決項，無變化不再重存 resolved JSON。快照查詢只載入檔名/識別所需欄位，減少 API entity 記憶體。所有寫入仍使用稽核 save，generation fencing、完整性驗證與最後進度均保留。

最終 full4 使用相同 production source hash，固定上述同負載，不降低 gate。原始數據見 [performance-evidence](performance-evidence/README.md)。

| 模式 | 匯出秒 | ZIP bytes | 比 STORE 節省 | worker CPU 秒（採樣窗口） | worker peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| STORE 1 | 10.966 | 6,245,350,572 | — | 20.99 | 488.61 |
| STORE 2 | 10.905 | 6,245,350,572 | — | 21.28 | 434.03 |
| STORE 3 | 10.909 | 6,245,350,572 | — | 21.28 | 427.88 |
| DEFLATE 1 | 94.876 | 6,230,593,236 | 0.236% | 128.59 | 548.05 |
| DEFLATE 6 | 92.297 | 6,229,996,236 | 0.246% | 125.67 | 549.91 |

本次已壓縮 PDF 合成分布下，STORE 明顯較快；DEFLATE 的尺寸節省小。保留正式 STORE；這不是所有 PDF 或部署 S3 網路的普遍結論。

- **首次受理 p95 250.79ms ≤5秒**：5 個不同文件的新 6,000-entry snapshot，全部 HTTP 202，不含重用。
- **正常簽署 pooled p95 19.42 → 22.16ms，+14.11% ≤20%**：STORE 三輪各 60、合計 baseline/export 各 180 個樣本，全部 HTTP 201，測量全段落在 processing；無簽署失敗。單輪增幅 +33.88% / +7.14% / -1.81%，第一輪尖峰仍存在，不聲稱每一輪或所有部署負載都通過。
- 五份 ZIP 均 >4GiB；每份 6,000 唯一名稱、bytes/CRC/SHA、ZIP64 獨立驗證全過，無漏件。第一份 STORE 中斷後 Range/If-Range 接續，全檔 bytes/SHA 相同。
- processing 區間 API peak RSS 524.03 MiB，worker peak 549.91 MiB，無 OOM。這是兩程序 RSS（含 ts-node、fixture orchestration），不包含 MySQL/Redis/OS page cache，也不是無上限文件數的記憶體保證。CPU 秒含同 worker 的正常 finalization，採樣窗口略小於 HTTP elapsed。

## 故障驗收與限制

- 既有 ticket07：enqueue failure / maintenance 補列、來源副本失敗後同快照 retry、竄改阻擋發布與 retry、舊 generation 不能發布、兩 worker 全域單工作、慢目的端背壓、七日到期與 Range 邊界。
- 真 SIGKILL：已寫入 575/6,000 份後殺指定 worker；啟動兩個 OS worker 並加入另一個 6,000-entry 工作，兩份均完成、processing 峰值 1；原工作 attempts=2、snapshot hash 不變，舊 staging/temporary 已清除，復原 ZIP 全 entry 驗證通過。業務租約以測試時鐘提前，BullMQ 真鎖/停滯偵測正常等待。
- 真 HTTP 缺檔復原：來源移除後 failed 且無成果；放回相同 bytes 後沿用同一 job/snapshot 重試完成，可 Range 下載。既有竄改流程仍拒絕重試。
- 本次新增 local storage 的 ENOSPC 邊界注入測試：不填滿真磁碟；發生 ENOSPC 時銷毀來源、刪除 temporary，後續 retry 完整保存。此為 I/O fault injection，不宣稱真實檔案系統填滿測試。
- ticket08 的真 HTTP S3-compatible 小量 multipart/abort/Range/版本物件驗證不能代替部署吞吐。**未提供部署機器、S3 bucket/IAM/網路，部署 S3 >4 GiB / 6,000 份容量與簽署 p95 未驗證。Moto completion 全量累積物件，禁止拿它跑此容量。**

重跑方式見 [`server/test/performance/README.md`](../../server/test/performance/README.md)。原始合成 PDF、ZIP 與 env 不提交 repository。

部署環境尚未驗證的原有門檻已移交 [ticket11](../../.scratch/009-esign-document-delivery/issues/11-deployment-s3-capacity.md)（ready-for-human）；T028 保持未勾選。本機驗收完成不等於整體部署容量驗收完成。

## 程式驗證

server：99 suites / 840 unit tests、4 個匯出 e2e、build、lint（0 errors）通過。容量工具另經獨立 TypeScript typecheck；量測後工具整理用 24 份 HTTP/worker/ZIP/Range smoke 驗證，該 smoke 不計入容量 gate。未新增 migration、正式環境變數或 dependency；client 無變更。
