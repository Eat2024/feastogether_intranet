# 08: 簽署歷程中文化

**What to build:** 簽署歷程中文化，完整交付 Spec019 對應故事的使用者行為，含必要後端、前端及驗證。

**Blocked by:** 無

**Status:** resolved

**Spec:** Spec019；US6 T036–T040。

- [x] 27種後端label與未知中文，前端直接顯示
- [x] 補簽actor一致、裁切不擴張，audit/hash不變
- [x] 完成適用的測試與 lint/build，記錄實際結果及限制。
- [x] 保留既有權限與稽核，不新增未核准表、env、排程。
- [x] 通過審查並合併至功能整合分支，追加commit紀錄。

## 實作與驗證紀錄

尚未開始。

### 2026-11-02 驗收及整合

功能 commit `5cb9a86`，合併 `100be2c` 至 `impl/019-uat-refinements`。mapper41項含27種label、history HTTP5項；Playwright中文/補簽/未知事件通過。 兩軸code review完成，唯一P2已於34b35ce修正且複審確認。完整建置與lint通過；整合unit998項。未部署或操作UAT。
