# 10: Spec 009 整合驗收與交付

**What to build:** 整個文件與簽署人管理流程能一起運作，通過回歸與review。

**Blocked by:** 01: 完整保存草稿名單與設定；02: 後端依設定繪製浮水印；04: 管理備註、拒簽結果與歷程身分；06: 批次催簽與通知歷史；09: 6,000 份匯出容量與故障恢復驗收

**Status:** resolved

- [x] ZIP和個別下載浮水印與hash一致，拒簽不計已簽或ZIP。
- [x] 跨故事schema/migration、API/session/Origin、時間邊界、證據與資料裁切回歸通過。
- [x] server lint/test/build/e2e/security/schema及client lint/build依環境驗證。
- [x] code-review Standards/Spec兩軸問題修復並重驗。
- [x] 逐票驗收與commit紀錄完整；整合分支交付，未經要求不發布PR或部署。

**Spec:** 009 — 對應任務 T035整合、T050–T053。以已確認規格、計畫及契約為準。

## 實作與本機驗收（2026-10-21）

- 工作分支 `009/10-integration-delivery`，由整合 `c1fe44b` 建立；只修相關結案／儲存問題並補跨故事測試，未改 client 功能或新增 schema/config/dependency。
- 真 MySQL 重現並修復全拒 maintenance 遺漏，以及兩位不同拒簽人的 REPEATABLE READ 舊快照競態；各自紅→綠。
- local 新 ZIP 固定檔案版本偵測一般同長度改寫，重用與 Range 回503、不新建快照；完整校驗界線見文件。
- 真水印 PDF 與 ZIP entry bytes 一致、pending/rejected 排除；v2/v3 證據不變；管理與匯出 session／Origin／歸屬及本人裁切回歸。
- 驗證：99 suites/841 unit、17 suites/130 e2e、7 suites/34 security、2 suites/6 schema；root server/client build 與 lint 通過。測試環境 Node26.4.0／MySQL8.4.11／Redis8.8.0。
- 41FR對照、實際路徑、發版／回退及未驗證限制見 `specs/009-esign-document-delivery/implementation-notes-integration.md`。T028 保持未完成，部署 S3 容量移交 ticket11，不能以本機結果宣稱部署通過。
- 本票維持 claimed；待整合後 Standards／Spec review、修復與最終交付完成，再由 merger/root 結案。

## 整合紀錄

- ticket 分支 tip：`fb971df`；以 `--no-ff` 合併，merge commit：`725eab4cf0ce3265d4679697d3951040d12216b2`，無衝突。
- 整合分支重跑本機 storage、拒簽 service 與 maintenance 單測，3 suites／19 tests 通過；`git diff --check` 通過，未重跑全量共用 DB 測試。
- 保留 `claimed` 與未完成 review／最終交付驗收；待 Standards／Spec 雙軸審查及集中修復後再結案。T028 仍未勾選，ticket 11 維持 `ready-for-human`。

## 最終結案（2026-10-21）

- 全部 4 項審查 finding 由同一 implementer 修正，commit `5d0519e`；以 `--no-ff` 整合於 `67693d778abbb73bd88dba411e2c6a546b790c16`。
- Standards／Spec reviewer 分別在上述固定整合版本回查：Standards 原 2 項 P3、Spec 原 2 項 P2 均已解決；兩軸未解決與新增 finding 各為 0。完整分軸報告見 `specs/009-esign-document-delivery/review-results.md`。
- 修正後 841 unit、9 S3 adapter、4 S3 API/worker tests 通過；真 Chrome LA 跨時區流程、ExcelJS 產檔讀回與 root build/lint 通過。合併 diff 檢查通過，回查未重跑完整測試。
- Tickets 01–10 驗收與整合紀錄完整，本票結案為 resolved；上方 claimed 為當時整合階段的歷史紀錄。交付分支 `feature/009-esign-document-delivery`。
- 部署 S3 容量／實際 IAM 與網路仍由 ticket11（ready-for-human）承接，T028 未勾選；本票結案不代表部署容量驗收完成。
