# Spec009 最終雙軸審查與修正

審查固定範圍：`1c2e578...71ac3ee`。Standards 與 Spec 由獨立 reviewer 分別檢查；以下保留各軸原始結論，不合併評分。行號指原審查版本。單一 implementer 在 `009/review-fixes` 修正全部 4 項，沒有增加產品範圍。

## Standards

原始：2 項 P3，最高嚴重度 P3（其中 1 項明文規範、1 項判斷建議）。修正後待處理：0。

1. **[P3] 統一新畫面的日期時間格式（明文規範）** — `client/src/features/esign-documents/ZipExportsView.tsx:13` 與 `client/src/features/my-signature/InternalSigningTasks.tsx:34` 分別使用 `dateStyle: 'short', timeStyle: 'medium'` 和未指定格式的 `toLocaleString('zh-TW', …)`；會顯示如 `2026/10/21 中午12:05:06`，而非規定格式。`client/AGENTS.md`「資料與業務不變量」要求時間使用 `YYYY/MM/DD HH:mm`。請明確指定補零年月日、24 小時與分鐘，並保留台北時區；可沿用通知歷史已有的格式設定。

2. **[P3] possible Duplicated Code：共用匯出入列設定（判斷建議，非硬性違規）** — `server/src/features/esign/services/esign-export.service.ts:237–245` 與 `server/src/worker/esign/document-export.processor.ts:349–357` 重複 `queue.add('export', { exportJobId: … }, { attempts: 1, removeOnComplete: 1000, removeOnFail: 1000, deduplication: { id: … } })`。API 受理與 maintenance 補列是同一工作協定，調整去重鍵或 queue options 時必須同步兩處。建議把參數建構抽成 feature 內的小 helper，保留兩處各自的錯誤處理，避免新增框架。

未發現其他足以具體舉證的 Standards 違規；未將既有 entity 結構、已核准的全員工匯出授權或尚待部署的 S3 容量驗證列為新增問題。工作樹保持乾淨；本次僅閱讀與驗證日期格式，未重跑整套測試。

### 修正與驗證

- 日期格式：`client/src/lib/dates.ts` 提供明確補零的 `YYYY/MM/DD` 與 `YYYY/MM/DD HH:mm`，時區固定 `Asia/Taipei`、24 小時制；ZIP 列表與內部拒簽結果使用同一 formatter。通知歷史也共用，避免午夜的語系 AM/PM／24:00 差異。
- 匯出入列：`exportJobArguments()` 只集中兩個既有呼叫點的 job name、payload、attempts、保留數與去重鍵。API 受理仍 catch 由 maintenance 補列；maintenance 原有錯誤傳播保持不變。沒有新增 queue/framework。
- 99 suites／841 server unit tests 通過；S3 API/worker 的 enqueue 故障補列與七天重用回歸通過。根目錄 build／lint 通過（lint 有既有 warnings，0 errors）。

## Spec

原始：2 項 P2，最高嚴重度 P2。修正後待處理：0。

- **[P2｜部分實作] 草稿期間在列表仍受瀏覽器時區影響。** `client/src/features/esign-documents/listQuery.ts:27`（列表呼叫點 `DocumentsTable.tsx:86`、`:88`）仍以本地 `dayjs(...).format` 顯示起迄；本次編輯器已在 `DocumentSignersEditor.tsx:111` 改用 UTC+8。規格 `spec.md:174` 明定：「起迄日期 MUST 以台北時間解讀及顯示，並保留可辨認的時間意義，不受瀏覽器時區影響。」在 America/Los_Angeles 儲存開始日 2026/10/21，編輯器回填 10/21，列表卻顯示 10/20；以同一 ISO `2026-10-20T16:00:00.000Z` 實跑兩段格式化已重現。應同步統一列表、期間篩選及詳情的台北時間轉換。這是本次明確需求尚未覆蓋的既有 helper，不主張它是新引入的 regression。

- **[P2｜行為錯誤] S3 未取得固定版本仍發布可下載成果。** `server/src/infrastructure/file-storage/s3-private-file-storage.service.ts:143–145` 在 upload 未回 VersionId 時仍成功返回；`:183–198` 的 stat 僅讀尺寸。規格 `spec.md:254`：「若期限內成果意外毀損或遺失，須顯示不可用，不可假稱能下載或默默另建新快照。」下載契約 `contracts/document-delivery-http-api.md:64` 又明定「S3 使用固定 VersionId」。未啟用版本控制的 bucket 可正常完成匯出，但若 ZIP 被同 key、同長度覆寫，後續重用與 Range 下載仍通過尺寸檢查，送出不同內容並附舊 SHA-256 ETag。測試 helper 有開 versioning，正式 adapter 沒有強制此先決條件。應拒絕無有效固定版本的匯出發布，或保存並驗證等效不可變識別；此情境是一般物件覆寫，並非已聲明排除的 silent bit rot。

未發現有足夠證據的未授權範圍擴張。部署 S3 的 6,000 份／>4 GiB 容量驗收仍受環境限制，已由 ticket11 承接、T028 保持未勾選；不列為虛報完成。

### 修正與驗證

