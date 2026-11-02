# 06: 建立交易保存部門快照

**What to build:** 新文件固定保存建立當下部門；缺代碼拒絕建立並清除上傳，後續流程與調職不改歸屬。

**Blocked by:** [03](./03-trusted-department-policy.md)、[04](./04-department-read-api.md)

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；US2；FR-003/004；SC-002。

**Tasks:** T022、T023、T024、T025、T026；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [x] T022／T023 先紅後綠，建立 E2E 已加入收集；schema 允許舊資料 NULL，但每筆建立成功文件代碼非空，名稱缺漏不替換代碼。
- [x] 交易讀可信有效 User 並保存兩欄快照，拒絕 caller 部門欄位；需鎖時先 User 再新 Document，失敗不留下文件或孤立檔案。
- [x] 草稿修改、發起、補簽、停止與完成不改快照、原建立人或簽署證據；調職 A→B 後新建屬 B、舊文件仍屬 A。
- [x] 以合成資料驗證新舊快照；跨故事列表與原建立人管理驗收需 ticket 04 完成後執行並寫入 validation.md，完成前本票不得 resolved。

## 原始任務範圍

- [x] T022 [P] [US2] 在 `server/src/features/esign/services/esign-draft.service.spec.ts` 先補非空代碼、名稱缺值、建立交易失敗清檔、拒絕前端覆寫、調職後新舊快照及文件流程不覆寫的 service 測試；精確驗證「schema 允許舊資料 NULL，新建成功必須非空」。
- [x] T023 [P] [US2] 建立 `server/test/esign-department-creation.e2e-spec.ts` 的 multipart 建立、缺代碼 409、未知部門 body 欄位拒絕、回應不洩漏部門來源及證據不變案例；於 `server/test/jest-e2e.json` 登記收集規則。
- [x] T024 [US2] 在 `server/src/features/esign/services/esign-draft.service.ts` 的建立交易取得可信有效 User 部門並保存兩欄快照；需要鎖時沿 `server/src/features/users/repositories/user.repository.ts` 模式，先 User 再新 Document、避免相反鎖順序；缺代碼拒絕並沿既有檔案清理，不新增 caller 可填部門或 IT default。
- [x] T025 [US2] 審核 `server/src/features/esign/services/esign-draft.service.ts`、`esign-initiation.service.ts`、`esign-reopening.service.ts`、`esign-stoppage.service.ts` 的更新欄位，確認沒有覆寫建立部門；補 T022 必要斷言，保留原建立人與 signing payload／signature／manifest／PDF。
- [x] T026 [US2] 執行 T022／T023，並以 A→B 部門同步驗證原部門同事可讀舊文件、新部門無關者不可讀，原發起人個人管理仍可用；在 `specs/017-department-document-visibility/validation.md` 留存結果而不記錄個資／secret。

## 實作驗證紀錄

2026-11-02：T022–T026 完成，等待 root 提交整合後改 resolved。

- 建立交易先 `requireDepartment(creatorUserId, manager, true)` 鎖定有效員工，再保存 code/name 快照及文件；缺部門、失效帳號與交易失敗沿原 catch 清除上傳。名稱缺漏保存 NULL，不提供 IT default 或 caller 可寫欄位。
- 新增 creation E2E 並登記收集。HTTP 回應僅 id；覆蓋 NULL、空字串、空白 409，無文件或 audit 且實際檔案清除，四種偽造 multipart 部門欄位拒絕，名稱缺值，調職及改名，新舊快照，舊 session 使用 DB 新值，原部門可讀、新部門無關者不可讀，發起人仍可改舊草稿及來源 PDF hash 不變。
- 單元覆蓋可信快照、鎖順序、失效帳號拒絕、名稱 NULL、調職與更新不重讀部門、保存失敗清檔。發起、補簽、停止測試補快照保留斷言；真實完成 PDF worker 補部門、原建立人及 signing payload/hash 不變斷言。
- 8 套直接建立 User 的既有 E2E fixture 明列每人不同合成部門，保留跨人負向案例，未加通用 fallback。
- TDD 紅燈：draft unit 5 failed／17 passed；creation E2E 6 failed／4 passed，失敗源為缺少部門檢查及快照。未知欄位 4 案原本已通過，未新增重複 runtime。
- 綠燈：draft/initiation/stoppage/reopening 單元 4 suites／50 tests；creation E2E 10 tests；8 套舊 E2E 78 tests；完成 worker 加 creation 回歸 2 suites／16 tests。
- 全 server 單元 109 suites／1,047 tests、server build 通過。server lint:check 0 errors；新測試 unsafe warnings 已清除，最後修改檔案 ESLint 0 errors／31 個既有 mock warnings。最後 draft 單元 22 tests 再通過，git diff --check 通過。
- DB／Redis 沿 ticket 01：127.0.0.1:13317／16317、feastogether_intranet_test017；未操作 UAT 或真實 HR。前端、匯出、正式登入整合由後續票驗收。

整合commit：`git log --grep="feat(spec017): persist immutable creation department"`。
