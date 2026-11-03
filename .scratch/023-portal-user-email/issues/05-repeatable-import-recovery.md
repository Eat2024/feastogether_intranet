# 05: 主檔重跑與受控回復

**What to build:** 主檔重跑與受控回復，依下列驗收及 Spec 023 完成。

**Status:** resolved

**Blocked by:** [02-controlled-import](02-controlled-import.md)、[03-local-resolution-initiation](03-local-resolution-initiation.md)、[04-local-mail-policy](04-local-mail-policy.md)

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T019–T022；US4；FR-005–006、013–015。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [x] 同來源新預覽重跑無變更且updated_at不變；預覽後修改或新增同員編拒絕。
- [x] rollback-preview核對原值、新值與所有引用；新帳號有session／audit／FK使用或無法證明安全則拒絕，不刪已使用帳號。
- [x] 登入save保留email；歷史文件／信箱／通知／證據不變；DB提交與artifact寫入間失敗提示人工對帳。
- [x] 維護runbook可依現有DB設定執行，不新增排程／env／表，不將來源缺席當離職。
- [x] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。

### 實作與驗證（2026-11-03）

- 前置 02／03／04 已整合於同一分支；完成 T019–T022。
- 同來源新預覽 no-op、登入／新員編競態、原值微秒還原、FK／session／audit 引用保護、commit 後 artifact 失敗均涵蓋。
- Review 發現非 FK 引用可在刪除提交後寫入，已改為只要偵測到此類欄位就拒絕新增帳號自動刪除（即使空表）；純既有帳號可回復。
- 解析單元 16 項、匯入 e2e 8 項、回復 e2e 7 項通過；登入 save 與歷史固定信箱由 auth 單元與發起 e2e 驗證。
- Runbook：server/docs/portal-user-import.md；來源取得時間必須由維運顯式提供。
- 整合 commit：`32f72a7`；未操作 UAT 或真實員工資料。
