# 01: 基線盤點與隔離驗證環境

**What to build:** 建立可追溯的需求驗收矩陣與安全可用的測試環境。

**Blocked by:** 無（先確認整合分支包含來源規格）

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；FR-001～FR-012、SC-001～SC-005。

**Tasks:** T001、T002；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [x] 確認整合分支已包含 PR 37 規格；讀取三份 AGENTS.md 與 Spec 017 全部設計文件，記錄原始 diff 與 role=all 殘留檢查。
- [x] validation.md 建立 FR／SC／驗收案例對照，明列尚未驗證項目，不把規劃寫成實作完成。
- [x] 確認 MySQL／Redis 與 feastogether_intranet_test 前綴保護；定位先前 MySQL 驗證失敗，環境阻礙未排除時不得標為可執行或通過。

## 原始任務範圍

- [x] T001 讀取 root／client／server 的 AGENTS.md 與 Spec 017 全部設計文件，核對當前工作區仍無 role=all 試作殘留，記錄原始 diff、FR-001～FR-012 與各驗收案例對應於 `specs/017-department-document-visibility/validation.md`，不改既有使用者變更。
- [x] T002 依 `server/.env.example`、`server/test/global-setup.ts`、`server/test/setup-e2e.ts` 確認 MySQL／Redis 測試環境及 feastogether_intranet_test 前綴保護，解決或明確記錄前次 MySQL 驗證失敗於 `specs/017-department-document-visibility/validation.md`；不提交本機 env、不使用 UAT DB 跑測試。

## 實作驗證紀錄

2026-11-02：T001／T002 完成，證據見 specs/017-department-document-visibility/validation.md。本票與基線紀錄直接提交功能整合分支；commit 可由 `git log --grep="spec017.*baseline"` 查得。
