# 04: 本機寄信白名單

**What to build:** 本機寄信白名單，依下列驗收及 Spec 023 完成。

**Status:** resolved

**Blocked by:** [01-local-user-foundation](01-local-user-foundation.md)

**Source:** [Spec](../../../specs/023-portal-user-email/spec.md)、[Plan](../../../specs/023-portal-user-email/plan.md)、[Tasks](../../../specs/023-portal-user-email/tasks.md)。

**Scope:** T015–T018；US3；FR-010–013。精確檔案與測試入口見 tasks 對應ID。

## Acceptance Criteria

- [x] 員編及精確直接部門規則讀有效users.email；不放行子部門或大小寫相似員編、不查HR。
- [x] 完整email規則、共享信箱集合、production bypass及固定收件目標維持；規則或users故障整次check-failed。
- [x] 初邀／催簽／補簽／OTP與無匹配、缺信箱、停用回歸通過；MailModule去除無用HR依賴但不移除部門樹依賴。
- [x] 相關驗證通過，附實際結果及未驗證限制；整合至單一功能分支後追加commit紀錄，才可改為resolved。

## Comments & Implementation Results

2026-11-03：僅建立ticket，尚未實作；ready-for-agent 不表示可忽略 Blocked by，前置皆resolved才可開始。後續結果追加於此。

### 依賴調整（使用者授權平行實作）

主檔已匯入且可用合成fixture獨立驗收，此ticket僅依賴01的repository基礎；與02工具獨立，整合仍由06驗證。檔案所有權分開，無共同寫入。

2026-11-03：已完成 T015–T018。員工／直接部門白名單改用有效本機 users email；保留完整 Email 規則、每次讀取及 production bypass。policy 單元 11 項、相關 mail e2e 32 項通過，涵蓋初邀／催簽／補簽／OTP、故障不放行、固定收件人。等待整合 commit 紀錄後結案。

整合 commit：`32f72a7`（`feat/023-portal-user-email`）。實作已整合；commit hook 的 root lint 與 server 單元測試通過。
