# 06: 組織圖快取30分鐘

**What to build:** 組織圖快取30分鐘，完整交付 Spec019 對應故事的使用者行為，含必要後端、前端及驗證。

**Blocked by:** 無

**Status:** resolved

**Spec:** Spec019；US4 T027–T030。

- [x] 1800秒TTL、v2 namespace、讀取不續期
- [x] 按需更新、環境隔離與既有失敗行為保留
- [x] 完成適用的測試與 lint/build，記錄實際結果及限制。
- [x] 保留既有權限與稽核，不新增未核准表、env、排程。
- [x] 通過審查並合併至功能整合分支，追加commit紀錄。

## 實作與驗證紀錄

已合併 92d6ddb（實作 e4af1c4）。unit 11、org-chart e2e 9 通過；全套 965 tests，lint及server build通過。待最終code review後結案。

### 2026-11-02 驗收及整合

功能 commit `e4af1c4`，合併 `92d6ddb` 至 `impl/019-uat-refinements`。unit11項及org-chart真實Redis/MySQL e2e9項通過。 兩軸code review完成，唯一P2已於34b35ce修正且複審確認。完整建置與lint通過；整合unit998項。未部署或操作UAT。
