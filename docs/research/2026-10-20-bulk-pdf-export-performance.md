# 大量已簽署 PDF 匯出效能研究

研究日期：2026-10-20。範圍：人資一次匯出約 6,000 份既有完成副本；本文件為研究建議，沒有實作或容量壓測，不代表正式功能已完成。不新增資料表、環境變數或排程。

## 結論

建議採「背景匯出工作、重用既有 PDF、串流 ZIP64、限制併發、保存完成成果供續傳及重複下載」。壓縮方式先以 STORE 為基準，與 DEFLATE level 1、6 實測後決定。最佳方案的判準是人資拿到全部檔案的端到端時間、對正常簽署的影響與失敗重試成本，不只是 ZIP 產製秒數。

6,000 份不是固定的效能上限。每份平均 1 MB 約 6 GB，平均 5 MB 約 30 GB，以上為十進位容量示例。真正上限由完成副本總 bytes、來源延遲、可用記憶體、CPU、儲存吞吐及下載頻寬決定。

## 官方資料確認的事實

| 主題 | 查核結果 | 對本案的意義 |
|---|---|---|
| Node.js 串流 | 讀寫都有緩衝；`highWaterMark` 是門檻，不是整個程序的硬性記憶體上限。背壓使生產速度配合消費速度，`pipeline` 支援錯誤傳遞與取消。[Node.js Stream](https://nodejs.org/api/stream.html#buffering) | 來源、ZIP、儲存寫入必須整條串流；不能在尾端再組成完整 Buffer。仍須計入每個來源、SDK、ZIP 目錄與程序本身記憶體。 |
| ZIP 結構 | 每份檔案有獨立資料與標頭；ZIP64 擴充大小／位移欄位，資料描述符支援串流。[PKWARE APPNOTE，4.1.8、4.3、4.4](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) | 一般 ZIP DEFLATE 不會把 6,000 份的共同版面當成一份內容跨檔去重。總量或位移跨越傳統 32 位元界線時要支援 ZIP64，不能因單份 PDF 小就省略。 |
| ZIP 工具能力 | Archiver 支援串流輸入、STORE、zlib 選項及 `forceZip64`；`file()` 用延遲開檔避免檔案描述符耗盡。`statConcurrency` 只控制檔案資訊查詢，並非 PDF 壓縮併發。[Archiver API](https://www.archiverjs.com/docs/archiver/) | 可作候選工具；遠端來源須自行延遲開啟及限制預取。產製完還要等目的地寫入成功才標記完成。 |
| S3 multipart | 可以邊產生邊上傳，個別 part 可並行及重試；必須完成或中止，上傳殘留會佔儲存空間。單次最多 10,000 parts。[Amazon S3 multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) | 適合大型 ZIP；part 大小需配合最大估計成果。程序重啟後不能把 SDK 的 part 重試當成整個 ZIP 可無縫續建。 |
| AWS SDK | `@aws-sdk/lib-storage` 接受未知長度串流，提供 `queueSize`、`partSize`；`leavePartsOnError: false` 可在失敗時自動中止 multipart。[AWS SDK 官方 README](https://raw.githubusercontent.com/aws/aws-sdk-js-v3/main/lib/lib-storage/README.md) | 這兩個參數需納入緩衝預算。強制終止程序仍可能留殘件，需要明確的清理設計。 |
| 遠端讀取與下載 | S3 官方建議用多連線改善吞吐，Range 可讀取部分 bytes；HTTP 定義 Range、If-Range 與部分內容回應。[S3 效能建議](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html)、[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests) | 適度併發可能更快，但須有界。保存固定成果並支援 Range 才適合續傳；實際瀏覽器是否自動續傳仍要驗證。 |

## 對目前程式的影響

- `server/src/infrastructure/file-storage/s3-private-file-storage.service.ts` 目前將 `input.bytes` 轉 Buffer，再用 `PutObjectCommand` 寫入；local storage 同樣先建 Buffer。批次 ZIP 應擴充串流寫入，不能沿用全檔 bytes 入口處理數 GB 成果。
- `server/src/features/esign/services/completed-pdf.service.ts` 使用 `output.save({ useObjectStreams: false })`。不能由副檔名推斷這些 PDF 已壓到最佳大小，也不能推斷關閉 object streams 代表所有內容皆未壓縮；應取實際完成副本測量。
- `server/src/worker/esign/document-finalization.processor.ts` 的完成副本工作目前 concurrency 為 2。匯出應重用既有副本；缺少副本時等待原產製流程，避免匯出一次重新繪製 6,000 份。匯出與正常產製共用機器時仍會競爭資源。

以上為本機 source 查核，未查核部署環境容量、實際檔案分布或流量。

## 建議設計與取捨

以下是依官方能力推導的方案，尚未經本專案壓測。

1. 建立匯出時固定已簽署副本清單及檔案版本，批次查詢 metadata，避免每份各查一次完整文件資料；拒簽者不產生已簽署副本。
2. 背景工作按固定順序讀取既有 PDF，串流計算必要校驗並加入 ZIP。校驗失敗、來源消失或漏檔不能標成全部成功。
3. 本機儲存採串流暫存檔，完成後發布成果；S3 採 ZIP 輸出串流接 multipart，不先把所有 PDF 下載到本機再打包上傳。
4. 初始化先同時處理一個大型匯出，逐份讀取作基準。若遠端讀取延遲成為瓶頸，再試 2、4 個有界預取，且限制預取總 bytes；僅限檔案數不足以限制大型檔案的記憶體。不能 `Promise.all` 開啟 6,000 個來源。
5. S3 上傳可先測 `partSize = 16 MiB`、`queueSize = 2`，再測 32 MiB 與 queueSize 4。這些只是實驗起點；`queueSize × partSize` 只能作部分緩衝預算，不能當 RSS 保證。最大成果須符合 10,000 parts 限制。
6. 所有來源、ZIP 與上傳共用取消路徑；任何一段失敗都停止其餘資源，處理暫存物件。重試使用同一份固定名單，未完成成果不提供下載。
7. 成果完成後再提供授權下載；下載入口使用原生下載，不在前端先把整包讀成 Blob。若部署允許，採私有物件儲存的短效下載授權，減少 API 代送大型檔案；否則 API 代理也須保持串流並實作 Range。
8. 相同文件版本與名單的有效完成成果可重複使用，避免連點或重新下載重做打包。每次取用仍檢查權限。

### STORE 與 DEFLATE 如何選

STORE 省掉壓縮運算，適合 CPU 吃緊或內容再壓縮效益很小的情況。DEFLATE 可能減少寫入與下載量，對低速人資端網路可能更划算。這是效能推論，不能在測量前斷言哪個最快。

應測相同資料的 STORE、level 1、level 6，記錄產製時間、CPU、壓縮比例與下載時間。概念比較式：

`使用者取得成果時間 ≈ 排隊時間 + 產製完成時間 + 成果 bytes ÷ 實測下載速率`

產製內部可重疊讀取／壓縮／上傳，不能將各段耗時直接相加。若分包並允許先下載已完成包，整體流程也可能重疊。假設壓縮省下的傳輸時間比新增 CPU 時間多，壓縮才可能改善端到端體驗；是否成立需以代表資料與真實網路測量。

### 一大包或多個獨立 ZIP

一次操作仍可產生多個各自可解壓的 ZIP，依預估 bytes 分配，不按固定 500 人或 1,000 人分配。可用每包 1–2 GiB 作體驗與失敗重試成本的測試起點，這不是 ZIP 格式限制或已核定需求。單份超過目標時單獨成包，不切斷 PDF。

分包可降低單次重下載與重建的範圍，也能讓前面的包提早下載；它不會自然減少總讀寫量。不要無限制並行所有分包。需同時提供單包方案比較，避免人資被迫手動下載許多小包。此處指多個獨立 ZIP，不是需要所有分卷齊全才能解壓的 split ZIP。

## 建議驗證

先用數百份具有代表性的完成副本做壓縮取樣，再用 6,000 份測容量；樣本涵蓋影像型 PDF、文字型 PDF、頁數及簽名大小差異，不能只複製一份小檔冒充實際分布。

| 維度 | 建議比較／觀測 |
|---|---|
| 壓縮 | STORE、DEFLATE 1、DEFLATE 6；產製時間及最終 bytes |
| 來源及儲存 | local、實際 S3 相容端點；冷讀取與重複讀取分開記錄 |
| 併發 | 預取 1／2／4、匯出工作 1／2；記憶體、吞吐與正常簽署 p95 延遲 |
| 系統資源 | RSS、external Buffer、CPU、event loop delay、磁碟與網路吞吐、開檔數、來源錯誤率 |
| 下載 | 人資實際網路、單包／分包、超過 4 GiB ZIP、目標作業系統解壓、Range 中斷重試 |
| 故障 | worker 中斷、來源遺失、校驗失敗、上傳失敗、重試冪等、殘件清理、不完整成果不發布 |

驗收門檻需根據部署資源與正常簽署基準制定；目前沒有證據可以保證 6,000 份需幾分鐘、固定吃多少記憶體，或現有機器一定能承載。以文件研究交付，沒有修改前端、後端、migration 或設定，未執行程式測試。
