# 01: 歷史重新下載不新增紀錄

**What to build:** 歷史重新下載不新增紀錄，完整交付 Spec019 對應故事的使用者行為，含必要後端、前端及驗證。

**Blocked by:** 無

**Status:** resolved

**Spec:** Spec019；US1 T005–T009。

- [x] Excel/PDF重下載不新增或改寫紀錄；新匯出仍記錄
- [x] 重複並發/失敗/未授權保留正確檔案與錯誤行為
- [x] 完成適用的測試與 lint/build，記錄實際結果及限制。
- [x] 保留既有權限與稽核，不新增未核准表、env、排程。
- [x] 通過審查並合併至功能整合分支，追加commit紀錄。

## 實作與驗證紀錄

功能7eb7024已合併1daf04d；真實歷史e2e75項通過，待最終review。

### 2026-11-02 驗收及整合

功能 commit `7eb7024`，合併 `1daf04d` 至 `impl/019-uat-refinements`。歷史下載真實e2e75項；整合history87項；Playwright Excel/PDF各3次取得檔案且無額外create-history呼叫。 兩軸code review完成，唯一P2已於34b35ce修正且複審確認。完整建置與lint通過；整合unit998項。未部署或操作UAT。
