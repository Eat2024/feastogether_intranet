# Spec 022 本機 tickets

**最新範圍**：只實作後端 worker，排隊／執行中禁止修改文件及簽署人，前端相關驗收暫緩。詳見 [範圍決策](../../specs/022-background-signature-initiation/backend-only-scope.md)。

已依 tasks 拆成 8 張本機票單。01–04 已驗收並整合，狀態 `resolved`；05 正在獨立 worktree 實作，06–08 尚未開始。06 的 04 前置已完成，仍須等待 05 resolved；目前 frontier 為 05。整合分支為 `impl/022-integration`。

[規格](../../specs/022-background-signature-initiation/spec.md) · [計畫](../../specs/022-background-signature-initiation/plan.md) · [Tasks](../../specs/022-background-signature-initiation/tasks.md)

| Ticket | Tasks | Blocked by |
| --- | --- | --- |
| [01 保留行為的正式發起核心重構](issues/01-transaction-core.md) | T001–T003 | 無 |
| [02 單人背景發起完整流程](issues/02-background-initiation.md) | T004–T011 | 01 |
| [03 完整大量與混合名單背景發起](issues/03-complete-roster.md) | T012–T015 | 02 |
| [04 重整與重新登入後追蹤工作](issues/04-progress-tracking.md) | T016–T020 | 03 |
| [05 中斷後有限恢復且不重複發起](issues/05-bounded-recovery.md) | T021–T024 | 03 |
| [06 失敗名單恢復與安全人工重試](issues/06-failure-correction.md) | T025–T028 | 04、05 |
| [07 工作明細到期清理與可追溯摘要](issues/07-retention.md) | T029–T030 | 06 |
| [08 完整回歸、效能與發布交接](issues/08-integration-handoff.md) | T031–T034 | 07 |

## 範圍與執行方式

01 為必要的無行為改變重構；02 起每張涵蓋可展示／驗收的行為與所需資料、API、UI 或操作證據。02–03 形成 US1 MVP，04 補追蹤，05–07 補恢復／修正／保留，08 完成跨流程驗收。各票為一次專注實作範圍，細節任務保留於 tasks。

03 完成後，04 查詢與 05 恢復可平行，因後端限定範圍下查詢不再是恢復的前置；06 必須等 04 與 05 均 resolved。使用獨立 worktree 及 Redis DB4／DB5，整合共用 service 變更時處理衝突並重驗。其餘票依真實前置執行，票內平行機會見 tasks。中間契約切換的既有測試落差須記錄，08 前不宣稱全套通過或可部署。

本機票單不等於遠端發布；本次未建立 GitHub Issues、PR 或部署。
