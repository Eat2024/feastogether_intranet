# 07: 移除Email預檢功能

**What to build:** 移除Email預檢功能，完整交付 Spec019 對應故事的使用者行為，含必要後端、前端及驗證。

**Blocked by:** 無

**Status:** resolved

**Spec:** Spec019；US5 T031–T035。

- [x] 刪預檢端點及專用DTO/method，保留HR共用解析
- [x] 無信箱保留指派略過信件；來源故障保持草稿；容量覆蓋保留
- [x] 完成適用的測試與 lint/build，記錄實際結果及限制。
- [x] 保留既有權限與稽核，不新增未核准表、env、排程。
- [x] 通過審查並合併至功能整合分支，追加commit紀錄。

## 實作與驗證紀錄

功能2e2573e已合併07b1edc；發起/容量31項及6000人worker通過，待最終review。

### 2026-11-02 驗收及整合

功能 commit `2e2573e`，合併 `07b1edc` 至 `impl/019-uat-refinements`。unit15項，initiation/capacity e2e31項含6000人worker通過。 兩軸code review完成，唯一P2已於34b35ce修正且複審確認。完整建置與lint通過；整合unit998項。未部署或操作UAT。
