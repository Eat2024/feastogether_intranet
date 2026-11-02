# Spec 019 Code Review 紀錄

日期：2026-11-02。Standards 與 Spec 兩軸獨立審查整合版本 `1940095`，兩者最終確認同一項 P2 問題；本紀錄記載初次結論與修復，不宣稱修復後已通過複審。

## 已確認問題與修復

`inspectExportRetention` 僅把 completedAt 非 null 或 completed 視為固定工作候選；runtime repository 另包含 expired。因此較新 expired 缺少 completedAt 時，工具會錯把較舊 completed 標為 fixed，與 API 的固定不可用工作不一致。

修復：工具納入 expired，先固定最新候選，再檢查產物完整性。異常缺時間工作仍 unavailable，不能推測時間、改選舊檔或重建。同步 data-model／research，補上真實 MySQL／本機 storage 的回歸；red 失敗後 green 為 8 tests 全過。未修改 runtime 選取或下載安全檢查。

曾檢視相同大小損毀檔是否漏查；因本機 storage 已驗證 inode／size／mtimeNs／ctimeNs 完整性指紋，S3 使用固定 VersionId，審查撤回此暫定 finding。未新增每次下載整檔 hash 或其他 runtime 抽象。

## 文件與剩餘驗收

Spec 006 的 TTL、Spec 010 的預檢／無信箱規則、Spec 015 的歷史重新下載／ZIP 契約已註明被 Spec 019 取代；保留歷史測試證據。前端過時註解已同步。

實測詳見 [quickstart](quickstart.md)。Spec 017 部門政策仍為外部整合與驗收依賴，T042 不標完成；UAT 資料轉換及部署未執行。
