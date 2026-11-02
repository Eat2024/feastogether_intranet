# 03: 既有ZIP資料轉換工具

**What to build:** 既有ZIP資料轉換工具，完整交付 Spec019 對應故事的使用者行為，含必要後端、前端及驗證。

**Blocked by:** 02

**Status:** resolved

**Spec:** Spec019；US2 T017–T019。

- [x] 預設dry-run，顯式apply需受控清單，串流核對大小/hash，冪等且保留前值
- [x] 缺檔不恢復、不輸出個資；隔離環境測試，不操作UAT
- [x] 完成適用的測試與 lint/build，記錄實際結果及限制。
- [x] 保留既有權限與稽核，不新增未核准表、env、排程。
- [x] 通過審查並合併至功能整合分支，追加commit紀錄。

## 實作與驗證紀錄

尚未開始。

### 2026-11-02 驗收及整合

功能 commit `c2d1d3e`，合併 `1940095` 至 `impl/019-uat-refinements`。retention7項；review修正34b35ce合併df82360後retention8項。CLI隔離DB dry-run/apply實跑。 兩軸code review完成，唯一P2已於34b35ce修正且複審確認。完整建置與lint通過；整合unit998項。未部署或操作UAT。
