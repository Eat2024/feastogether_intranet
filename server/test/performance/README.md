# Spec009 合成容量驗收

此 harness 以真 Fastify HTTP、員工 session、MySQL migration、Redis BullMQ、獨立 WorkerModule 子程序與 LocalPrivateFileStorage 驗收。不是 fake repository 或記憶體 null sink。HR 身分查詢使用合成員工 provider；PDF 與 PNG 均無個資。產生 fixture 直接寫隔離 DB；量測受理與簽署均走正式 HTTP。不要在正式環境執行。

## 執行

先取得獨占測試 Redis 使用時段（沿用 `.env.test` DB，**不執行 flush**）；MySQL 必須是新的 `feastogether_intranet_test_capacity_*` DB。storage/output 必須用新的空目錄。需要 pnpm 安裝依賴、Python 3；corpus generator 的 JPEG encoder 是 macOS `sips`。

```sh
# repository root；產生 24 種固定 seed PDF 與 manifest，約 25 MB。
node server/test/performance/generate-export-corpus.cjs "$PWD" /tmp/esign009-capacity-corpus
cd server
DB_MYSQL_DB=feastogether_intranet_test_capacity_run01 \
ESIGN_STORAGE_DRIVER=local ESIGN_STORAGE_ROOT=/tmp/esign009-capacity-run01 \
node --env-file=.env.test --conditions=development -r ts-node/register \
  test/performance/esign-export-benchmark.ts run \
  /tmp/esign009-capacity-results01 /tmp/esign009-capacity-corpus 6000
```

將 `run` 換成 `fault`，新 DB/storage/output，可驗真正 SIGKILL worker 後啟動兩個 worker 的恢復；只縮短業務租約等待，BullMQ 真實鎖/停滯偵測仍運作。用 `24` 替換 `6000` 僅是快速接線檢查，不能當容量成績。

- 每個新匯出文件有 6,000 個獨立來源 path（hardlink），每輪首次建立新快照，不能把七日重用計入受理數據。
- STORE 三輪、DEFLATE 1/6 各一輪。壓縮變體僅由子程序的 benchmark factory 改參數；正式程式固定 STORE。
- 每輪先準備 60 個員工 sessions、同一份一頁文件的一個 signature field、task consent；閉迴路併發 2，無 think time。預熱 20 次不入統計；baseline 及 export 都相同負載。每組前等待前組所有簽署副本 ready，失敗即停止。
- export 量測在觀察到 processing 後啟動，最後一次 submit 後再查仍 processing。`allSigningDuringProcessing=false` 不可用作簽署增幅通過證據。
- 保存逐 request timestamps/status/ms，nearest-rank p95；沒有丟棄失敗、沒有降低門檻。樣本小，尤其首次受理 5 次 p95 等同最大值，不能推論部署 SLO。
- Python zipfile 獨立串流檢查所有檔名、bytes、CRC、SHA-256、ZIP64 EOCD/locator；expected 取自 fixture manifest 與 seed 關聯，不取 archive 中資料自我驗證。
- 第一個 STORE 結果透過真 HTTP 收到 8 MiB 後 abort，Range + If-Range 接續，逐塊驗全檔 SHA/bytes，不把 ZIP 放入 Buffer。
- API/worker 每 250ms RSS/heap/external/cumulative CPU；包括 ts-node 載入成本。不是 production compiled runtime RSS。資料在 resources.json，包含空閒及驗證期間，解讀須使用 processing timestamps。
- 每輪完成獨立驗證後刪除該測試 ZIP 以控制空間；保留 synthetic source。需要大約 15 GB 可用空間。不自動 DROP DB 或清空 Redis。

## 限制

24 種 PDF 重複 250 次、hardlink 與熱 filesystem cache，並非真實 6,000 份人資文件；未模擬跨機網路、多租戶或 production log volume。簽署測試是一欄、watermark=false，不代表更多欄或大型原始文件。S3 emulator 小量協定驗證見 ticket08；**禁止用 Moto 跑 >4 GiB**，它會全量累積 multipart。部署 S3 機器/IAM/網路尚未提供，容量與 p95 必須另測。

尚未取得環境的部署 S3 原有容量門檻追蹤於 [ticket11](../../../.scratch/009-esign-document-delivery/issues/11-deployment-s3-capacity.md)，T028 在該驗收完成前維持未勾選。

## Spec030：既有 ZIP 的按需更新

`esign-zip-refresh-benchmark.ts` 沿用 corpus/verifier，但走同一文件的完整更新：先完成 1 份 ZIP → 增至 6,000 份且讀取不建工作 → 明確申請 → 實際 processing 期間加入第 6,001 份、再次申請仍共用固定 6,000 → 完成且提示缺 1 → 正式 worker 刪除舊 ZIP。另明確更新至 6,001，驗證大型舊快照也能取代與清理。每次新版以獨立 manifest 核對全部 entries、bytes、CRC、SHA-256、ZIP64；6,000 成果另做 HTTP 中斷與 Range/If-Range 全檔續傳校驗。

```sh
# repository root；先確認可用磁碟空間，結果、storage 必須尚未存在。
node server/test/performance/generate-export-corpus.cjs "$PWD" /tmp/spec030-corpus
cd server
DB_MYSQL_DB=feastogether_intranet_test_capacity_030new \
ESIGN_STORAGE_DRIVER=local ESIGN_STORAGE_ROOT=/tmp/esign009-capacity-030new \
node --env-file=.env.test --conditions=development -r ts-node/register \
  test/performance/esign-zip-refresh-benchmark.ts run \
  /tmp/spec030-results-new /tmp/spec030-corpus 6000
```

必須獨占測試 Redis，使用新的測試 DB。guard 會拒絕非 capacity DB、非 local 隔離 storage、既有目錄與非空文件資料庫；不修改正式設定、不清空 Redis、不自動 DROP DB。至少預留約 20 GB，保留最終 ZIP 及所有合成個人 PDF；只刪除用來驗證 HTTP 續傳的下載副本，產品 ZIP 的刪除完全由正式清理流程執行。24 只是接線模式，不是容量通過證據；處理過快而未觀察到 processing 會明確失敗。

`result.json`、`resources.json`、`verify.json`、`verify-next.json` 保存量測與斷言。RSS 每 250ms 取樣，worker 為獨立 ts-node 程序；API 程序包含 fixture/orchestrator，不能當 production API sizing。24 種 PDF 各重複 250 次、有不同 signer/path/entry，內容重複與 hardlink/熱快取限制同前述；不是實際 S3 容量或部署 SLO 保證。此 harness 沒有壓縮策略 patch，也不手動刪產品 ZIP 或寫過期時間。
