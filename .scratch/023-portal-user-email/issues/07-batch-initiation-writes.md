# 07: 發起簽署批次寫入與 SQL 容量回歸

**Status:** resolved

**Blocked by:** [06-verification-handoff](06-verification-handoff.md)

**Source:** 使用者在 Spec023 完成後明確授權優化已量測的三處寫入，並比較 SQL 數量。延續既有發起交易與資料完整性契約；不實作背景發起。

## Acceptance Criteria

- [x] 發起前完整準備固定 email／外部邀請資訊，簽署人僅新增一輪；不改一般草稿保存或其他既有更新 caller。
- [x] 簽署人與通知以分批 INSERT＋唯一鍵回查對應 ID，保留預設值、subscribers、actor、缺信箱 skipped 與固定世代，不假設自增 ID 連續。
- [x] 稽核同文件鎖一次、current-read 取得尾端，依序計算完整 hash 鏈後分批寫入；既有 append 不變，失敗全交易回滾。
- [x] 真實 DB 測試覆蓋跨批、非連續 ID、鏈接續、並行舊快照與失敗回滾；5,001 人 HTTP SQL 小於500條。
- [x] 與既有50,073條SQL基準比較，記錄三輪時間／SQL；server lint/unit/build/e2e/security通過並記錄實際限制。

## Implementation Results

2026-11-03：開始實作。簽署人首次寫入、通知與稽核的批次 repository 分工平行完成，由主控整合單一交易；全部使用合成測試資料。

### 驗收完成

- 整合 commit：`b5b0aee`（feat/023-portal-user-email）。
- 5,001 人三輪 HTTP SQL 均由50,073降為135（減少99.7304%）；時間1.179／1.195／1.197秒，中位1.195秒（原15.088秒）。
- SQL細項：signer20,025→42、notification10,002→42、audit20,008→13；其他38不變。
- 單元113 suites／1172 tests、server lint/build、security14 suites／84 tests通過。完整e2e首輪38套通過，唯一失敗為舊故障注入spy指向saveLogs；更新到insertLogs後該套25項全部通過，最終涵蓋39套404項。
- 真DB回歸證明非連續ID正確對應、actor/subscriber保留、hash鏈跨批接續、RR current-read，以及audit部分寫入後整筆HTTP交易回滾。
- 唯讀整合review無新增實質問題；報告見 specs/023-portal-user-email/batch-write-performance.md。
- 不新增migration/env，不更動client或worker寄送流程；未部署、未寄真實郵件、未發布遠端PR。
