# 02: 建立人重新開放補簽

**What to build:** 建立人為已到期文件填寫新截止時間與原因，原未簽署者可以繼續簽署。可多次補簽，保留完整歷程；外部簽署人使用新邀請，舊連結與舊寄信工作不能影響新資格。

**Blocked by:** 01: 文件到期改為已到期，保留人工停止

**Status:** resolved

- [x] 僅建立人可對已到期且仍有未簽者的文件立即補簽；新期限必須在未來，原因 trim 後 1–500 個 Unicode code points。
- [x] 比對建立人讀取的期限，防止同輪並發及跨輪舊要求重送；交易失敗不留下部分狀態。
- [x] 原始文件、簽署對象、已簽證據與副本不變；多輪補簽最終仍沿用既有完成流程。
- [x] 每輪記錄前後期限、原因、操作者與時間；簽署人不能取得內部原因或操作者。
- [x] 外部未簽者取得新邀請，建立人可以唯讀取得並轉交；不新增自動通知。舊 token／cookie 與通知工作不能恢復或清除新資格。
- [x] 已停止、已完成及 finalizing 不可補簽；舊到期停止文件不恢復。
- [x] 單元、HTTP、安全性、真實資料庫競態與既有證據回歸驗證通過，契約及前端交接文件完整。

## 交付界線

邀請輪替與舊通知防護同一張完整交付，不拆成不安全的中間版本。前端正式串接另行交付。

## 實作驗收

補簽 API、建立人唯讀新邀請、舊通知退休及世代防護、兩輪歷程及角色裁切已完成。完整 core DB 測試包含並發、交易回滾、兩輪續簽至 completed 與已簽證據／副本保留；API coverage 已由正式契約納入新端點。

驗證：單元 91 suites／738 tests；e2e（不含獨立 scale）10 suites／74 tests；security 6 suites／25 tests；schema 2 suites／5 tests；server build、lint:check（0 errors）及 diff-check 通過。完整記錄在 Spec 007 quickstart。

## 整合與結案

- 實作 commit：`05f4fdd`。
- 已無衝突合併至整合分支 `007-esign-expiry-reopen`，merge commit：`3d1cf6b2764ad824e55ce25b60a5af8a6575fc90`。
- 合併後 `git diff --check HEAD^1 HEAD` 通過；沿用上述實作驗證結果，未重跑資料庫測試。

## PR 對應

- [PR #14](https://github.com/Eat2024/feastogether_intranet/pull/14)：供獨立審查；ticket 在本機整合分支結案，遠端 PR 尚未合併。
