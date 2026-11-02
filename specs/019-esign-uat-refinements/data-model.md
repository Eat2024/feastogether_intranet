# Data Model：既有模型的行為調整

## 1. EsignExportJob / EsignFileObject

無新表、新欄位或 schema migration。保留 expires_at nullable 欄位供相容，但新完成 ZIP 寫 null，查詢與下載不依其值判斷到期。job 的 id/publicId、createdAt、createdByUserId、snapshotAt/snapshotJson/snapshotSha256、recordCount 與檔案內容保持原值。

| 狀態 | 規則 |
| --- | --- |
| pending/waiting/processing | 沿用既有等待、租約及工作復原 |
| failed 且未曾完成 | 原工作原快照重試，保留既有完整性錯誤不可重試限制 |
| completed | 不再轉 expired，永久沿用；檔案不存在回不可用 |
| 舊 expired | 驗證原產物仍在才受控恢復 completed；缺檔保留不可用歷史，不重建 |

同文件的固定選擇為最新曾成功工作（completedAt 非 null，id DESC；正常 completed 亦需納入）。先決定固定工作，再檢查可用性，不能依檔案是否剛好存在跳選其他工作。無曾完成工作才選既有 active/failed 或建立首次工作。request 與 retry 都套用這個規則，避免 retry 舊失敗工作旁路產生第二份。

目前正常資料在成功時同時寫 completedAt；若盤點到 completed 但 completedAt 缺失等異常，列入阻擋清單人工修復，不推測時間或偷偷新增。歷史按各 job ID 仍可下載各自存在的檔案。匯出面板需使用同樣選擇規則：在既有文件詳情 DTO 新增可為 null 的 `exportSummary` 回應欄位，使用同一工作選取函式與既有匯出 view 投影，不載入快照或觸發工作。不可只用歷史 pageSize=1 選到較新失敗工作。此為新增 API 回應欄位，不是既有欄位，也不新增 DB 欄位或專用 endpoint。

## 2. 一次性 ZIP 資料轉換

實作工具 `server/scripts/normalize-export-retention.ts`，預設只 dry-run，apply 必須顯式指定核對過的結果清單；不得掛到應用啟動。只處理 signed_copies_zip 且有 snapshot 的工作。

1. 停止舊 worker 與匯出寫入，確認無執行中產檔／刪檔；備份待改 DB 欄位與檔案 metadata。
2. 枚舉 job/file；以既有 storage 介面檢查產物是否存在，串流計算大小與 SHA-256，與 metadata 核對；不將整個大型 ZIP 讀入記憶體。
3. 可驗證的 completed/expired：交易內鎖定並重查 job/file，設 expiresAt=null、status=completed、archiveStatus=active。只更動政策欄位及必要 updatedAt；記錄前後值，不改原 createdAt、快照或檔案。
4. 缺檔／損毀／權限或來源查核失敗：不寫入；輸出無個資的 ID、分類及數量，固定工作不可用時整份文件列為不可下載，不能回退成較舊 ZIP。
5. 工具可重跑，已符合目標值時不做寫入。新 worker 上線前再次比對結果，確認 active 產物能通過 isReferenced，避免孤兒清理誤刪。

不得提交實際 DB 清單、object key、姓名、信箱或檔案到 repo。回滾工具僅能依受控前值還原政策欄位，不能恢復已不存在的檔案；舊 API 無法沿用 expiresAt=null，舊 worker 可能刪檔，因此不允許直接單獨回滾舊 worker。回退需停止服務並使用已驗證的整體備份／相容版本。

## 3. 歷史搜尋輸入與結果

ExportHistoryQueryDto 增加 `q?: string`，trim 後最多 100 字，空字串等同未提供。保留 type、documentId、page、pageSize，UI 固定 10；API pageSize 沿用既有 1–100，非法直接 API query 回 400。

搜尋在文件 title/docNumber 與 createdByUser.name/empid，比對不是 exportedBy。creator join 只用於篩選，不把額外個資加入 payload。沿用 withDeleted 的歷史語意，已軟刪建立人仍可比對保留的姓名／員編；不存在建立人時仍可由名稱／編號命中。

typeTotals 共用授權、documentId、q，不套目前 type；total 取目前 type。以短讀取交易取得一致的 counts 與 items；有效頁為 min(requestedPage,max(1,ceil(total/pageSize)))。排序 createdAt DESC,id DESC。資料變動後的另一個 HTTP 請求不承諾維持同一快照。

## 4. Redis 組織圖

key：`esign:org-chart:v2:<原環境與上游hash>`；值仍 `{version:1,data}`；TTL=1800 秒。成功寫入才起算；命中不寫回；失敗及錯誤格式保留既有處理。無 DB 變更、無定時更新。舊 v1 key 自行過期，不跨 namespace 清除資料。

## 5. 信箱預檢

移除專用 request/response DTO，不移除共用 employee-directory 類別或 HR 查詢。發起時 signer.email 可為 null；notification log 使用既有 skipped/RECIPIENT_UNAVAILABLE，未新增狀態或原因碼。

## 6. 簽署歷程投影

EsignHistoryItem 增加 `label: string`（必填）；保留 type、occurredAt、actor、reason。actor 一律 `{kind,name,signerPublicId?}`。補簽保留 signEndAt；previousSignEndAt/reason 與既有 actorUserId 的相容資料依原授權提供，不對同部門瀏覽者或本人簽署視角新增揭露。

此 label 不持久化，不加入 audit hash 計算。中文映射見 history-event-inventory.md，27 種已知事件；未知回中性中文。不存在翻譯表 migration。
