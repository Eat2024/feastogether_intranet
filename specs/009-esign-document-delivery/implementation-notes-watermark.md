# Ticket 02：後端浮水印驗證

## 實作範圍

- 讀取已通過 hash 驗證的發起 payload `options.watermark`，true 才加印，false 不載入字型。沿用旋轉後 MediaBox/CropBox 交集座標，每頁加印後再畫簽名與 QR／日期，最後保存與計算 hash。
- 使用隨服務部署的固定 OFL 中文 TTF（約 7 KiB）；來源、衍生名稱、重建指令與 SHA-256 見 `server/assets/fonts/README.md`。Nest build 複製字型及授權至 `dist/assets/fonts`。
- 正式管理／外部下載本來就直接下載後端 bytes，不新增瀏覽器重繪。移除 mock 下載／簽到表的浮水印繪製；內部 mock 簽署仍不等於正式 API 串接。
- 不改動既有完成 PDF；重試與下載沿用既有完成檔流程。無 migration、環境變數或新排程。

## 驗證

- TDD：新增輸出 PDF 中文對照檢查先失敗（沒有浮水印字型），加入繪製後通過。
- `completed-pdf.service.spec.ts`：0／90／180／270 度與 CropBox、兩頁含無簽名欄位的橫向頁；true 每頁有字型、中文全字元可辨識；false 無字型；缺字型失敗且不保存；簽名／QR 原位置保留；原檔 bytes 不變、完成檔 hash 驗證。
- 產物字型另外驗證為可解析 TrueType 子集，避免只有 ToUnicode 資料卻缺失字形。
- `core-esign-flow.e2e-spec.ts` 既有完整外部簽署測試改用 watermark=true，檢查建立人／外部簽署人與重複下載 bytes 相同，並檢查固定副本含中文映射。沿用已有實際 session／worker／資料庫測試 harness，未另複製一份 `esign-watermark.e2e-spec.ts`。
- 本機真實 MySQL/Redis（隔離 DB `feastogether_intranet_test_009_02`）目標測試通過，包含完成檔已保存後的結案重試。
- 全 server unit：92 suites、814 tests 通過。root lint 通過（既有 warnings、無 errors）；root build 通過（server + client）。
- build 產物中可讀到 `dist/assets/fonts/EsignWatermarkTC-Medium.ttf` 與授權，部署不需要系統字型。

## 實際渲染

不能僅以 ToUnicode 斷言中文字可用：第一次 OTF 子集在 MuPDF 實際渲染出現 `unknown file format`，因此改為已固定字重並改名的 TrueType 子集。

修正後用 PyMuPDF 對合成產物四種旋轉的所有頁面以 1.5 倍解析度渲染，八頁均無 MuPDF warning，文字抽取均包含「饗賓集團」。人工檢視 90 度 CropBox 頁可讀淡灰斜向錯列中文與日期，QR 白底不受覆蓋。測試 PDF／PNG 僅置於 `/tmp`，不提交簽名或 PDF 產物。另外以 ZXing 從 3 倍渲染影像解碼四種旋轉頁的 QR，四者均得到預期驗證網址。ZIP 入口 hash 一致性留 Ticket 10 整合。

整合 Ticket 01 後重驗：完成副本與草稿設定相關單測 2 suites／24 tests 通過；root build／lint 通過。最終 TTF 字型版本已再次執行隔離 DB 的完整外部簽署／完成副本 HTTP 測試（1 passed，23 skipped），確定輸出 hash 與下載 bytes 一致。
