# 04: 歷史匯出搜尋與分頁

**What to build:** 歷史匯出搜尋與分頁，完整交付 Spec019 對應故事的使用者行為，含必要後端、前端及驗證。

**Blocked by:** 無

**Status:** resolved

**Spec:** Spec019；US3 T020–T024/T026歷史部分。

- [x] 三類欄位OR搜尋（建立人含員編），計數與權限AND一致
- [x] 10筆分頁、特殊字元文字比對、超頁導正、URL保留條件
- [x] 完成適用的測試與 lint/build，記錄實際結果及限制。
- [x] 保留既有權限與稽核，不新增未核准表、env、排程。
- [x] 通過審查並合併至功能整合分支，追加commit紀錄。

## 實作與驗證紀錄

尚未開始。

### 2026-11-02 驗收及整合

功能 commit `037012f`，合併 `afd8667` 至 `impl/019-uat-refinements`。history真實MySQL87項；Playwright搜尋/清空/超頁導正/每頁10筆/重整通過。 兩軸code review完成，唯一P2已於34b35ce修正且複審確認。完整建置與lint通過；整合unit998項。未部署或操作UAT。
