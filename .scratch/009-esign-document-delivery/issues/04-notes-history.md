# 04: 管理備註、拒簽結果與歷程身分

**What to build:** 建立人永久保存備註，列表與匯出呈現拒簽結果，歷程辨識簽署人。

**Blocked by:** 03: 內外部拒簽與文件結案

**Status:** claimed

- [x] 備註trim0–30 code points，空字清除，失敗保留原值，僅建立人可改。
- [x] 列表、已拒分頁及簽署紀錄匯出的時間與原因一致。
- [x] 本人簽拒顯姓名，系統寄信/產製事件仍為系統，不改舊audit。
- [x] 本人DTO、信件及PDF不含管理備註；通知摘要待ticket6整合。
- [x] 完成US6適用測試及正式畫面驗收。

**Spec:** 009 — 對應任務 T045–T049。以已確認規格、計畫及契約為準。

測試接縫：既定 US6 管理 API（保存／讀取／授權／本人裁切）與正式管理頁面。使用 TDD 逐段驗證。

實作與驗收：[Ticket04紀錄](../../../specs/009-esign-document-delivery/implementation-notes-signer-management.md)。待整合分支合併後改 resolved；通知摘要依原範圍交由 Ticket06。
