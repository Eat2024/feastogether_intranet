# 08: S3 儲存的大量 ZIP 匯出

**What to build:** 切換既有S3儲存設定後，完整匯出與下載流程支援大型串流及續傳。

**Blocked by:** 07: 背景 ZIP 匯出與七天重用：本機儲存

**Status:** resolved

- [x] multipart有界緩衝與part數限制，完成上傳後才發布。
- [x] 同一正式畫面可查進度、七天重用、原生下載與Range續傳。
- [x] 中斷abort、uploadId/generation清理與版本引用正確，不刪來源。
- [x] 全鏈路不組全ZIP Buffer，不新增signed URL或環境變數。
- [x] 完成S3整合測試與受影響package驗證。

**Spec:** 009 — 對應任務 T018、T020、T023、T025–T027。以已確認規格、計畫及契約為準。

## 實作紀錄（待 merger 整合結案）

- 工作分支 `009/08-s3-zip-export`，基於整合 `606d95e`；儲存 seam 先 red → green。沿用原 API／worker／正式匯出畫面，無新增 migration、環境變數或 presigned URL。
- S3 以 lib-storage、16 MiB 起始 part／queueSize=2 串流，依預估調 part 並限制實際 10,000 parts。預估不是 ContentLength；actual size/hash、VersionId 待完成後才回傳發布。先持久化 generation，再於 MPU 建立後先持久化 uploadId，才傳 part。
- abort 等待在飛 HTTP 與來源停止後清理；硬中斷由既有 maintenance 有界掃描 exports/ 的版本及 MPU，保存分頁游標。僅保護 active 成果或同 generation 有效 lease；修正 failed staging 永久被引用問題。
- 真 HTTP Moto adapter 6 tests；隔離 MySQL/Redis + 真 S3 HTTP API/worker 3 tests（33 MiB multipart）；真 Chrome 另加1項通過：跨建立人、七天重用、原生下載／解壓、Next Range／If-Range／ETag。未對正式 AWS IAM／網路吞吐或 >4 GiB S3 容量宣稱驗證。
- 詳細測試方式、授權需求及限制：[S3 實作紀錄](../../../specs/009-esign-document-delivery/implementation-notes-s3.md)。

- 已merge整合 `9b88316`；最終root build/lint、99 suites／839 units、6項adapter真HTTP通過。等待merger合併後將狀態改resolved。

## 整合紀錄

- ticket 分支 tip：`f7d0655`；以 `--no-ff` 合併，merge commit：`31bf0d53e542211a19a8acd250e114f6e10a9d29`，無衝突。
- 整合分支重跑 S3／本機 storage 及 maintenance 單測，3 suites／13 tests 通過；`git diff --check` 通過。已確認 client-s3 與 lib-storage 均為 `3.1149.0`。
- S3 功能與 active generation 清理修正已整合，標記 `resolved`；無新增 schema 或環境變數。正式 AWS IAM、部署網路及容量效能未在本票驗證，容量門檻留 ticket 09；未重跑共用 DB／Redis。
