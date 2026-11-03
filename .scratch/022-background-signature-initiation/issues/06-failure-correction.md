# 06: 失敗名單恢復與安全人工重試

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人重登入後仍能找回失敗名單、查看問題並修正；暫時故障可重試原輸入，回應遺失不產生第二個子工作。

**Blocked by:** [05 中斷後有限恢復且不重複發起](05-bounded-recovery.md)

**Status:** ready-for-agent

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US3；FR-005、006、008、011、018；SC-004、005、007、009。

**Tasks:** [T025–T028](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [ ] input 按需回原名單／欄位／期間／選項，不含內部檔案版本或 token；issues 只在 failed 可讀、offset 非負、limit 1–100 預設 100，外部項目只用 index。
- [ ] 只有建立人能讀取或重試，非 failed issues 回 409，已清理明細回 410；來源樹消失員工仍顯示原員編供修正，不悄悄丟掉。
- [ ] retry 新 key／新 job／parent 關聯，僅新受理檢查 latest failed、retryable、輸入保留、版本、有效建立人及期限；修改輸入用新的 initiation。
- [ ] 同 key retry 先找既存 child；即使 parent 不再 latest 或 child 已 succeeded，重播仍 200 原 child，不再正式發起。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端分辨修正與重試，回應未知保留 key；重整後完整還原、分頁問題、越權、版本競態與 retry 回應遺失驗收通過。

## 實作與驗證紀錄

尚未開始。

## 本輪後端補充驗收

- [ ] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [ ] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
