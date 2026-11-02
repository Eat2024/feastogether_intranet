# Phase 0 Research：UAT 操作調整

研究基準：2026-11-02，本機 `dev`（fb3c4ea）。只有文件規劃，未查詢或變更 UAT DB／Redis／儲存服務。依 speckit-plan 分派匯出、搜尋與歷程研究，並核對快取與信箱預檢呼叫鏈。無外部技術選型或新增依賴。

## R1：歷史重下載採最小相容改動

**Decision**：保留既有 Excel 讀取及 PDF `POST :id/downloads` 路由；PDF 操作改為不寫入歷史，保持 OriginGuard、session 與部門授權。Excel 使用既有 buildExportXlsx 及下載 helper，不再呼叫記錄 API。

**Rationale**：重下載是現有下載操作，改寫服務即可停止重複記錄；保留 POST 相容現有呼叫端，明列其重複呼叫不產生業務寫入。新增匯出及其他本人副本入口仍記錄，不能刪除共用 recordPdf。

**Alternatives considered**：新增 GET 檔案端點會增加路由遷移與舊客戶端相容成本，這次不新增。只隱藏前端紀錄不能解決後端持續寫入。

## R2：ZIP 不再以 expiresAt 判斷可用

**Decision**：新完成 ZIP 的 expiresAt 為 null；讀取與下載不依舊期限失效。先選最新曾完成工作；其不存在時才沿用處理中／失敗可重試工作，保留文件交易鎖。移除 maintenance 到期狀態轉換及刪除分支，保留租約復原、補入列與未引用暫存清理。

**Rationale**：TTL 與 worker 租約是不同概念。單改 TTL 寫入不足以保留檔案，repository、view、download、maintenance、UI 都要同步。

**Alternatives considered**：設極遠的到期日仍保留不需要的到期機制；刪除整個 maintenance 會破壞 worker 復原；移除 expires_at 欄位會增加無必要 schema 變更。

## R3：既有 ZIP 與永久沿用的邊界

**Decision**：部署時先停止舊版匯出工作與清理，排空執行中工作，再以受控一次性工具盤點及轉換。仍存在且驗證通過的舊 completed/expired 產物統一為 completed、expiresAt=null、file.archiveStatus=active。保留所有歷史；同文件多份曾完成 ZIP 以 completedAt 非 null 或 status 為 completed／expired 中 id 最大的工作作後續申請的固定選擇（包含已到期不可用的舊工作），其他已存在可用產物仍可由各自歷史下載。completed／expired 缺少 completedAt 也先固定，再列為不可用；不得改選舊檔、推測完成時間或重建。

已刪除、遺失、損毀或無法確認的產物不復活、不重建。舊 expired 保留為歷史不可用，畫面顯示「檔案已不可用」，隱藏重新產生。若該固定工作缺檔或不可用，後續申請回既有 ESIGN_EXPORT_UNAVAILABLE，不自動建立新快照。若已選用的 completed 檔案日後遺失，同樣報錯，不切換成其他工作。未曾成功的失敗工作仍可重試。

**Rationale**：既有多份結果不能合併或刪掉；選最高 id 延續既有完成工作排序，也不需新增 canonical 欄位。已被刪除的原檔無法靠 DB 狀態恢復。

**Alternatives considered**：自動重建會更動簽署人範圍，與「同一份 ZIP」衝突。從其他工作悄悄替補也會改變內容。

## R4：搜尋與分頁保留既有邊界

**Decision**：我的電子簽維持完整授權任務回應、前端 filter → split → sort → paginate。歷史匯出在後端加入 q，列表與 typeTotals 共用文件建立人 join、權限及搜尋條件；先取得總數計算有效頁，再查該頁。兩頁 UI 每頁 10 筆。

搜尋欄位為 title、docNumber、文件建立人 name/empid，採一個完整關鍵字 OR；trim、英文字不分大小寫、部分匹配。SQL 用參數綁定及明確 `ESCAPE '!'`，先將 !、%、_ 跳脫，再包兩側 %。使用 LOWER 對應前端小寫包含判斷；doc_number 為 ascii_bin，不能依預設定序假設不分大小寫。SQL 比對採 `LOWER(CONVERT(column USING utf8mb4)) COLLATE utf8mb4_0900_bin` 與相同定序的參數，避免直接對 ascii 欄位套用 utf8mb4 collation 或 accent-insensitive 定序額外擴張匹配。以真實 MySQL 驗證大小寫、中文及特殊字元。

**Rationale**：兩個列表已有不同但可用的分頁實作，需求未要求搬移我的電子簽 API。歷史若只篩選已載入一頁會漏資料。

**Alternatives considered**：一次取全部歷史再前端搜尋增加資料傳輸；新增全文索引／搜尋服務超出目前需求。LIKE 前置 % 不承諾一般 B-tree 加速，本階段不新增索引。

## R5：30 分鐘快取切換

**Decision**：Redis TTL 改 1,800 秒，維持按需更新及讀取不續期；key namespace 由 `esign:org-chart:v1:` 升為 `esign:org-chart:v2:`，payload version 仍為 1（資料格式不變）。舊 key 自然到期，新服務不讀取舊兩小時快取，不清空 Redis。不新增排程、env 或 API。

**Rationale**：只改 set TTL 無法縮短既有 key。更換固定 key namespace 是單一位置的可驗證切換，既有環境／上游 hash 隔離保留。

**Alternatives considered**：部署人工刪 key 容易遺漏；每次讀取縮短 TTL 會混淆快取年齡且增 Redis 操作。前端既有 10 分鐘 staleTime 保留，它是 UI 查詢快取而非上游 TTL，不承諾未重新查詢的開啟畫面每 30 分鐘自動更新。

## R6：移除預檢但保留通知地址解析

**Decision**：移除 employee-email-checks controller 方法、checkDraft 與其專用 DTO／測試。保留 EmployeeDirectorySuccess/Error、組織圖及候選人解析回應類別，保留 resolveUsers/lookupEmails 及 FeastogetherHrService.getStaffEmails。

**Rationale**：發起仍使用該服務每批 100、最多 4 批併發取得地址；缺有效信箱既有 log 為 skipped/RECIPIENT_UNAVAILABLE，簽署指派保留。查詢來源失敗仍回 502，文件保持草稿，不能當成無信箱。Spec 018 亦需要信箱來源，不得刪除整個服務。

**Alternatives considered**：完全不查信箱將使有地址的員工也無法通知；忽略上游故障違反既有完整發起規則。

## R7：中文歷程只改顯示投影

**Decision**：EsignViewMapper 提供單一事件 label 對照，覆蓋盤點 27 種；未知值回「其他簽署歷程事件」。history DTO 增加必填 label，保留 type。前端移除 EVENT_LABEL，保留 EVENT_COLOR 與以 type 分組。

補簽特殊分支必須回相同 actor 物件結構；建立人可讀既有原因／舊期限，非建立人只取得既有允許的內容，不能藉統一 shape 新增姓名、userId 或 reason 的揭露。非建立人 actor 可使用不含識別的 `{kind:'employee',name:'建立人'}`，reason=null；其餘既有授權裁切不變。

**Rationale**：event_type 參與稽核與驗證，不能直接翻譯 DB 值。現有 reopened 回 actor 字串或省略 actor，與 DTO/前端不一致，必須在同一歷程投影中修正，否則中文化仍可能渲染失敗。

**Alternatives considered**：改 DB 值破壞證據；前後端各維護字典持續造成漏翻譯。無需新增翻譯表或 i18n framework。
