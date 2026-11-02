# 06: 建立交易保存部門快照

**What to build:** 新文件固定保存建立當下部門；缺代碼拒絕建立並清除上傳，後續流程與調職不改歸屬。

**Blocked by:** [03](./03-trusted-department-policy.md)、[04](./04-department-read-api.md)

**Status:** ready-for-agent

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；US2；FR-003/004；SC-002。

**Tasks:** T022、T023、T024、T025、T026；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [ ] T022／T023 先紅後綠，建立 E2E 已加入收集；schema 允許舊資料 NULL，但每筆建立成功文件代碼非空，名稱缺漏不替換代碼。
- [ ] 交易讀可信有效 User 並保存兩欄快照，拒絕 caller 部門欄位；需鎖時先 User 再新 Document，失敗不留下文件或孤立檔案。
- [ ] 草稿修改、發起、補簽、停止與完成不改快照、原建立人或簽署證據；調職 A→B 後新建屬 B、舊文件仍屬 A。
- [ ] 以合成資料驗證新舊快照；跨故事列表與原建立人管理驗收需 ticket 04 完成後執行並寫入 validation.md，完成前本票不得 resolved。

## 原始任務範圍

- [ ] T022 [P] [US2] 在 `server/src/features/esign/services/esign-draft.service.spec.ts` 先補非空代碼、名稱缺值、建立交易失敗清檔、拒絕前端覆寫、調職後新舊快照及文件流程不覆寫的 service 測試；精確驗證「schema 允許舊資料 NULL，新建成功必須非空」。
- [ ] T023 [P] [US2] 建立 `server/test/esign-department-creation.e2e-spec.ts` 的 multipart 建立、缺代碼 409、未知部門 body 欄位拒絕、回應不洩漏部門來源及證據不變案例；於 `server/test/jest-e2e.json` 登記收集規則。
- [ ] T024 [US2] 在 `server/src/features/esign/services/esign-draft.service.ts` 的建立交易取得可信有效 User 部門並保存兩欄快照；需要鎖時沿 `server/src/features/users/repositories/user.repository.ts` 模式，先 User 再新 Document、避免相反鎖順序；缺代碼拒絕並沿既有檔案清理，不新增 caller 可填部門或 IT default。
- [ ] T025 [US2] 審核 `server/src/features/esign/services/esign-draft.service.ts`、`esign-initiation.service.ts`、`esign-reopening.service.ts`、`esign-stoppage.service.ts` 的更新欄位，確認沒有覆寫建立部門；補 T022 必要斷言，保留原建立人與 signing payload／signature／manifest／PDF。
- [ ] T026 [US2] 執行 T022／T023，並以 A→B 部門同步驗證原部門同事可讀舊文件、新部門無關者不可讀，原發起人個人管理仍可用；在 `specs/017-department-document-visibility/validation.md` 留存結果而不記錄個資／secret。
