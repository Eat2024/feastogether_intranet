# 022 最新範圍：後端 worker 與異動保護

2026-11-03 使用者修訂：「先別改前端，直接改成 worker；worker 執行期間有人要異動工作內的文件資料或簽署人，先擋掉顯示 worker 執行中的訊息。」本決策取代既有文件中要求本輪前端進度、提交改造、輸入還原畫面及協調 client 發布的部分；其餘交易、授權、可靠恢復與保留設計仍適用。

## 本輪必做

- 全部正式發起交由 worker。既有 client 維持 userId／email 請求與提交前 resolutions；不修改任何 client 檔案，也不要求它提供新 header。
- POST initiations 的 Idempotency-Key 改為選填：有值仍驗 UUID 並採既定同 key 重播；未提供則 server 產生 UUID 保存，不能用 x-request-id 代替。沒有 client key 時，不宣稱能重播查回同一 HTTP 結果：依 document 鎖及唯一 active job 防重，進行中再次發起回 409，已成功文件依非 draft 規則拒絕再發起。明確 failed 後可重新提交，不復活舊工作。
- 受理仍回 202 與輕量 job 摘要；目前元件 await 請求但不讀回傳 detail，可沿用呼叫。不得為保留假成功顯示而提前將文件改 active。
- 從 queued 到 processing 都禁止該文件的資料或簽署名單異動：標題、PDF、欄位、期間、選項、增刪替換簽署人、簽署人註記、草稿儲存／設定、文件刪除及重複發起。不得只保護 initiating endpoint。
- 有權操作的人遇衝突統一 HTTP 409、code `ESIGN_INITIATION_IN_PROGRESS`、message「文件正在背景發起中（worker 執行中），暫時無法修改文件或簽署人，請稍後再試。」沿用既有錯誤 envelope，讓既有錯誤處理顯示訊息。無權操作的人仍按原授權拒絕，不洩漏工作。
- 在同一 document 鎖與 active job 檢查下保護寫入；worker 正式核心僅持特定有效 job/lease 才可通行，不提供通用 bypass。工作期間不長時間鎖住整份文件以代替狀態保護。
- failed 後解除 busy，仍套用既有草稿規則；succeeded 後套用既有已發起文件限制。過期租約不等於可編輯，必須先安全轉為終態。
- 摘要、失敗明細及重試 API 保留作後端診斷與驗收，不新增列表欄位、輪詢或前端進度 UI。

## 本輪限制與驗收

- 未改前端，所以前置 resolutions 仍可能花時間；3 秒受理目標從 POST initiations 開始量，不包含既有前端解析。不得宣稱本次移除所有前端等待。
- 現有 onSuccess 仍導向 flash=published，文案可能早於正式發起完成；本輪保留此已知限制，不用假的文件狀態掩蓋。列表仍可能呈現 draft，嘗試異動時才由 API 擋住。
- 原 FR-003 的取消前置解析、FR-009／SC-003 的進度畫面與 10 秒顯示、FR-018／SC-009 的畫面還原暫緩；後端對應資料與查詢能力仍需驗收。不新增前端 task 或以此阻擋後端交付。
- 使用未修改 client smoke test 驗證 202 可提交、各文件／簽署人異動在 queued／processing 都收到指定訊息；以 API 測試驗證提交與異動競態、failed 解鎖、succeeded 舊規則、越權及 worker 自身合法寫入。
- 發布範圍只有 migration／server／worker；不部署 client，不建立新 env 或排程。此次文件修訂本身不代表程式已實作。
