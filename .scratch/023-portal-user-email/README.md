# Spec 023 本機 tickets

所有 tickets 初始 ready-for-agent；必須先滿足 Blocked by。未建立 GitHub Issues、未發布PR。

| Ticket | Tasks | Blocked by |
| --- | --- | --- |
| [01 本機員工查詢基礎](issues/01-local-user-foundation.md) | T001–T003 | 無 |
| [02 受控主檔匯入](issues/02-controlled-import.md) | T004–T007 | 01-local-user-foundation |
| [03 本機解析與發起信箱](issues/03-local-resolution-initiation.md) | T008–T014 | 01-local-user-foundation |
| [04 本機寄信白名單](issues/04-local-mail-policy.md) | T015–T018 | 01-local-user-foundation |
| [05 主檔重跑與受控回復](issues/05-repeatable-import-recovery.md) | T019–T022 | 02-controlled-import, 03-local-resolution-initiation, 04-local-mail-policy |
| [06 整合驗證與維運交接](issues/06-verification-handoff.md) | T023–T026 | 03-local-resolution-initiation, 04-local-mail-policy, 05-repeatable-import-recovery |
