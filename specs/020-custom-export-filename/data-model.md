# Data Model: 自訂當次匯出檔名

## 持久資料

2026-11-04 擴充：`esign_export_jobs` 新增 nullable `download_file_name VARCHAR(1024)` 作為首次提供下載的檔名快照。Excel／PDF 隨新匯出列建立；ZIP 於首次成功準備下載（或預設名稱 GET）以條件式更新寫入，後續不覆寫。不新增 Redis key、不修改原始成果名稱。舊紀錄不回填推測值；舊 ZIP 後續下載僅能記錄上線後首次提供的名稱。詳見 HTTP contract 的「檔名快照與歷史欄位」。

## 當次請求

| 欄位 | 規則 |
| --- | --- |
| documentId | 路徑中的既有文件 ID，後端驗證未刪除、非草稿與同部門權限。 |
| type | `excel` 或 `zip`。 |
| fileName | 可省略的字串；null／非字串拒絕。trim 後輸入最多 100 Unicode code points；未指定或空白表示原預設。 |
| exportId | 僅 ZIP 必填，既有匯出工作公開 UUID。 |
| fileId | 僅 ZIP 必填，既有檔案 ID；必須屬於該文件的該工作。 |

名稱先檢查控制與禁止字元，再 trim 與驗證長度；結尾 `.xlsx`／`.zip` 不分大小寫移除一次，再依格式補正確副檔名。主檔名不得空白、點號開頭或點號結尾，拒絕 spec 列出的系統保留名稱。最終含副檔名最多 255 UTF-8 bytes。原輸入上限與最終名稱長度分開檢查，不對正規化結果重複套用輸入上限。

## 當次回應

| 類型 | 回應 |
| --- | --- |
| Excel | `{ type: 'excel', fileName: string \| null }`；null 由既有 Excel 產檔器提供預設。 |
| ZIP | `{ type: 'zip', fileName: string, downloadPath: string }`；空白使用既有成果名稱及原 GET 路徑，自訂名稱附固定 `downloadName=client`。 |

不回傳 entity、object key、簽署人、storage URL 或其他內容。前端將回應只用於點擊時的操作，不保存成文件設定。

## 狀態與並行

只有頁面的「待操作 → 準備中 → 已交付瀏覽器／準備失敗」狀態；不是新的匯出 job 狀態，也沒有「已下載完成」狀態。使用者後續修改輸入不影響已開始請求；每次請求相互獨立。準備操作可重複，不新增歷史列、不重打包，ZIP 僅首次保存名稱快照。
