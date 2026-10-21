# 原始量測證據

`results.json` / `gates.json` 是固定最終 production 演算法的 full4：5 個新 6,000-entry 匯出、STORE 3 組共 180+180 簽署 samples，所有結果完整保留。`signing-*.json` 含逐 request 時間/status，warmup 不計入 gates。`source-sha256.json` 記量測時 source；`worker-*-version.json` 的 processor SHA 全相同。

`resource-samples.jsonl` 是原始每 250ms RSS/heap/external/cumulative CPU 採樣中落在 processing 區間的全部樣本，新增 run/role 標籤；不含其它區間。`resource-summary.json` 的 CPU 秒數用同一 worker 在該區間最後/第一個樣本差，採樣窗口比 HTTP 輪詢 elapsed 少至多約 500ms；含同 process 的正常 PDF finalization，不能稱純壓縮 CPU。API process 也負責 fixtures/測量，worker 使用 ts-node。

此輪 RSS/CPU 欄位完整；當時 event-loop/arrayBuffers observer 沒有序列化入結果，故不宣稱有該指標。永久工具已補齊序列化並以 24 份功能 smoke/typecheck 驗證；量測後僅工具整理/防呆/型別修正，production 演算法未再改動。

`verify-*.json` 是獨立 Python zipfile 的完整 6,000-entry 驗證摘要；ZIP 會在逐份驗證與首份中斷/Range 全檔 hash 比對後清理，不提交大型 binary。`corpus-manifest.json` 是實際輸入的 24 種 fixed-seed 合成 PDF bytes/hash，重複 250 次。生成方式在 `server/test/performance/README.md`；不要將 hardlink/warm-cache 合成結果外推成正式人資文件或部署 S3 吞吐。

`before-optimization-store.json` 保留原版三輪失敗；`intermediate-gates.json` 保留第一次最佳化後仍失敗的正式量測。沒有刪除失敗來美化最終結果。

`kill-worker-recovery.json`：已寫入 575 份後真 SIGKILL 指定 child，業務租約到期以測試時鐘提前，BullMQ 鎖/停滯偵測正常等待。重新啟動兩個 OS worker，另排一個 6,000-entry 工作，兩個均完成，processing 峰值 1，固定快照不變；舊 staging/temporary 已不存在，復原 ZIP 獨立驗證通過。
