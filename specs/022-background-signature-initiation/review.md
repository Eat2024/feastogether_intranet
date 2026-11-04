# Spec 022 正式 code review

2026-11-04 完成。依 code-review skill 分開審查專案規範與規格符合性；兩軸結果不混合排序。審查後僅更新結案文件，沒有修改程式。

## Standards

固定基準：`ef0fdca6da66afe8495b589390ddaf647c9dcdbf` → `0a7c0e4471f90167c250ccf0ee5f6067f103b2de`。已核對完整 commit 清單、production 差異與最後測試／驗收增量；本輪唯讀，未另重跑測試。

**未發現未解決的規範違反或需修正的新增 heuristic finding。**

- 原 P3「possible Duplicated Code」已解決：私有 `newJobState` 統一 initial／retry 的工作預設與期限，各路徑仍保留自己的授權、輸入與重播判定。
- 公開異動的 busy 預檢已移至交易外；鎖內授權與 current-read guard 保留。此修正符合 server 權威與證據完整性原則，也避免預檢提前建立 RR snapshot；並發催簽斷言未放寬。
- Portal fixture 遷移沿用已上版的 Spec 024 邊界，未新增 022 的 client 修改、dependency、環境變數或獨立排程。工作摘要／忙碌回應僅揭露授權必要資訊，新增 queue payload 與 log 不攜帶完整輸入。
- 驗收文件區分最終 e2e、有限重試的測試時間調整、舊 `fadfc3f8` 真實長測及主機睡眠／Bull lock 異常；未將本機結果描述為 UAT 或實際 SMTP 驗證。新表 migration 非空回退保護與既有資料保存限制仍明確。

審查依據：root/server `AGENTS.md`、constitution、`docs/agents/domain.md`、backend-only 範圍及 Fowler smell baseline；tooling 已涵蓋項目不重複列為 finding。

**Standards：硬性違規 0；未解決判斷性改善 0；原 P3 已修正。**

## Spec

正式審查基準：`ef0fdca6da66afe8495b589390ddaf647c9dcdbf` → `0a7c0e4471f90167c250ccf0ee5f6067f103b2de`。依 `backend-only-scope.md` 覆寫舊前端需求，核對完整差異及前次審查後增量。

**0 項未解 findings。**

原 P3「忙碌回應缺少 existingJobId」已解決：授權後的小投影、快速拒絕與鎖內競態拒絕皆回公開工作 UUID；越權維持 404 且不含 details。普通使用者路徑不載入工作 JSON，worker 保留 lease／版本校驗。

最後補修將忙碌預檢移到公開異動交易之外，避免 REPEATABLE READ 提前建立舊快照；標題／PDF／fields／名單設定／註記／刪除／停止／補簽／催簽仍保留文件鎖內 current-read 驗證。新競態測試涵蓋預檢後才建立 active 工作的情況；未發現 TOCTOU 寫入旁路。initial/retry 的局部 READ COMMITTED、正式共享資格鎖及文件／工作鎖未被放寬。

Portal fixture 遷移未復活舊 HR 路徑；直接並行 service 的測試明確驗暫時失敗與有界重試，沒有偷改正式 queue 並行量或共用 helper。午夜 fixture 修正保留原跨日斷言。

已對照驗收紀錄：完整 e2e 50／531、專用 reconnect 1／1、unit 119／1213、schema 30、security 84，以及 build／lint 結果。SC-006 原始 result、終態觀測與 Redis 事件確認 5,001 人、5,123.645 秒、DB attempt=1／succeeded；文件明確區分舊基準、睡眠造成的 Bull 失鎖與再次領取 no-op，未宣稱新版無異常長測、UAT 效能或真實寄信驗收。

前端未改符合最新授權；前置解析、提前成功文案、未做瀏覽器／UAT 部署等限制已有揭露。

Spec：0 項未解 findings；無最高嚴重度問題。

Standards：0 項未解，無最高嚴重度問題；Spec：0 項未解，無最高嚴重度問題。
