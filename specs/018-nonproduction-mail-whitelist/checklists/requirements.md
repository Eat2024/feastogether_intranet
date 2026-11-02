# Specification Quality Checklist: 非 production 寄信白名單

**Purpose**: 驗證需求完整性；勾選代表文件已檢查，不代表實作完成。

**Created**: 2026-11-02

**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] 以避免誤寄與維運增刪需求為主，技術盤點另放 impact-analysis.md。
- [x] 使用者情境、功能需求、實體、成功條件、假設與邊界章節完成。
- [x] 描述已確認的三部門及額外員編，不把整個本部當成已獲授權。
- [x] 需求能供非技術人員確認，沒有混入實作程式碼。

## Requirement Completeness

- [x] 無 NEEDS CLARIFICATION，白名單範圍已由使用者確認。
- [x] 環境、收件人判定、資料更新與失敗規則明確且可測試。
- [x] 成功條件可量測，不依特定技術實作。
- [x] 正向／負向、群發、OTP、來源故障、前導零、撤銷與並發邊界已列出。
- [x] 不寄送、檢查失敗、SMTP unknown 與成功分開，未寄出不能誤標已送達。
- [x] 資料來源、環境正確性、可接受生效邊界與維護方式已說明。
- [x] 本次範圍為規格；未操作 DB、未寄郵件，不修改 Spec 017 權限。

## Feature Readiness

- [x] US1 非正式環境限制、US2 維護規則、US3 群發結果、US4 OTP 各有獨立驗收。
- [x] FR-001～FR-014 可對應情境與 SC-001～SC-007。
- [x] 簡化需求已同步至 spec／plan／research／contracts／quickstart／impact-analysis；七欄資料模型不變，程式與測試已同步，驗證結果見 quickstart.md。
- [x] 明確取消逐人資格／目前部門覆核，保留可信信箱及有效規則判定，列出零逐人查詢的可測驗收。
- [x] 原版本測試與結案紀錄標示為歷史，不當作本修訂已驗收。

## Notes

- spec-template 由 preset resolution 確認採用 .specify/templates/spec-template.md。
- 已依既有 constitution 檢查：本次新增白名單表為使用者明確要求，不新增其他資料表、env、fallback、排程或泛用框架。
- .specify/extensions.yml 不存在，無 before_specify／after_specify hooks 要執行。
- 未執行程式測試，因這輪沒有功能變更；後續測試範圍已列於影響盤點。

- Phase 1 後重新檢查 constitution：通過；本輪僅文件，不執行 DB 或寄信。
