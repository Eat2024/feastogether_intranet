# 06: 批次催簽與通知歷史

**What to build:** 多選或通知全部外部待簽者，管理人可追查每次批次及逐人結果。

**Blocked by:** 05: 單位外部簽署人的催簽

**Status:** claimed

- [x] all_pending涵蓋完整跨頁名單，selected去重且不接受任意收件地址。
- [x] 跨文件整批拒；同文件不合格保留skip原因，無合格者不建空批次。
- [x] 同日限額不能以不同批次繞過，內部不寄且不計成功。
- [x] 正式畫面顯示通知歷史、初邀與提醒區分、逐人狀態及eligibility。
- [x] 完成多人、並發、分頁及資料裁切測試。

**Spec:** 009 — 對應任務 T036–T044（批次）、T047–T049通知部分。以已確認規格、計畫及契約為準。


## 實作與驗證（待 merger 整合）

- 批次／明細游標分頁、kind篩選初邀與催簽、操作者與全批狀態、資料裁切及管理通知摘要完成。
- 多選／跨頁全部外部正式UI、當日與處理中資格、逐人結果及安全嘗試歷史完成；不新增內部催簽。
- 修正待重試另建批次風險及MySQL鎖等待舊snapshot覆蓋document，真DB/worker驗證。
- 13項 reminder e2e 通過；真Chrome選2人→全部其餘21人→worker投遞→每日限制→初邀與20+3明細分頁→reload通過。細節見 implementation-notes.md。
- 整合前完整unit/build/lint結果及commit於下一筆補錄。

### 整合基線後驗證

- 實作 commit `6931143`，已將 integration `606d95e` 合併至本分支（merge `f75ff82`）；保留 ZIP 相關 query keys、UI、tasks 與驗證紀錄。
- 整合後 `pnpm -C server test --runInBand`：99 suites／838 tests 全通過。
- 整合後 `pnpm build`（server＋client正常Turbopack）與 `pnpm lint` 通過；server 194 warnings／0 errors，client 0 warnings／0 errors。
- HTTP/worker 13項及真Chrome證據在 `/tmp/esign009-06-e2e.log`、`/tmp/esign009-06-browser.log`；整合後unit/build/lint在 `/tmp/esign009-06-final-{unit,build,lint}.log`。本票不修改migration，既有schema驗證沿用05／07，最終全量驗證由10整合。
- 工作目錄乾淨；臨時瀏覽器fixture與Next生成的AGENTS區塊已移除。狀態保留 claimed，待 merger 合併整合分支後結案。
