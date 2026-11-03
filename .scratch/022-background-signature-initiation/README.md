# Spec 022 本機 tickets

**最新範圍**：只實作後端 worker，排隊／執行中禁止修改文件及簽署人，前端相關驗收暫緩。詳見 [範圍決策](../../specs/022-background-signature-initiation/backend-only-scope.md)。

8 張 tickets 已驗收並整合至 `impl/022-integration`，01–08 全為 `resolved`，T001–T034 全部完成。正式兩軸 code review 已完成，Standards 與 Spec 均為 0 項未解 finding。各項補修與歷史失敗、重驗證據保留於個別票單及 validation。

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

## 最新基準與預審修正

最新 dev baseline 固定為 `ef0fdca6da66afe8495b589390ddaf647c9dcdbf`。兩軸預審發現的 busy existingJobId 與初始化重複已修正並整合；正式 review 已完成，兩軸均無未解 finding。Portal fixture 遷移與新 base 完整回歸已完成；真實長測已通過但屬舊基準，限制見下方。

## Portal fixture 與快照修正整合

Portal fixture 遷移及公開 mutation 交易外 busy 預檢已整合，消除預檢先建立 RR 舊快照的重複催簽原因。午夜 fixture 與測試平行 direct worker 的診斷／調整已完成，新 base 完整回歸已通過；正式 review 已完成。

## 最終驗收摘要

新 dev 基準完整 e2e 50 suites／531 passed＋一般套件 reconnect skip 1；專用 DB9 reconnect 另 1／1 通過。unit 119／1,213、schema 5／30、security 最終 source 14／84、build／lint 通過。SC-006 實時 5,123.645 秒成功、5,001 指派、attempt=1；睡眠導致 Bull 失鎖後重領終態 no-op 與舊長測基準限制完整保留於 [validation](../../specs/022-background-signature-initiation/validation.md)。未執行 UAT 部署或修改前端。

## 正式審查與收尾

正式審查固定於 `ef0fdca6da66afe8495b589390ddaf647c9dcdbf` → `0a7c0e4471f90167c250ccf0ee5f6067f103b2de`；Standards／Spec 各 0 項未解 finding，原兩項 P3 已修正。[審查報告](../../specs/022-background-signature-initiation/review.md)。未配置 `.specify/extensions.yml`，無 after_implement hook 需執行。實作 worktree 已確認提交均合併後清理，保留 integration worktree 與各分支歷史；本次專用測試容器已停止。
