# 02: ZIP 下載套用當次自訂檔名

**What to build:** 員工可將同一輸入框的名稱套用到首次產生或既有 ZIP 的當次下載，保持大檔原生串流、續傳與共用成果不變，完成 Excel／ZIP 格式切換及全功能驗收。

**Blocked by:** [01：Excel 匯出套用當次自訂檔名](01-excel-export-filename.md) — 沿用其共用準備下載 API、名稱規則、前端請求邊界與已確認的最小瀏覽器行為。

**Status:** ready-for-human


**Source:** [Spec 020](../../../specs/020-custom-export-filename/spec.md)、[Plan](../../../specs/020-custom-export-filename/plan.md)、[Tasks](../../../specs/020-custom-export-filename/tasks.md)。

**Scope:** US2，以及 US3 適用於 ZIP 與格式切換的提示／修正。對應 T008–T012、T013–T014 的其餘部分、T015，以及 T016–T018 的其餘檢查與全功能收尾。

- [x] 首次產生及已有 ZIP 均可使用點擊下載時的檔名；輸入「年度副本」取得「年度副本.zip」，留白維持原成果名稱。
- [x] ZIP 準備要求工作與檔案識別值，驗證兩者屬於指定文件且成果可下載；不允許任意網址、儲存位置或使用者提供身分。實際下載仍重新授權，不以準備成功取代 GET 檢查。
- [x] 自訂名稱使用既有同源 GET 串流：URL 只有固定命名旗標，不含檔名；該模式的 attachment 不指定 filename／filename*，瀏覽器採用後端驗證過的建議名稱；未帶旗標的舊下載行為完全不變。
- [x] 檔名只存在當次請求／必要回應與頁面記憶體，不寫入 metadata 或日誌；不重新打包、不新增工作／歷史、不變更 ZIP 內部 PDF 名稱或內容。
- [x] 兩名有權限員工同時用不同名稱下載同一成果，各自名稱正確，共用檔案 hash、工作與歷史筆數不變。
- [x] 保留原下載的授權、200／206／416、Range／If-Range、ETag 與快取安全標頭；非法或重複命名旗標拒絕，準備後資格失效仍不得下載。
- [x] 前端不把 ZIP 整包讀入 Blob；準備中防重複提交，下載不取代原輸入頁，不把啟動原生下載顯示成下載完成。準備失敗使用中文提示，保留輸入；傳輸中斷沿用瀏覽器下載介面。
- [x] Excel／ZIP 切換時已輸入 `.xlsx`／`.zip` 能改成正確的單一副檔名；非法名稱修正後可原頁重試，下載開始後改值只影響下次操作，重新整理不保存名稱。
- [x] 完成最終輸入框說明、移除未支援提示，確認歷史重下載及單人 PDF 行為不變。
- [x] 以真 DB 整合測試驗證同部門／跨部門、成果歸屬、重複請求與無持久副作用；只使用符合專案保護規則的測試資料庫。
- [ ] 完成 Chrome／Edge 實際入口網 iframe 及 Safari／Firefox 同源瀏覽器驗收，涵蓋檔名、大檔、並行、失敗後原頁保留與中斷續傳；未取得目標環境須記錄未驗證，不得把必要驗收勾選完成。
- [x] 完成受影響 package 及 root lint/build、後端測試、資料邊界檢查與 spec／contract／tasks 對照，記錄實際結果；不得使用先前撤回草稿的測試結果作為證據。
- [ ] 驗收通過後整合至同一功能整合分支，追加驗證與 commit 紀錄，再改為 resolved；不因本票建立而部署、建立遠端 PR 或發布。

## Comments & Implementation Results

尚未實作。後續結果追加於此，保留上述驗收條件。

使用者已於本次指示批准拆分並要求 implement-spec 與 code review。

### 實作分支進度（2026-11-03）

ZIP 準備、同源原生下載、固定旗標、欄位驗證與提示已完成；69 helper/HTTP tests 與 96 真DB匯出/歷史 e2e tests 通過，server build、root lint、client typegen/tsc 通過。等候整合目錄 build、真瀏覽器與 review，狀態維持 claimed，不提前宣稱所有驗收完成。

### 整合驗收與 Code review（2026-11-03）

- `18fbd9d` 已整合至 `feat/020-custom-export-filename`；review 清理為 `45188ba`。
- 111 suites／1150 tests、2 suites／96 DB tests、root lint/build 通過；無 migration/config 或環境檔變更。
- Chrome／Firefox／WebKit 實際前端加合成 HTTP API／串流與跨 origin iframe 驗收通過。Chrome 額外通過約 32 MiB ZIP hash、busy、點擊時名稱、錯誤修正及刷新清空驗證。
- Standards：0 個實質問題，2 個非阻擋註解／說明已修正。Spec：0 個程式缺陷，1 個尚未完成的實機驗收缺口。
- 尚缺原訂實機 Edge／Safari、實際入口網及原生中斷續傳；已整合但尚不符合 resolved 條件，因此轉 ready-for-human。未收到縮減驗收範圍的指示，原驗收條件保持不變。詳見 quickstart。
