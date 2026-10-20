# 01: 完整保存草稿名單與設定

**What to build:** 內外部名單、起迄時間與選項可完整暫存與回填，不發起或寄信。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [x] 混合與純外部名單可保存，日期未傳保留、null清空、單端可存。
- [x] 非法日期或名單整筆不變；非建立人及發起後不可修改。
- [x] 正式畫面回填與發起使用保存選項，舊草稿API相容。
- [x] 完成US1測試與受影響package驗證。

**Spec:** 009 — 對應任務 T001–T009。以已確認規格、計畫及契約為準。

## 實作紀錄

已交付草稿 PATCH、舊 API 相容、單端日期 migration 與正式設定頁回填；server 815 unit、15 HTTP e2e、6 schema tests 與 root build/lint 通過。詳見 `specs/009-esign-document-delivery/implementation-notes.md`。瀏覽器互動及併發發起競態留整合驗收，尚未宣稱通過。狀態保留 claimed，待 merger 整合後結案。

## 整合紀錄

- 實作 commit：`a03f6515dba2394ff37ae4f27009a58dd9c306dc`。
- 已以 `--no-ff` 合併至 `feature/009-esign-document-delivery`，merge commit：`cba98096f78f4ed18ac6ecaf3e4b411604070659`，無衝突。
- 整合分支重跑 `esign-signer.service.spec.ts` 與 `mysql.options.spec.ts`，2 suites／23 tests 通過；`git diff --check` 通過。本輪未重跑共用 DB 測試，避免干擾其他 ticket 驗證。
- 狀態維持 `claimed`；待 ticket 10 補齊正式瀏覽器互動及儲存／發起併發驗收後才可標示 `resolved`。

## 補齊驗收

第二輪基於 `489a0bd` 補上實際保存／發起併發 e2e，以及真實 Chrome 的混合名單、清空單端日期、選項保存後新 browser context 回填驗收；永久 e2e 16/16，臨時含 Chrome suite 17/17 通過。T004／T009 已完成，先前留待 Ticket 10 的兩項限制已解除。狀態仍交 merger 在補充 commit 整合後更新。
