# 03: 內外部拒簽與文件結案

**What to build:** 本人可拒簽且保留原因與時間，其他人繼續，混合或全拒皆能正確結案。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [x] 依allowReject與本人資格；原因選填trim最多200 code points。
- [x] 拒簽不可逆、不補簽或催簽、不產假PDF；簽拒競態只一終態。
- [x] 同requestId重送不覆寫證據，已拒可讀本人結果。
- [x] 結案僅等待signed的PDF，全拒正確完成；舊manifest仍可驗證。
- [x] 完成US4測試與遷移驗證；ZIP整合留ticket10。

**Spec:** 009 — 對應任務 T029–T035。以已確認規格、計畫及契約為準。

## 實作紀錄

- 本人拒簽 API：內部員工 session、外部 OTP cookie，文件→簽署人鎖序、冪等 requestId、原因 trim/200 code points；結果查詢與來源／副本權限隔離。
- migration `1792454401000` 新增拒簽請求及 CHECK；已有拒簽證據拒絕 down。
- 結案只等待 signed 個人副本；含拒簽的 manifest 使用 v3，純簽署及既有 v2 保持可驗證，不改舊證據。
- 外部頁接拒簽與結果；內部 `/my-signature/tasks` 從「我的電子簽」入口連至本人正式 API 名單／檢視／拒簽。既有 `/my-signature/[id]` mock 簽署流程未遷移，不能描述成正式簽署已全面串接。
- 驗證：拒簽 4 項 HTTP/DB e2e（OTP、重送、全拒、簽拒競態、混合結案公開驗證、拒絕破壞性 down）；server build、client webpack build、client lint 通過。server lint 0 errors、既有及測試 warnings。Turbopack 在 /tmp worktree 的跨根 node_modules symlink 受限，整合工作目錄須補正常 build。
- ZIP 拒簽排除整合由 ticket 10 驗收，本 ticket 不新增 ZIP 功能。

### 最後整合驗證

- 已合併整合分支 `489a0bd`（含 tickets 01、02），實作主 commit `db74367`。
- server 全量 unit：94 suites、826 tests 通過；rejection e2e：4/4；schema migration/constraints：6/6。
- server build、client `build --webpack`、client lint 通過。server lint：0 errors（沿用既有 warnings）。
- T029–T034 已勾選；T035 的拒簽／結案部分完成，但包含 ticket 10 的 ZIP 整合，故整體任務留待整合時勾選。
