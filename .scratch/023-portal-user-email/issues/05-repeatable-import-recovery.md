# 05: 主檔重跑與受控回復

**What to build:** 主檔重跑與受控回復，依下列驗收及 Spec 023 完成。

**Status:** ready-for-agent

**Blocked by:** [02-controlled-import](02-controlled-import.md)、[03-local-resolution-initiation](03-local-resolution-initiation.md)、[04-local-mail-policy](04-local-mail-policy.md)

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T019–T022；US4；FR-005–006、013–015。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [ ] 同來源新預覽重跑無變更且updated_at不變；預覽後修改或新增同員編拒絕。
- [ ] rollback-preview核對原值、新值與所有引用；新帳號有session／audit／FK使用或無法證明安全則拒絕，不刪已使用帳號。
- [ ] 登入save保留email；歷史文件／信箱／通知／證據不變；DB提交與artifact寫入間失敗提示人工對帳。
- [ ] 維護runbook可依現有DB設定執行，不新增排程／env／表，不將來源缺席當離職。
- [ ] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。
