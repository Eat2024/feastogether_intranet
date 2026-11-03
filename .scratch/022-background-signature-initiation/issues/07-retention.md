# 07: 工作明細到期清理與可追溯摘要

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人在 30 天內可恢復失敗輸入；明細到期後得到重新設定提示，舊請求仍能查回結果，工作與簽署證據不會被刪掉。

**Blocked by:** [06 失敗名單恢復與安全人工重試](06-failure-correction.md)

**Status:** ready-for-agent

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US3；FR-005、009、016、018；SC-009。

**Tasks:** [T029–T030](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [ ] 沿既有 maintenance 分批清空終態滿 30 天 input/version/issues，保留摘要、key/hash、關聯、計數、分類與時間；不新增排程。
- [ ] 非終態永不按保留期限清理；不得刪工作或既有正式證據。
- [ ] 清理與人工 retry 有一致交易邊界：結果只能成功保存完整子工作輸入，或明確 410；不能受理空輸入。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端過期提示重新設定、summary detailsExpired 正確；原 initiation 與 retry key 即使 parent 明細清理仍回原摘要。
- **原 UI 驗收暫緩／後端部分仍適用：** 30 天邊界、非終態、清理競態及清理後重播測試通過，記錄瀏覽器過期畫面驗收。

## 實作與驗證紀錄

尚未開始。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
