# 10: Spec 009 整合驗收與交付

**What to build:** 整個文件與簽署人管理流程能一起運作，通過回歸與review。

**Blocked by:** 01: 完整保存草稿名單與設定；02: 後端依設定繪製浮水印；04: 管理備註、拒簽結果與歷程身分；06: 批次催簽與通知歷史；09: 6,000 份匯出容量與故障恢復驗收

**Status:** claimed

- [x] ZIP和個別下載浮水印與hash一致，拒簽不計已簽或ZIP。
- [x] 跨故事schema/migration、API/session/Origin、時間邊界、證據與資料裁切回歸通過。
- [x] server lint/test/build/e2e/security/schema及client lint/build依環境驗證。
- [ ] code-review Standards/Spec兩軸問題修復並重驗。
- [ ] 逐票驗收與commit紀錄完整；整合分支交付，未經要求不發布PR或部署。

**Spec:** 009 — 對應任務 T035整合、T050–T053。以已確認規格、計畫及契約為準。

## 實作與本機驗收（2026-10-21）

- 工作分支 `009/10-integration-delivery`，由整合 `c1fe44b` 建立；只修相關結案／儲存問題並補跨故事測試，未改 client 功能或新增 schema/config/dependency。
- 真 MySQL 重現並修復全拒 maintenance 遺漏，以及兩位不同拒簽人的 REPEATABLE READ 舊快照競態；各自紅→綠。
- local 新 ZIP 固定檔案版本偵測一般同長度改寫，重用與 Range 回503、不新建快照；完整校驗界線見文件。
- 真水印 PDF 與 ZIP entry bytes 一致、pending/rejected 排除；v2/v3 證據不變；管理與匯出 session／Origin／歸屬及本人裁切回歸。
- 驗證：99 suites/841 unit、17 suites/130 e2e、7 suites/34 security、2 suites/6 schema；root server/client build 與 lint 通過。測試環境 Node26.4.0／MySQL8.4.11／Redis8.8.0。
- 41FR對照、實際路徑、發版／回退及未驗證限制見 `specs/009-esign-document-delivery/implementation-notes-integration.md`。T028 保持未完成，部署 S3 容量移交 ticket11，不能以本機結果宣稱部署通過。
- 本票維持 claimed；待整合後 Standards／Spec review、修復與最終交付完成，再由 merger/root 結案。
