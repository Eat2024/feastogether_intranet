# 11: 部署 S3 容量與實際環境驗收（承接 ticket09 / T028）

**What to build:** 在指定部署測試機、S3 bucket/IAM 與實際網路，完成原 Spec009 T028 尚未量測的容量門檻。這是原有驗收移交，不新增功能需求。

**Blocked by:** 09: 6,000 份匯出容量與故障恢復驗收

**Status:** ready-for-human

- [ ] 提供隔離測試環境的機器規格、測試 S3 bucket/region/IAM/網路條件；使用安全的既有設定管道，不在 ticket 或聊天貼憑證。
- [ ] 確認 ZIP bucket Versioning=Enabled（非 Suspended），實際 IAM 支援固定版本讀取、版本刪除及 multipart／版本列舉清理；無 VersionId／null version 必須失敗，不發布成果。
- [ ] 用真部署 S3 adapter、真 HTTP/MySQL/Redis/worker 執行 6,000 份代表性 PDF、>4 GiB ZIP64；串流逐 entry bytes/CRC/SHA 驗證，不能改用 Moto 大容量或 local 數據。
- [ ] 同一固定負載與預熱方式比較 baseline/export 正常簽署，量測首次 6,000-entry snapshot 受理 p95 ≤5 秒、簽署 p95 增幅 ≤20%，無 OOM/簽署失敗；保留所有 status/latency/time，說明樣本數與變異。
- [ ] 固定同一程式版本比較 STORE/DEFLATE 1/6 的 elapsed/CPU/RSS/size；測試參數僅供實驗，不新增正式 env 開關。
- [ ] 實際部署測試 worker 中止、multipart 中斷/abort 與殘件回收、IAM 拒絕、兩 worker 全域並行上限、HTTP 中斷/Range 復原，原始 PDF 不受清理影響。
- [ ] 上傳可重現但無憑證/個資的原始數據與環境說明到 Spec009 驗收文件；全部通過後才能勾選 T028 與宣稱部署容量通過。

**Spec:** [Spec009](../../../specs/009-esign-document-delivery/spec.md) — 原 ticket09 / T028 的部署部分。

## 移交理由與現有證據

使用者尚未提供指定部署規格或 S3 測試環境；不能把本機 warm-cache 合成容量或 Moto 小量協定測試外推成部署結論。既有 S3 adapter 功能已由 ticket08 驗證，本項追蹤部署容量/權限/網路門檻，不重新實作該功能。

- [本機容量與故障結果](../../../specs/009-esign-document-delivery/performance-results.md)
- [本機合成量測工具與限制](../../../server/test/performance/README.md)
- [S3 功能驗證紀錄](../../../specs/009-esign-document-delivery/implementation-notes-s3.md)

本機 harness 有意 fail-closed 限制 `/tmp` local storage 與 `feastogether_intranet_test_capacity_*` DB；部署驗收須在已確認的隔離環境準備 S3 fixture/量測入口，不能直接移除保護後連正式資料。
