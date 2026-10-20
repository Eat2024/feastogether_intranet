# 09: 6,000 份匯出容量與故障恢復驗收

**What to build:** 大量匯出在代表性容量下可完整取得，並能從worker或儲存失敗恢復。

**Blocked by:** 07: 背景 ZIP 匯出與七天重用：本機儲存；08: S3 儲存的大量 ZIP 匯出

**Status:** claimed

- [x] 6,000代表性PDF、>4GiB ZIP64解壓與hash完整無漏件。
- [x] 受理p95≤5秒、正常簽署p95增幅≤20%、無OOM或簽署失敗；記錄實際環境。
- [ ] 比較STORE/DEFLATE1/6，測local與部署S3，不把候選參數當效能證據。
- [x] 兩worker全域限制、kill-worker、缺檔/竄改、磁碟滿/上傳中斷與續傳通過。
- [x] 真實環境未提供時明記未驗證，不捏造容量成績。

**Spec:** 009 — 對應任務 T028。以已確認規格、計畫及契約為準。

## 實作與驗證（待 merger 整合後結案）

- 本機已完成全部容量/故障門檻；原 AC「測 local 與部署 S3」中的部署部分移交 [11-deployment-s3-capacity.md](11-deployment-s3-capacity.md)，仍待環境，沒有宣稱 AWS/S3 部署通過；T028 維持未勾選。09 原 AC 保留，不刪除未驗門檻。
- 新增永久隔離 benchmark、可重製合成 PDF generator、獨立 Python ZIP64 verifier，以及帶原始數據的 [performance-results.md](../../../specs/009-esign-document-delivery/performance-results.md)。
- 原版本簽署 p95 未達門檻，保留失敗後修正：Map lookup、進度每秒節流（仍 audit save）、快照僅載入必要欄位、受理同次保存已解析副本、worker 移除冗餘 metadata query/save；不改 API contract，不增 migration/env/dependency。
- 固定最終版本：5 份新 6,000-entry / >4 GiB ZIP 全 entry bytes/CRC/SHA/ZIP64 通過；first acceptance p95 250.79ms；STORE baseline/export 各 180 個真 HTTP 簽署 pooled p95 19.42/22.16ms（+14.11%），全部成功；每輪變異與第一輪尖峰完整記錄。
- STORE 約 10.9s，DEFLATE1/6 約 94.9/92.3s、僅比 STORE 小約 0.24%；無 OOM。API/worker processing peak RSS 約 524/550 MiB（ts-node + 合成 orchestration），不外推部署。
- 第 575/6,000 份後真 SIGKILL，兩個 OS worker 接手且另排一個 6,000-entry 工作：兩工作完成、processing peak=1、固定快照不變、舊 staging 清除、復原 ZIP 全 entry 驗證通過。業務租約時間提前，BullMQ 實際鎖/停滯等待未 mock。
- 真 HTTP 缺檔復原、竄改拒絕、舊 generation fencing、queue enqueue failure recovery、Range 邊界均通過；新增 ENOSPC I/O 注入證明半包刪除與可重試（不填滿真磁碟）；S3 multipart 中斷沿用 ticket08 小量真 HTTP 驗證。
- 驗證：server 99 suites / 840 unit；export e2e 4 tests；build；lint 0 errors；benchmark 獨立 TypeScript typecheck；工具整理後 24 份 HTTP/worker/ZIP/Range smoke。client 無修改。
