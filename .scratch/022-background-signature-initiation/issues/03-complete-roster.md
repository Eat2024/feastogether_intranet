# 03: 完整大量與混合名單背景發起

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人一次提交完整內外部名單，由背景分批查核並整份正式發起，不必拆文件或因缺信箱刪掉簽署人。

**Blocked by:** [02 單人背景發起完整流程](02-background-initiation.md)

**Status:** ready-for-agent

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US1；FR-001、003、007、010、013–015；SC-001、002、005、007。

**Tasks:** [T012–T015](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [ ] 1／100／101／5,001／6,001、混合名單與全外部均走背景；移除 helper 6,000 總數守門，不截斷、不引入同步門檻。
- [ ] 500 人一批本機查核，鎖內重驗員編映射、帳號與建立人資格；缺帳號整份失敗，缺信箱及白名單只影響通知。
- [ ] 250 筆一批寫入但同一正式交易提交；快照順序與全部指派數正確，無部分發起、重複 audit 或初邀批次。
- **原 UI 驗收暫緩／後端部分仍適用：** 正式交易前提交 committing 階段供輪詢，但成功必須等完整 commit；微秒版本及原檔 metadata 鎖內重核。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端送完整名單、既有去重與外部正規化保留，Network 無前置逐批 resolutions；容量與中途失敗回滾驗證通過。

## 實作與驗證紀錄

尚未開始。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
