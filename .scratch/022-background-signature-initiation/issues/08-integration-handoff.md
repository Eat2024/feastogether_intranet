# 08: 完整回歸、效能與發布交接

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 以完整背景流程完成原有簽署回歸與容量驗收，提供可審查的效能、故障恢復與發布回退證據。

**Blocked by:** [07 工作明細到期清理與可追溯摘要](07-retention.md)

**Status:** claimed

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — 全部 US；SC-001–009。

**Tasks:** [T031–T034](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `impl/022-integration` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [ ] 所有受影響 201／detail 發起測試改為 202→驅動 worker→等待終態後簽署；無 production 同步 fallback，新路由 Swagger／授權覆蓋一致。
- [ ] 1／100／101／5,001 各至少 20 次受理 P95≤3秒，記錄排隊、查核、正式交易與記憶體；6,001 完整指派。
- [ ] 隔離空佇列先 5,001 再 5 人：大型終態後小工作 60 秒內取得執行權；另跑每人首次延遲 1 秒的 SC-006，signEndAt 超過受理後 120 分鐘，有限界線內完成。
- **原 UI 驗收暫緩／後端部分仍適用：** 只用合成資料、fake mail 及隔離 MySQL／Redis；完整跑 server lint、unit、schema、e2e 與 root build／lint，以及三故事前端驗收。未執行情境列限制，不能填通過。
- **原 UI 驗收暫緩／後端部分仍適用：** 記錄 migration 先行、worker/server/client 協調發布、舊頁刷新與回退演練；未結清非終態不得直接換回舊 server，非空表 down 拒絕。
- [ ] 本票完成需驗收且整合至功能分支；不自行操作 UAT、寄真信、建立遠端 PR 或執行部署。

## 實作與驗證紀錄

`impl/022-08` 已完成測試遷移與本機80次效能矩陣，完整回歸及真實5001秒長測進行中。實際證據與限制見 [validation.md](../../../specs/022-background-signature-initiation/validation.md)。維持 claimed，待長測／整合review全部完成才由整合者結案。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
