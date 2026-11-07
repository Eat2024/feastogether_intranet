# 07: 管理者執行文件生命週期並保留真實操作者

**What to build:** 管理員／Super 對合法文件完成發起、重試、停止、補簽與提醒，背景工作沿真實受理操作者執行，不冒寫原建立者。

**Blocked by:** [028-06](06-cross-department-documents.md)

**Status:** claimed

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T043、T044、T045、T046、T047。

## Acceptance Criteria

- [x] 發起 job 和通知保存真 actor，employee 有 user、super／system 無 user，歷史可證明值正確回填且 schema CHECK 拒非法組合。
- [x] worker 取持久化 job actor，不拿 document creator 冒充操作者；同 job retry 不改原 actor，新 job 才記新提交者。
- [x] 所有流程驗 manage 與原建立人或 manage-all，狀態／期限／工作鎖／通知節流與證據規則不被 Super 繞過。
- [x] poll、issues、input、retry 重新核對當前能力；已受理工作可完成，但撤權後的後續存取不可沿舊權限。
- [x] 端到端跑 HTTP 到 worker 到可查結果，輸出真實 actor 且無個資／簽名／邀請洩漏，原 creator／department 不變。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。

- 2026-11-07：T043–T047 完成實作。HTTP lifecycle 全數以 CurrentActor/manage + 原建立人或 manage-all 重新授權；job 持久 actor，worker 沿既有 lease/deadline/version 執行，不因角色撤權取消已受理工作；重試與重播保留原 actor、新 job 記新提交者。通知／最後管理 metadata 保存真 actor，原建立者／部門不變。
- 新 migration `1793923202000` 回填歷史 employee/system，MySQL CHECK 拒非法組合，Super 或授權稽核資料阻止回退；schema.sql 由新隔離庫實際 migration 後 dump。既有 schema regression 改以 revertAfter 固定版本，不依新增 migration 的數量。
- TDD 第一條 HTTP Super 發起 403 紅燈後轉綠；目前三項新 lifecycle e2e 含正式 WorkerModule/Bull、提醒冪等／節流、補簽／停止狀態、撤權403與範圍404、三次暫時故障及人工新 actor retry。MySQL schema 增加歷史回填／CHECK／down-reapply／防破壞回退。
- 延伸回歸找出既有草稿刪除使用 save 會使2099版本倒退；改用既有 softDeleteDraft 的單次 SQL，版本與actor metadata一併保存。舊 initiation fixture 明確授 document_creator；停用員工錯誤跟隨目前授權契約 ACCOUNT_DISABLED。
- 驗證：unit128 suites/1309 tests、schema9 suites/48 tests、root build、root lint（0 errors）與client check:bundle通過。完整security32 suites/212 tests全綠（135.3秒）；既有initiation locks/recovery/retry/integrity合計48項分輪全通。client test4項、最終draft unit通過。票維持claimed，由merger驗收後結案。
