# Quickstart：Spec 030 驗證指南

本文件是實作後的驗證計畫；目前僅完成設計，以下測試尚未執行，不代表功能完成。

## 前置條件

- 使用合成文件、簽署人與 PDF；測試資料庫名稱必須以 feastogether_intranet_test 開頭，不可在 UAT／正式資料執行故障注入或刪檔測試。
- 依既有 `.env.example` 準備本機／測試設定，不在文件、指令輸出與版本控制中放入 secret。
- 已啟動測試 MySQL／Redis，測試 storage 使用隔離 local 目錄；S3 測試使用專用 bucket/prefix 及既有測試配置。
- 依 [契約](contracts/zip-exports.md) 和 [資料模型](data-model.md) 實作後，使用現有匯出 e2e fixture 建立可控制的簽署與 worker 執行情境。

## 指令

在 repository root 執行，測試名稱若依 tasks 調整應同步更新本指南：

```bash
pnpm -C server test -- --runInBand
pnpm -C server test:e2e -- --runTestsByPath test/esign-export.e2e-spec.ts test/esign-export-history.e2e-spec.ts test/export-retention.e2e-spec.ts
pnpm -C server test:s3
pnpm -C server test:s3:e2e
pnpm build
pnpm lint
```

單一 package 開發先跑受影響測試與 `pnpm -C server lint:check`／`pnpm -C client lint`。跨前後端交付執行 root build/lint；server 只檢查不修正時用 lint:check。沒有 client test script，不宣稱已跑 client 自動化測試。

## 必測情境與證據

| 情境 | 操作／斷言 | 對應 |
| --- | --- | --- |
| 按需更新 | 1 人產 ZIP；第 2 人簽後讀 preview，工作數不變；POST 更新後實際解壓並確認 2 個不同正確 PDF | SC-001 |
| 不因簽署觸發 | 舊 ZIP 後新增 100 筆，查詢／重整多次，新增工作為 0 | SC-002 |
| 並發 | 10 個有權限 session 同時申請，工作 ID 相同、進行中工作數 1；最新時下載 10 次不增加工作／歷史 | SC-003 |
| 固定名單 | 固定 13 份後增加第 14 人；再申請共用同工作；完成 ZIP 仍 13 份，可下載且提示缺 1，無自動排下一版 | SC-004 |
| 重試 | 新版失敗、舊版可下載；重試同 ID、同 snapshot hash；完整性錯誤及舊 failed 不可重試 | FR-009 |
| 等待來源 | 部分個人 PDF 尚未就緒，工作等待；完成後不得漏檔；來源失敗呈現錯誤 | FR-008 |
| 原子發布 | 注入新物件寫完但交易未提交故障，舊版仍 active；發布成功後舊工作 superseded、file pending/deleted | SC-005 |
| 清理恢復 | storage.delete 一次失敗，新版可下；恢復後 maintain 補刪；刪成功回寫前 crash，重跑仍安全 | SC-006 |
| 範圍保護 | 比對新版、其他文件 ZIP、原始 PDF、個人 PDF hash／存在狀態不受舊版清理影響 | FR-011 |
| 舊連結 | prepare、直接 GET、Range 都不可取得 superseded；歷史資訊不變且無下載按鈕 | SC-007 |
| 權限 | 非同部門、未登入、已刪文件、錯 document/file/job 關聯均不得下載或更新 | FR-014 |
| 舊資料 | 多份舊 completed，最新缺檔不退回舊版；有新增可明確更新；升級不自動打包或刪檔 | FR-015 |
| 同數異集合 | 相同總人數、不同紀錄 ID 可辨識新增；僅改名或 PDF ready 不視為新簽署 | FR-003 |
| 容量 | 6,000 份具代表性大小／頁數的不同 PDF，量測耗時與峰值記憶體，離頁返回仍能取得進度與成果 | SC-008 |

storage 測試須覆蓋 local 及 S3 真實刪除語意：S3 以完整版本 reference 驗證原版本不存在，不以 delete marker 或 mock 成功代替。故障以隔離 fixture／stub 注入，不手動毀損共享檔案。

## 瀏覽器驗收

1. 以有部門匯出權限的員工開啟文件匯出頁，選 ZIP。
2. 驗證最新／過時／處理中／失敗／已取代文案及對應操作；更新中的舊版下載必須顯示其份數。
3. 更新後離開再返回，進度與工作不變；新版完成後仍可直接下載本次成果，即使新增簽署。
4. 開兩個瀏覽器 session，另一人完成更新使舊頁連結失效，舊頁顯示重新取得資訊，不自動打包。
5. 歷史保留被取代列及原名稱；新版可用，舊版無下載／重試；更改下載名稱不產新工作。

## 交付證據

記錄環境、指令、結果與未執行原因；保存無個資的 ZIP entries、工作 ID／數量、狀態轉移與檔案存在斷言。容量報告記錄實際文件量與負載，不能只複製極小 PDF 宣稱通過。部署前確認所有服務及 worker 同版，採修正版回復而非回退不識別新狀態的舊程式。

## 2026-11-06 範圍澄清

使用者已確認目前沒有 ZIP 匯出 `expired` 資料，本次移除該歷史狀態的相容分支與驗證，不做資料回填或恢復。文件簽署期限／到期邏輯不在此調整範圍；已完成 ZIP 意外缺檔仍依不可用處理。

## 2026-11-06 狀態邊界補充

- 文件 expired 仍代表「已超過簽署期限且尚有人未簽」，完全保留文件 DTO、查詢推導與 client esignDocuments 的此狀態。
- 只清 ZIP 匯出 service／repository 的 expired 判斷與未使用 archiveFile()；未確認其他匯出類型資料前，共用 EsignExportStatus 與歷史頁保留 Excel／PDF 的 expired 相容，不能用 ZIP 查詢結果推論全部。
- 保留 expires_at、idx_esign_export_jobs_expires_at、idx_esign_exports_reuse 中原欄位及 API expiresAt（新 ZIP 仍為 null），不做 schema migration。本輪未查驗所有 export_type 的非 null expires_at，亦未查驗全部檔案 archive_status 分布，不能宣稱可全域刪除。
- 若另案要移除所有匯出 expired／expires_at，需先唯讀盤點全部 export_type/status、file_purpose/archive_status 及非 null expires_at，再明確規劃 migration 與相容切換；不納入 030。
