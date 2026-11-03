# 06: 整合驗證與維運交接

**What to build:** 整合驗證與維運交接，依下列驗收及 Spec 023 完成。

**Status:** resolved

**Blocked by:** [03-local-resolution-initiation](03-local-resolution-initiation.md)、[04-local-mail-policy](04-local-mail-policy.md)、[05-repeatable-import-recovery](05-repeatable-import-recovery.md)

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T023–T026；全體FR；SC-001–007。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [x] 更新被023取代的既有來源描述，保留舊驗證紀錄，不將022背景發起列為完成。
- [x] 依quickstart完成server/client/root驗證並記錄結果，5001人前後各三次分階段量測及HR零呼叫證據。
- [x] 確認更新責任人／時機、受控artifact與清理、server/worker一致部署及應用回滾流程；未部署／未寄信明列。
- [x] 完成code review與整合commit後才改resolved；本ticket不授權部署、真實寄信或遠端PR。
- [x] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。

2026-11-03：前置 03／04／05 已驗收並整合至 `32f72a7`。開始最後完整整合／安全驗證及交接；六輪容量量測已通過，細節見 performance.md。

### 驗收與交接完成（2026-11-03）

- T023–T026 完成，全部 26 項 tasks 已勾選。
- root lint／build、server 單元 112 suites／1168 tests、完整 e2e 36 suites／398 tests、security e2e 14 suites／84 tests 通過。
- 5,001 人 before／after 各三次通過；HR 為 mock，不能推論 UAT 加速倍數。後版發起 HTTP 中位數15.088秒，主要大量資料寫入成本仍在；不宣稱 Spec022 背景發起已完成。
- review 發現並修正來源取得時間誤記與非 FK 引用回復競態；完整整合另修正草稿／發起鎖順序 deadlock。
- 維運以具既有資料維護權限的人員負責人工更新；首次切換前、員工或信箱／部門異動後執行。正式個人責任人與保存期限於部署前由團隊指定，不在本輪假設人選。
- server／worker 同版本部署；應用回滾保留 email 欄位與帳號資料，資料回復另走受控流程。
- 實作整合 commit：`32f72a7`；foundation commit：`e14b26a`。完整驗證、限制、交接詳見 specs/023-portal-user-email/validation.md，操作詳見 server/docs/portal-user-import.md。
- 未部署、未執行真實匯入／寄信、未建立遠端 PR；Spec022 工作檔保留原狀。
