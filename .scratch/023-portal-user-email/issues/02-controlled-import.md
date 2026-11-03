# 02: 受控主檔匯入

**What to build:** 受控主檔匯入，依下列驗收及 Spec 023 完成。

**Status:** ready-for-agent

**Blocked by:** [01-local-user-foundation](01-local-user-foundation.md)

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T004–T007；US1；FR-002–005。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [ ] HEX TSV與七欄格式驗證完整；0／1資格、空email清除、同信箱不合併、排除名單有理由且不寫死。
- [ ] 預覽不寫DB；私有原值artifact成功保存後才可apply；原值或來源hash衝突整批停止。
- [ ] 5001人分類與寫入一致；停用／刪除受保護，不改ID／外鍵／登入資料；中途錯誤無部分提交。
- [ ] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。
