# 02: 後端依設定繪製浮水印

**What to build:** 完成副本依固定watermark設定由後端加印，下載不再由前端繪製。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [x] true每頁中文正確，false不畫；旋轉/CropBox/橫直頁可讀。
- [x] 合法固定中文字型隨部署交付，簽名與QR可用。
- [x] 先加印後計算hash；舊完成副本不覆寫。
- [x] 完成US2測試與受影響package驗證。

**Spec:** 009 — 對應任務 T010–T014。以已確認規格、計畫及契約為準。

## 實作驗證

詳見 [浮水印驗證紀錄](../../../specs/009-esign-document-delivery/implementation-notes-watermark.md)。完成程式與驗證，等待合併至整合分支後由整合者標記 resolved。
