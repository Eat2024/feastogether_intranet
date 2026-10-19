# 01: 文件到期改為已到期，保留人工停止

**What to build:** 文件到期後停止接受新簽署，建立人及簽署人可辨識「已到期」。已簽署證據、個人副本產製與下載仍可用；建立人可以永久停止文件。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 到期持久化為 expired；背景處理延遲時查詢／篩選仍顯示已到期，截止當下不得新增簽署。
- [x] 狀態 migration 保留既有 stopped 與證據；不新增欄位、資料表或排程。
- [x] 目前期限與原始期限分開呈現；固定 payload 與 hash 不變。
- [x] 到期只記一次稽核，未簽邀請失效；到期文件可由建立人永久停止，finalizing 行為維持。
- [x] 已簽署者的來源讀取、副本產製／下載與簽章驗證不受新狀態影響。
- [x] 相關單元、schema、HTTP／資料庫驗收及 lint/build 通過；契約與文件反映新行為。

## 交付界線

本張是可由正式後端 API 驗收的完整增量。前端正式串接另行交付。下一張才加入重新開放入口。

## 實作與驗證

- 完成已到期持久化、唯讀有效狀態／期限投影、並發到期防護、已簽副本及停止；補簽端點留待 ticket 02。
- T003–T011 已交付；T007 使用真實 DB 的 101 筆批次、重複執行及新期限案例，避免對內部 repository mocks 寫測試。
- TDD 已觀察原版 mapper、MySQL CHECK、expired 個人副本及 Unicode 稽核測試失敗，再實作通過。
- server 單元測試：89 suites／710 tests 通過。
- core-esign-flow HTTP／真實 DB：11 tests 通過；security-core-esign-flow：7 tests 通過。
- schema：2 suites／5 tests 通過，包含 up/down/up、expired／reopened 資料禁止回滾與既有個人副本遷移。
- server build 通過；lint:check 通過（0 errors，仍有 repository 既存 warnings）；git diff --check 通過。
- 前端未修改；不新增依賴、環境變數、資料表或欄位。部署需停止舊 expiry worker，再套 migration 及更新 HTTP／worker。

## 整合與結案

- 實作 commit：`819aa747d89a2232b931d437fc5e6c017dc72c22`。
- 已無衝突合併至整合分支 `007-esign-expiry-reopen`，merge commit：`8e083d1e1b07d9b33e1eb2b8f9833507e698053b`。
- 合併後 `git diff --check HEAD^1 HEAD` 通過；沿用上述實作驗證結果，未重跑資料庫測試。
