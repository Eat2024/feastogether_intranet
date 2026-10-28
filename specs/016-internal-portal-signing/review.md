# Spec 016 雙向程式審查

電子簽比較 `git diff c5a8480...ff13579`；Portal 比較 `git diff 0f814565...961ed6a8`。兩個唯讀 reviewer 分開檢查規範與規格，最後修正覆核至 `5abefa1`。

## Standards

未發現需修正的規範違反或具體程式碼異味。已核對 root/client/server/Portal AGENTS、憲章與本機票單規則：前後端透過 API 交互，權限與寫入仍由 server 驗證；資料經 repository 儲存，群寄稽核不記收件名單或憑證；未新增套件、資料表、環境變數或排程；共用表單及 Portal library 有實際需求。Portal 第三方目錄未變，vendor CONTRIBUTING 不適用。環境驗收待辦已有明確記錄，未視為通過。

## Spec

找到 1 項 P2：本人副本 ready 後若 session 過期，原直接 href 下載會導到 API 的 401 JSON，繞過 FR-008 與 API 契約要求的 Portal 重登提示。

修正 `5abefa1` 改以下載 mutation 處理，401 交由全域重登提示，只有成功才建立 Blob 下載；保留檔名、pending 控制與輪詢行為。Chrome 1280／390 已先重現失敗，再驗證 401、409 與成功 bytes。Spec reviewer 覆核確認 P2 已修正，沒有新的規格回歸。

其餘已查閱的授權、重送、舊憑證、BCC／恢復、無信箱與 Portal 回跳，未發現其他可確認的缺陷或範圍擴張。真實 Portal／iframe 旅程明確待環境驗收，未列為新增程式缺陷。

Standards：0 項、無最高問題；Spec：1 項 P2，已修正，未解決程式問題 0 項。
