# 08: S3 儲存的大量 ZIP 匯出

**What to build:** 切換既有S3儲存設定後，完整匯出與下載流程支援大型串流及續傳。

**Blocked by:** 07: 背景 ZIP 匯出與七天重用：本機儲存

**Status:** ready-for-agent

- [ ] multipart有界緩衝與part數限制，完成上傳後才發布。
- [ ] 同一正式畫面可查進度、七天重用、原生下載與Range續傳。
- [ ] 中斷abort、uploadId/generation清理與版本引用正確，不刪來源。
- [ ] 全鏈路不組全ZIP Buffer，不新增signed URL或環境變數。
- [ ] 完成S3整合測試與受影響package驗證。

**Spec:** 009 — 對應任務 T018、T020、T023、T025–T027。以已確認規格、計畫及契約為準。
