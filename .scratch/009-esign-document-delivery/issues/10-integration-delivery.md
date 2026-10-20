# 10: Spec 009 整合驗收與交付

**What to build:** 整個文件與簽署人管理流程能一起運作，通過回歸與review。

**Blocked by:** 01: 完整保存草稿名單與設定；02: 後端依設定繪製浮水印；04: 管理備註、拒簽結果與歷程身分；06: 批次催簽與通知歷史；09: 6,000 份匯出容量與故障恢復驗收

**Status:** ready-for-agent

- [ ] ZIP和個別下載浮水印與hash一致，拒簽不計已簽或ZIP。
- [ ] 跨故事schema/migration、API/session/Origin、時間邊界、證據與資料裁切回歸通過。
- [ ] server lint/test/build/e2e/security/schema及client lint/build依環境驗證。
- [ ] code-review Standards/Spec兩軸問題修復並重驗。
- [ ] 逐票驗收與commit紀錄完整；整合分支交付，未經要求不發布PR或部署。

**Spec:** 009 — 對應任務 T035整合、T050–T053。以已確認規格、計畫及契約為準。
