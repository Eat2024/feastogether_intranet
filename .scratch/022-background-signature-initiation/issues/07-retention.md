# 07: 工作明細到期清理與可追溯摘要

> **範圍修訂**：只改後端，依 [最新範圍](../../../specs/022-background-signature-initiation/backend-only-scope.md) 與更新後 tasks 執行。下列原前端 UI／輪詢／畫面還原驗收暫緩，不得修改 client；改為對應 API 驗收及既有 client 相容性 smoke test。key 選填，queued／processing 必須阻擋文件與簽署人異動並回固定 worker 執行中訊息。


**What to build:** 建立人在 30 天內可恢復失敗輸入；明細到期後得到重新設定提示，舊請求仍能查回結果，工作與簽署證據不會被刪掉。

**Blocked by:** [06 失敗名單恢復與安全人工重試](06-failure-correction.md)

**Status:** claimed

**Spec:** [022 規格](../../../specs/022-background-signature-initiation/spec.md) — US3；FR-005、009、016、018；SC-009。

**Tasks:** [T029–T030](../../../specs/022-background-signature-initiation/tasks.md)。精確實作位置與約束見 tasks／plan，不複製整份規格。

**執行約定:** 前置票皆 resolved 才可開始；開始改 claimed。使用 `feat/022-background-signature-initiation` 作整合分支，驗收通過且整合後才改 resolved，追加驗證與 commit 紀錄並保留原驗收條件。測試只用隔離合成資料，不部署、不建立遠端 issues／PR。

## 驗收條件

- [x] 沿既有 maintenance 分批清空終態滿 30 天 input/version/issues，保留摘要、key/hash、關聯、計數、分類與時間；不新增排程。
- [x] 非終態永不按保留期限清理；不得刪工作或既有正式證據。
- [x] 清理與人工 retry 有一致交易邊界：結果只能成功保存完整子工作輸入，或明確 410；不能受理空輸入。
- **原 UI 驗收暫緩／後端部分仍適用：** 前端過期提示重新設定、summary detailsExpired 正確；原 initiation 與 retry key 即使 parent 明細清理仍回原摘要。
- **原 UI 驗收暫緩／後端部分仍適用：** 30 天邊界、非終態、清理競態及清理後重播測試通過，記錄瀏覽器過期畫面驗收。

## 實作與驗證紀錄

2026-11-03，`impl/022-07` 基於 `597d480`，T029–T030 完成，維持 claimed 等待整合。

- 沿現有 EsignMaintenanceProcessor → initiation service maintain，在恢復掃描後每批鎖 100 筆滿 30 天終態；skip_locked 留待下輪，清理不反向取得 document 鎖。
- 清理僅寫 input/version/issues=NULL 與 inputPurgedAt；為保留原業務更新時間，使用窄 UPDATE 顯式 updated_at=updated_at（已確認此明細保留例外），其餘摘要、key/hash、parent、計數與微秒時間不變。
- schema CHECK 原本只要求非終態 input/version 不空，終態可清理，無 migration；未新增 scheduler、env 或修改 client。
- TDD：30 天邊界先紅（JSON 未清），新增 repo 清理與既有 maintain loop 後轉綠。新增 7 個真 MySQL／HTTP 案例涵蓋 30 天±1ms、原 updatedAt 123456 微秒保留、非終態與剛安全失敗工作仍保留、正式文件／指派／通知／快照／audit 不變、initial key 重播、retry 先後順序與四輪並行、parent 清理後 child 成功重播、206 列跨批／持鎖略過與下一輪補清。
- 隔離 MySQL `feastogether_intranet_test022_t07`、Redis DB7、合成檔案；pnpm frozen 安裝。六套 initiation e2e 60／60，unit 113 suites／1,175 tests，server build 通過；lint 0 errors／272 既有 warnings。
- 過期還原 API 回 410 且 detailsExpired=true；重新設定應建立新 initiation。前端畫面與瀏覽器過期提示依 backend-only scope 暫緩，未宣稱已實作 UI。

## 本輪後端補充驗收

- [x] 不修改 client；既有無 key 發起可受理，API 仍正確區分受理與完成。
- [x] 本票涉及異動時，queued／processing 拒絕文件或簽署人修改並回固定 409 worker 執行中訊息；其他權限與終態規則不放寬。
