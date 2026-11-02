# 09: 整合驗收與交付

**What to build:** 整合驗收與交付，完整交付 Spec019 對應故事的使用者行為，含必要後端、前端及驗證。

**Blocked by:** 01–08 已 resolved；另待 Spec017 部門政策實作與整合驗收（外部依賴）。

**Status:** ready-for-agent

**Spec:** Spec019；T001–T004/T041–T044。

- [ ] 適用測試與雙軸review完成，修復發現
- [ ] Spec017未整合需明列阻擋，部署步驟完整且不自動部署
- [ ] 完成適用的測試與 lint/build，記錄實際結果及限制。
- [ ] 保留既有權限與稽核，不新增未核准表、env、排程。
- [ ] 通過審查並合併至功能整合分支，追加commit紀錄。

## 實作與驗證紀錄

尚未開始。

### 2026-11-02 已完成部分與剩餘依賴

已完成整合分支建置、lint、106 suites／998 unit、7 suites／144 e2e、S3 4項、轉換工具review後8項、合成API瀏覽器驗證與雙軸code review；唯一程式P2已修復並複審通過。

尚未完成：T042（Spec017同部門授權尚未實作，無法驗收跨部門list/count/download/exportSummary）；因此本ticket保留未結案。這不是Spec019程式仍在開發，也不授權自行擴張實作Spec017。UAT切換未執行。前置完成後按quickstart補驗並結案。
