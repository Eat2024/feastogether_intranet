# Phase 0 Research：ZIP 按需更新

日期：2026-11-06。依本機程式與 Spec 030 靜態盤點；未讀取 UAT 資料、執行刪檔或外部技術研究。本輪沒有引入新技術，結論限既有程式行為。

## 1. 更新判斷與受理界線

- **Decision**：比較當前簽署 record ID 集合與固定快照，取差集；只在明確申請且沒有進行中工作時建立新版。
- **Rationale**：`esign-export.service.ts` 的 findOrCreateExportJob 現在先 reusable 就返回；records() 已可取得 signed 紀錄。`esign-signing.service.ts` 的簽署交易先鎖 document，申請沿同一鎖可建立明確受理界線。單一 ID 查詢確立快照，不使用前端時間。
- **Alternatives considered**：人數比較會漏掉相同數量不同身分；snapshotSha256 包含 metadata，PDF 變為 ready 就可能不同；每次簽署觸發打包浪費資源。

## 2. current 與 work 必須分離

- **Decision**：讀取摘要提供 current 與 work；進行中工作優先於失敗，再處理現有成功版是否過時。最新 failed 保持原工作等待明確重試。
- **Rationale**：`export-job.repository.ts` reusable 優先 completedAt，會遮住新版與其失敗；`esign-export.service.ts` retry 目前也會被舊成功版攔截。
- **Alternatives considered**：只回最新一筆無法同時顯示舊版下載與更新進度；覆寫舊工作破壞歷史及失敗時的舊版保留。

## 3. 不需新增 schema 的版本與清理狀態

- **Decision**：job.status 新增 superseded；ZIP file.archiveStatus 新增 delete_pending／deleted。清理重試時間沿用 superseded job 的 nextAttemptAt，其他狀態既有語意不變。
- **Rationale**：兩欄皆 varchar(20)，`server/src/infrastructure/database/schema.sql` 無限制其值的 CHECK，已有 status/archiveStatus 索引。保存 file metadata 及完整 object reference 可重入刪除。
- **Alternatives considered**：expired 混淆被取代與缺檔；刪除資料列會失去重試與歷史；新表、世代欄位或通用版本服務超出必要範圍。

## 4. 發布與清理分開

- **Decision**：完成儲存及確認可讀 metadata 後，在短交易發布新版與停用舊版；交易外刪指定舊 ZIP，既有 maintain 補償。
- **Rationale**：`document-export.processor.ts` 現有 catch 會把工作設 failed，清理不可放在該區塊內。PrivateFileStorage.delete 已支援 local 冪等刪除及 S3 指定 objectVersion；用完整 reference 避免只刪 delete marker。
- **Alternatives considered**：先刪舊檔會造成新版失敗無檔；交易中執行慢 storage 會長時間鎖業務資料；僅靠 24 小時 orphan sweep 不會回寫 deleted，無法完整追蹤清理。

## 5. 清理掃描及參照保護

- **Decision**：每輪最多 50 個待清理工作，依 nextAttemptAt、id 排序，失敗下次時間設為現在加 60 秒；已清完排除。清理前驗證 superseded + delete_pending + signed_copies_zip，且 key 未被 active file 或有效 staging 引用。
- **Rationale**：現有 maintain 和 isReferenced 可沿用。延後失敗重試避免永久失敗的首批餓死後續工作。刪除後但回寫前中斷可再次 delete，成功後收尾。
- **Alternatives considered**：無界清理會壓住工作恢復；每次只從最小 ID 重試可能飢餓；新清理排程沒有必要。

## 6. 下載與 UX

- **Decision**：指定工作成果下載永不觸發打包。新申請返回工作後，固定追蹤其識別；完成後提供明確下載，另列更新操作。
- **Rationale**：目前 prepareDownload 及 files GET 已有明確識別，能保留續傳與檔名規則；`ZipExportPanel.tsx` 只需拆分狀態及操作，不需在瀏覽器持有大 ZIP。
- **Alternatives considered**：下載前自動重新檢查並重包會追逐持續簽署；自動下載受瀏覽器限制，且不在規格必要範圍。

## 7. 相容與回復

- **Decision**：保持現有成功版的無到期規則，僅新版成功才清較舊成果；新舊程式不得混用，不提供回退舊 binary 保證。
- **Rationale**：既有 reusable 用 completedAt，未排除 superseded 時會選回不可下載舊版；舊前端亦不認新狀態。部署須完整同步。
- **Alternatives considered**：批次重包／清理違反按需與升級不動既有成果的規格；刪掉歷史不符合已確認保留範圍。

所有設計疑點已收斂；未把本輪靜態盤點宣稱為 runtime／並發／UAT 驗證。
