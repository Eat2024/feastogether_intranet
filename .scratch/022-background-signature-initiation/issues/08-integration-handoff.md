# 08: 完整回歸、效能與發布交接

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 以完整背景流程完成原有簽署回歸與容量驗收，提供可審查的效能、故障恢復與發布回退證據。

**Blocked by:** [07 工作明細到期清理與可追溯摘要](07-retention.md)

**Status:** resolved

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — 全部 US；SC-001–009。

**Tasks:** [T031–T034](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `impl/022-integration` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [x] 所有受影響 201／detail 發起測試改為 202→驅動 worker→等待終態後簽署；無 production 同步 fallback，新路由 Swagger／授權覆蓋一致。
- [x] 1／100／101／5,001 各至少 20 次受理 P95≤3秒，記錄排隊、查核、正式交易與記憶體；6,001 完整指派。
- [x] 隔離空佇列先 5,001 再 5 人：大型終態後小工作 60 秒內取得執行權；另跑每人首次延遲 1 秒的 SC-006，signEndAt 超過受理後 120 分鐘，有限界線內完成。
- **原 UI 驗收暫緩／後端部分仍適用：** 只用合成資料、fake mail 及隔離 MySQL／Redis；完整跑 server lint、unit、schema、e2e 與 root build／lint，以及三故事前端驗收。未執行情境列限制，不能填通過。
- **原 UI 驗收暫緩／後端部分仍適用：** 記錄 migration 先行、worker/server/client 協調發布、舊頁刷新與回退演練；未結清非終態不得直接換回舊 server，非空表 down 拒絕。
- [x] 本票完成需驗收且整合至功能分支；不自行操作 UAT、寄真信、建立遠端 PR 或執行部署。

## 實作與驗證紀錄

`impl/022-08` 已完成測試遷移與本機80次效能矩陣，完整回歸及真實5001秒長測進行中。實際證據與限制見 [validation.md](../../../specs/022-background-signature-initiation/validation.md)。維持 claimed，待長測／整合review全部完成才由整合者結案。

## 本輪後端補充驗收

- [x] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [x] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
## 共享資格鎖補修整合紀錄

- 指定補修 commit `2655231bfaca4cee88992600991971268a9fddc2` 已合併至 `impl/022-integration`，merge commit `f12b9f4fee6439eb578f8521c5c9bebd3ec3eeaf`；僅06票追加紀錄衝突，已保留兩邊證據，程式無衝突。
- 正式 worker 與受理／retry 建立人資格採共享鎖，保留 users → document → job 與資格原子性；其他停用／Email／員編寫入仍採排他鎖並等正式提交。
- 真 worker 持鎖 5 秒期間，另一文件受理由約 5,027ms 降至約 8–12ms；實作回歸 8 suites／79 e2e、build/lint 通過，merge hook 115 suites／1,180 tests、lint 0 errors／272 既有 warnings 通過。
- 本次只整合此共享鎖 commit，不含後續同文件快速 busy 補修；08 整體驗收仍未完成，未修改 client。

## 整合中追蹤

受理／retry 快速 busy 與歷史 key 重播補修已整合；擴大回歸發現跨文件並行 accept 的 gap lock／INSERT request unique deadlock，仍待後續補修及重驗。狀態保持 claimed，不因局部 80 e2e 通過即結案。

## 跨文件受理 gap lock 補修整合紀錄

- 指定 commit `a2ae05095e0bcd287b3ed4be29e563eea9cf9271` 無衝突合併至 `impl/022-integration`，merge commit `edcfbe4b70367e7fab50445f60d333fb84369798`。只將 accept／retry 短交易設為 READ COMMITTED，正式 worker 交易及 session／global 隔離設定不變。
- 實作 82 e2e、build/lint 通過；整合 hook lint 0 errors／272 既有 warnings、115 suites／1,180 tests 通過。跨文件不存在 key／active 查詢造成的 gap lock deadlock 已修正，仍需 08 擴大回歸驗收。
- 僅操作獨立 integration worktree，沒有切換／修改使用者原 checkout 或部署；client 無變更，08 保持 claimed。

## 預審交付整合紀錄

- `impl/022-08` 指定 commit `05cb53ae82c8b71e8e3fc46d41061d71bbc260d6` 無衝突合併至 `impl/022-integration`，merge commit `8f97afb6326f1ceef1b5bd9b17160a0327a018da`。本次先整合測試遷移、Swagger 與效能測試供預審，不結案。
- 已交付證據：完整 e2e 47 suites／483 passed＋1 skipped、最後受影響回歸 16 suites／204 passed、schema 5 suites／30、security 14 suites／84、unit 115 suites／1,180，lint／build 通過。merge hook 再驗 lint 0 errors／272 既有 warnings、115 suites／1,180 unit 通過。
- T031、T034 已驗完成；T032／T033 仍未勾選，真實長時間測試與正式 code review 尚未完成。票 08 保持 claimed。
- client 差異為空，只操作獨立 integration worktree，未部署。

## 最終實作驗收交付（2026-11-04）

T031–T034已完成。程式基準`2f0657d`（最新dev／024fixture／reviewfix／snapshot補修）完整e2e50 suites／531 tests通過、專用reconnect另1／1通過，unit119／1213、schema5／30、security14／84、root build/lint通過。新版80次矩陣與6001完整性已驗；SC006舊基準真實5123.645秒成功、attempt1／5001指派，睡眠造成Bull失鎖後重新領取終態no-op並completed，完整異常與限制皆保留於validation。正常fullsuite另遇主機睡眠超時，以僅綁子程序的caffeinate重跑全綠，未放寬斷言。

未改client、未跑瀏覽器或UAT發布／寄真信。狀態保持claimed，最後一項「驗收且整合」由merger合併後勾選及resolve；正式code review由父代理收尾。

## 最終整合與結案紀錄（2026-11-04）

- 最終交付 `1aa29d6bdc9305d571acbca655bfa755a2882c6c` 無衝突合併至 `impl/022-integration`，merge commit `a61079164934b5f525b1bea52eb1eecf25f98f47`。T001–T034 均已完成驗收與整合，票 08 依 tracker 改 resolved。
- 最新 dev baseline `ef0fdca6da66afe8495b589390ddaf647c9dcdbf` 上的完整 e2e：50 suites／531 passed，reconnect 在一般套件 skip 1，專用 DB9 另 1／1 通過；schema 5 suites／30、最終 source security 14 suites／84（含最後授權移動版）、unit 119 suites／1,213、build/lint 通過。合併 hook 再驗 lint 0 errors／272 warnings、unit 119／1,213 通過。
- SC-006 實時 5,123.645 秒完成，5,001 指派、attempt=1；主機 sleep／Bull 失鎖及其後終態 no-op reclaim 已記錄。長測為舊基準，不能冒稱最新 base 再跑同長度；完整限制見 validation。
- 正式兩軸 code review 尚未執行完成，由父代理後續進行；resolved 表示本票實作驗收及整合完成，不代表正式 review 已通過。
- client 差異為空，未碰原 checkout、未部署或寄真信。
