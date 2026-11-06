# Data Model：ZIP 版本與補清理

## 既有實體與欄位

| 實體 | 欄位／語意 | 本次調整 |
| --- | --- | --- |
| esign_export_jobs | publicId、documentId、exportType | 每版獨立工作，僅 signed_copies_zip 適用 |
| 同上 | snapshotJson／snapshotSha256／recordCount／snapshotAt | 受理後不可變；重試不擴大名單 |
| 同上 | resolvedFilesJson／leaseToken／leaseExpiresAt／stagingJson | 沿用副本等待與租約完整性 |
| 同上 | status | 增加 superseded；不以 completedAt 單獨判定可下載 |
| 同上 | nextAttemptAt | pending/waiting 維持既有重試；superseded 表示清理下次時間 |
| 同上 | completedAt、createdAt、createdByUserId、downloadFileName | 被取代仍保留，不覆寫歷史 |
| esign_file_objects | archiveStatus | ZIP 增加 delete_pending／deleted；active 才可下載 |
| 同上 | exportJobId、filePurpose、objectKey、objectVersion、fileSize、sha256 | 保留完整 reference，deleted 後也不硬刪 metadata |

無新表、新欄位、索引或 migration；status/archiveStatus 既有 varchar 足夠。實作同步狀態型別、說明與測試。

## 狀態轉移

- 工作：pending → processing → waiting → processing → completed；失敗 → failed，適用重試 failed → pending，名單不變。
- 發布新版本：較舊 completed→ superseded；保留 completedAt。失敗且從未成功的歷史不假稱被取代的完成成果，仍不可重試過時工作。
- ZIP 檔：active → delete_pending → deleted；標 pending 與 superseded 與新版 completed 在同一交易提交；禁止反向轉 active。
- 刪除失敗維持 delete_pending；清完該工作所有檔案後清除 nextAttemptAt，後續查詢以 pending 檔存在與否排除已完成清理。
- 過時不是持久狀態：newSignatureCount = 目前 signed record IDs 減該快照 IDs 的數量；isStale = count > 0。

## 選取規則與不變量

1. current：同文件 signed_copies_zip、有快照、status=completed 的最新成功工作，id DESC。缺檔仍保持其識別供錯誤呈現，不退回較舊成果。
2. work：先選 pending/waiting/processing；否則選 id 大於 current（無 current 則全域）且最新的 failed。舊失敗不能超越新成功版。
3. 同文件任何建立／重試／發布先鎖 document；簽署既有交易亦先鎖 document。工作鎖依 id 順序，避免鎖序反轉。讀取摘要使用同一一致性讀取範圍，允許回應後新簽署，下一次申請仍須重驗。
4. 首次申請或更新的單一紀錄查詢固定名單；由此組快照和份數，禁止後續再讀另一組名單造成時點混用。
5. work 存在時只沿用，不建立隱藏排隊新版；failed 僅明確重試，不能一般 POST 偷換快照。
6. 發布只取代同文件、id 較小、曾成功的 ZIP 工作，並重驗本次仍為合法進行中工作。既有多個舊成功版在此一併停用清理。
7. superseded 一律 files=[]；下載要同時滿足工作 completed、completedAt 存在、檔案 active、文件授權及 storage 可用。物件已刪仍有 metadata 不代表可下載。
8. 清理只能取得 superseded 工作的 delete_pending ZIP；完整 reference 不可變，其他 active 引用或有效 staging 引用使該檔保留並重試，不強刪。

## 交易與恢復界線

- 工作提交後 queue 加入失敗：保留 pending，既有 maintenance 重送。
- 產製成功但發布交易失敗：保留舊版，本次 staging 沿既有復原路徑清理；不提前停用任何舊版。
- 發布提交後 crash：新版已有效，舊版 pending 可由 maintenance 找到。
- 刪除成功但 metadata 更新失敗：下輪重複刪同一 reference，再條件式更新 deleted。
- 慢 storage 不持有文件鎖；刪除前短交易／查詢驗證資格，物件不可變與不可反向啟用維持其後刪除安全。
- 既有 orphan cleanup 可能先清 delete_pending；正式補清理須容忍已不存在並完成 metadata 收尾，不會刪 active 新版。

## 2026-11-06 範圍澄清

使用者已確認目前沒有 ZIP 匯出 `expired` 資料，本次移除該歷史狀態的相容分支與驗證，不做資料回填或恢復。文件簽署期限／到期邏輯不在此調整範圍；已完成 ZIP 意外缺檔仍依不可用處理。

## 2026-11-06 狀態邊界補充

- 文件 expired 仍代表「已超過簽署期限且尚有人未簽」，完全保留文件 DTO、查詢推導與 client esignDocuments 的此狀態。
- 只清 ZIP 匯出 service／repository 的 expired 判斷與未使用 archiveFile()；未確認其他匯出類型資料前，共用 EsignExportStatus 與歷史頁保留 Excel／PDF 的 expired 相容，不能用 ZIP 查詢結果推論全部。
- 保留 expires_at、idx_esign_export_jobs_expires_at、idx_esign_exports_reuse 中原欄位及 API expiresAt（新 ZIP 仍為 null），不做 schema migration。本輪未查驗所有 export_type 的非 null expires_at，亦未查驗全部檔案 archive_status 分布，不能宣稱可全域刪除。
- 若另案要移除所有匯出 expired／expires_at，需先唯讀盤點全部 export_type/status、file_purpose/archive_status 及非 null expires_at，再明確規劃 migration 與相容切換；不納入 030。

## 大型快照查詢限制（T029 實測補充）

current/work 先聚合候選 ID，再依主鍵取得摘要，避免 MySQL 對含數 MB JSON 的工作列做 filesort；work 保持「進行中優先，其次 id 大於 current 的最新未成功 failed」。申請／重試內兩步讀取都在既有文件鎖與同一交易內。取代舊版先只讀 ID，再按數字 ID 逐筆鎖讀／確認 completed；不排序整份快照。maintain／pendingCleanup 候選只投影 ID，慢 I/O 與清理依原交易邊界執行。無 schema、索引或 DB 設定變更。
