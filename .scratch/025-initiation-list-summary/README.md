# Spec 025 本機 Tickets

使用者已確認 4 張拆分，正式 tickets 已建立；ticket 01 已實作並整合，其餘依下列狀態推進，未建立 GitHub Issues。

- [Spec](../../specs/025-initiation-list-summary/spec.md)
- [Plan](../../specs/025-initiation-list-summary/plan.md)
- [Tasks](../../specs/025-initiation-list-summary/tasks.md)

| Ticket | Tasks | Blocked by | Status |
| --- | --- | --- | --- |
| [01：受理後立即顯示確認日期與預計人數](issues/01-accepted-list-summary.md) | T001–T008 | 無 | resolved |
| [02：重新進入與原有讀者取得一致摘要](issues/02-summary-access-consistency.md) | T009–T011 | 01 | ready-for-agent |
| [03：背景終態與快取競態正確切換](issues/03-terminal-state-consistency.md) | T012–T014 | 01 | ready-for-agent |
| [04：大名單效能與完整交付驗收](issues/04-scale-delivery-validation.md) | T015–T018 | 01、02、03 | ready-for-agent |

依賴順序：01 → {02, 03} → 04。01 已整合，02／03 可開始；02／03 共用測試檔需協調修改順序。
初始 ready-for-agent 不表示可略過前置；前置全數 resolved 才能 claimed。
評論與驗證結果追加至各 ticket，保留原驗收條件；整合後附 commit 紀錄再改 resolved。
