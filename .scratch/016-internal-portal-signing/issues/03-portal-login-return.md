# 03：Portal 共用登入回跳與改密碼接續

**What to build:** 員工點帶 redirect_to 的登入連結後，登入或必要改密碼完成即自動抵達目的頁；其他頁面可擴充允許清單共用此能力。

**Blocked by:** 無，可與 02 並行。

**Status:** ready-for-human

**Tasks coverage:** T005–T011；T001/T002 的 Portal 工作區與契約檢查。

- [x] 集中允許映射初始包含「我的電子簽」；新增測試頁映射不用修改登入或改密碼判斷，映射移除後舊 session 目的地失效。
- [x] 未登入、已登入、錯誤帳密重試、無參數新登入與非法參數符合契約，POST 不因缺少 query 清掉目的地。
- [x] 必須改密碼者先完成改密碼；重新點 Email 不能繞過待辦，更新失敗保留目的地，成功及登出正確清除。
- [ ] 一般登入仍回原首頁，目的頁仍檢查權限；既有 iframe/session 銜接可抵達我的電子簽，不改 launch 協定。
- [x] 保留 Portal 原有工作區修改，PHP 語法、可隔離回跳測試與瀏覽器案例留有結果；環境不可用的驗收明確保留待完成。

## 實作與本機整合（2026-10-28）

Portal `feat/016-portal-login-return` 已整合 `961ed6a8`，工作區 `/Users/user/Documents/portal-016-integration`。兩個 PHP CLI harness（library 與真正 controller 的隔離邊界）及 8 個 PHP 檔語法檢查通過；原 master/index.php 變更保留。詳細證據與待驗收案例見 Portal `docs/testing/login-redirect.md`。

通用清單、登入、改密碼、登出實作已完成；未提供可用的真實 Portal 服務與合成帳號，iframe/session 實際旅程尚未驗收，因此保留 `ready-for-human`，不虛報 resolved。無推送或部署。