1. **FR-005 台北日期**：正式文件列表、期間篩選、草稿編輯器、詳情期限、簽署人時間、歷程與簽署紀錄 Excel 共用台北轉換；日期選擇器日界線轉 UTC 也由同一日期工具管理。沒有修改 mock store 原型。
   - 原版 `71ac3ee` helper 在 `TZ=America/Los_Angeles` 對 `2026-10-20T16:00:00.000Z` 顯示 10/20，確實重現；修正版在 Los Angeles／Taipei／UTC 都顯示 `2026/10/21`。
   - 確定性驗證涵蓋台北午夜前後、10/20 不含／10/21 含的期間篩選、日期日界線轉 UTC、Excel 簽署與拒簽欄位的 `2026/10/21 00:00`。另以真 ExcelJS 建立 workbook 再讀回，確認簽署／拒簽儲存格及文件資訊期間均為台北日期。
   - 真 Chrome（America/Los_Angeles）經 Next + Nest + 隔離 MySQL：草稿編輯器回填同日開始／結束、儲存後列表兩欄仍為 10/21、API UTC 值不變、10/20 篩選排除／10/21 篩選包含、重進編輯器不偏移。正式詳情的跨午夜期間 `10/20 ～ 10/21` 與到期時間 `2026/10/21 00:00` 通過。未新增 client 測試框架，臨時 fixture 已還原。
2. **S3 固定版本**：串流完成後必須取得非空且非 `null` 的 VersionId 才回傳成果；無固定版本的既有 ZIP 也不可 HEAD／下載。來源 PDF `store(bytes)` 與其讀取行為保留。失敗時清理 generation 的 MPU 與所有精確 key 版本，涵蓋 complete 成立但回應遺失。既有持久 staging／maintenance 仍負責 crash 或遠端清理失敗的恢復。
   - 真 HTTP Moto adapter **9 tests**：未版本化與 Suspended bucket 不得發布且不留成果；同 key／同長度覆寫仍讀原固定版本；缺少或 `null` 版本不可讀；未知 complete 結果無成果或 MPU；原有 33 MiB multipart、Range、hash、取消、來源／staging 故障及有界清理均通過。
   - 真 HTTP + MySQL + Redis + worker S3 **4 tests**：固定版本 Range／ETag、同 key 同長度覆寫仍下載原 ZIP、並發共用與補列、Suspended 失敗且 files 為空、重新 Enabled 後重試原快照成功、staging 清理保護有效租約與來源。
   - `.env.example`、quickstart、S3 實作紀錄與 ticket11 記錄 bucket 必須保持 Versioning=Enabled 及既有版本讀刪／清理 IAM。應用不修改 bucket、不新增環境變數、不新增 GetBucketVersioning 權限。

## 本輪執行證據與限制

- `pnpm -C server test --runInBand`：99 suites／841 tests。
- `PATH=<moto-venv>/bin:$PATH pnpm -C server test:s3`：9 tests。
- `PATH=<moto-venv>/bin:$PATH DB_MYSQL_DB=feastogether_intranet_test_009_rfd pnpm -C server test:s3:e2e`：4 tests。
- `pnpm build`、`pnpm lint`：通過；lint 0 errors。
- Chrome 臨時腳本 `/tmp/esign009-review-browser.cjs`；截圖 `/tmp/esign009-review-timezone.png`。確定性日期腳本 `/tmp/esign009-review-dates.cjs`；原版失敗紀錄 `/tmp/esign009-review-dates-red.log`。不包含正式資料或憑證。
- 測試 log：`/tmp/esign009-review-{unit,s3-final,s3-e2e-final,browser,build,lint}.log`。這些是本次本機執行證據，不宣稱臨時路徑為可攜 CI 工具。
- 本次只調整日期、入列參數共用與 S3 完成／讀取的固定版本防線，沒有改 ZIP 打包演算法，因此未重跑 6,000 份容量 benchmark；沿用先前已記錄的本機結果及限制。**T028 維持未勾選，ticket11 維持 ready-for-human**；沒有 AWS 部署容量／實際 IAM 通過的宣稱。
- 修正 commit `5d0519e` 已整合於 `67693d778abbb73bd88dba411e2c6a546b790c16`；兩軸最終回查通過，ticket10 已結案為 resolved。部署驗收限制如上。

## 最終 Standards 回查

- 固定範圍：`71ac3ee...67693d778abbb73bd88dba411e2c6a546b790c16`，由原 Standards reviewer 唯讀回查。
- 日期格式 P3 已解決：實際 TypeScript helper 的午夜前後及一般時間皆輸出補零的 `YYYY/MM/DD HH:mm`，固定台北時區；ZIP 與內部拒簽頁已使用同一 formatter。
- 重複入列參數 P3 建議已處理：API 與 maintenance 共用 `exportJobArguments()`，payload、去重、重試與錯誤處理皆維持既有行為。
- 修正未發現新的 Standards 違規或可具體舉證的回歸。**原 2 項已解決；未解決 0、新增 0，現存最高嚴重度：無。** 未重跑大型測試。

## 最終 Spec 回查

- 固定範圍：`71ac3ee...67693d778abbb73bd88dba411e2c6a546b790c16`，由原 Spec reviewer 唯讀回查。
- 日期 P2 已解決：列表、篩選、編輯器、詳情及 Excel 均使用台北時間；已檢閱確定性腳本、Chrome LA 與真 ExcelJS workbook 證據，FR-005 路徑完整。
- S3 固定版本 P2 已解決：串流發布與 HEAD／GET 均拒絕缺少或 `null` 的 VersionId；有效版本仍釘選原物件。同 key 等長覆寫、未版本化／Suspended、失敗清理及原快照重試由 9 adapter／4 API-worker tests 證據覆蓋。
- 修正未發現新的 Spec regression 或範圍擴張。**原 2 項已解決；未解決 0、新增 0，現存最高嚴重度：無。** 本輪檢閱既有驗證證據，未重跑整套測試。
- T028 未完成／ticket11 ready-for-human 保持正確；本機與 Moto 通過不代表部署 S3 的 6,000 份／>4 GiB、實際 IAM 及網路容量已驗收。
