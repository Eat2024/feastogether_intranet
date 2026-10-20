# 01: 完整保存草稿名單與設定

**What to build:** 內外部名單、起迄時間與選項可完整暫存與回填，不發起或寄信。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [ ] 混合與純外部名單可保存，日期未傳保留、null清空、單端可存。
- [ ] 非法日期或名單整筆不變；非建立人及發起後不可修改。
- [ ] 正式畫面回填與發起使用保存選項，舊草稿API相容。
- [ ] 完成US1測試與受影響package驗證。

**Spec:** 009 — 對應任務 T001–T009。以已確認規格、計畫及契約為準。

## 實作紀錄

已交付草稿 PATCH、舊 API 相容、單端日期 migration 與正式設定頁回填；server 815 unit、15 HTTP e2e、6 schema tests 與 root build/lint 通過。詳見 `specs/009-esign-document-delivery/implementation-notes.md`。瀏覽器互動及併發發起競態留整合驗收，尚未宣稱通過。狀態保留 claimed，待 merger 整合後結案。
