# 09: 整合驗收與交付

**What to build:** 整合驗收與交付，完整交付 Spec019 對應故事的使用者行為，含必要後端、前端及驗證。

**Blocked by:** 01–08 已 resolved；Spec017 已由 dev 的 PR41 整合並驗收。

**Status:** resolved

**Spec:** Spec019；T001–T004/T041–T044。

- [x] 適用測試與雙軸review完成，修復發現
- [x] Spec017未整合需明列阻擋，部署步驟完整且不自動部署
- [x] 完成適用的測試與 lint/build，記錄實際結果及限制。
- [x] 保留既有權限與稽核，不新增未核准表、env、排程。
- [x] 通過審查並合併至功能整合分支，追加commit紀錄。

## 實作與驗證紀錄

尚未開始。

### 2026-11-02 已完成部分與剩餘依賴

已完成整合分支建置、lint、106 suites／998 unit、7 suites／144 e2e、S3 4項、轉換工具review後8項、合成API瀏覽器驗證與雙軸code review；唯一程式P2已修復並複審通過。

尚未完成：T042（Spec017同部門授權尚未實作，無法驗收跨部門list/count/download/exportSummary）；因此本ticket保留未結案。這不是Spec019程式仍在開發，也不授權自行擴張實作Spec017。UAT切換未執行。前置完成後按quickstart補驗並結案。


### 2026-11-02 PR40/dev 整合完成

合併 dev 7d25c1a，14檔衝突及自動合併後的DTO／exportSummary／userId／ZIP UI問題已修正。T042同部門list/count/Excel/PDF/ZIP/status/exportSummary與跨部門本人副本驗收完成，Spec018白名單回歸保留。unit1081／E2E合計377（32套＋2套環境修正補跑）／security83、lint/build與契約引用通過；詳見quickstart最後一節。沒有執行UAT部署。提交以 `git log --grep="resolve PR40"` 查閱。
