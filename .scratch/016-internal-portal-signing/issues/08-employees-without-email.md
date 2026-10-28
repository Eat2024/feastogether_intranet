# 08：無 Email 員工仍可被指派與簽署

**What to build:** 文件名單中即使有無 Email 員工仍可發起及補簽；員工經人資另行通知後自行登入即可完成本人文件。

**Blocked by:** 04 員工簽署、07 催簽與補簽。

**Status:** claimed

**Tasks coverage:** T025/T029/T036；T030/T031/T037 的缺信箱、跳過紀錄與容量部分。

- [x] 選人及發起畫面將無信箱視為不可 Email 通知，不阻擋指派；後端保留 nullable Email 且仍驗證真實員工身分。
- [x] 發起、催簽及補簽保留無信箱者指派，通知 skipped／RECIPIENT_UNAVAILABLE，不記 delivered、不入 SMTP，其他有信箱者照常群寄。
- [x] 全無信箱與混合名單均可完成適用操作；無信箱員工自行登入可看到並簽署本人文件。
- [x] 上游查詢故障及身分無效仍失敗，外部無有效 Email 仍不得當作內部例外；不加手填信箱、人資通知功能或資料表。
- [x] 1／100／101／6,000 人合成名單與查詢分批回歸通過，既有已發起快照不改寫。

## 實作與驗證（2026-10-28，待整合）

- 保留已驗證的員工身分與 nullable 固定 Email 快照；無 Email 的初次邀請為 `skipped/RECIPIENT_UNAVAILABLE`，不產生 SMTP 工作。全員無 Email 的催簽仍建立逐人略過紀錄；其他不可催簽限制沿用既有判斷。
- 前端預檢與發起允許無 Email，提示人資另行通知；來源故障仍阻擋。邀請結果保留 processing/skipped/unknown，補簽文案不承諾無 Email 者會收到信，內部寄信歷程顯示中文。
- TDD：無 Email 發起先見原 422、全無 Email 催簽先見原 409，再實作通過。真實 HTTP/MySQL/Redis 測試涵蓋全無 Email 發起、本人開啟及簽署、到期補簽、快照不變與零寄信；101 人混合名單有信箱者群寄、無信箱者略過；來源故障及員工停用回滾。舊 token／密文／世代／在途補簽測試改成明確外部簽署人，保留原安全斷言。
- 1／100／101／6,000 人保序解析、HR 每批 100、最多 4 批並行；真實 6,000 人發起後 worker 產生 120 次各 50 地址的群寄（Fake sender，不對外寄信），6,000 筆 delivered、內部 token 全 null。容量與信箱 API 測試 20/20 通過，約 103 秒；後續加入無效地址與來源故障區別案例。
- 最新相關 E2E：發起／預檢／群寄催簽共 3 suites、47 tests 通過；完整單元測試 106 suites、977 tests 通過。root build、lint 通過（既有 warnings，無 errors）。測試使用隔離 `feastogether_intranet_test_spec016_t08`、Redis DB 10、`/tmp/feastogether-spec016-t08`；未 flush 共用 Redis。
- Chrome 合成 API browser smoke：1280px／390px Portal embedded 呈現下，無 Email 警告可見且仍送出正確 userId 的發起；來源 502 阻擋發起；詳情 skipped／unknown 與內部寄送中文歷程正確，無 runtime exception。截圖 `/tmp/ft016-t08-warning-{1280,390}.png`；未宣稱真實 Portal 登入串接或正式 SMTP 驗收。390px 警告區塊經實際截圖確認可閱讀。
- 無新增 table、migration、環境變數或套件；entity 僅補正既有 nullable Email 的 TypeScript 型別。狀態維持 claimed，由整合者合併後結案。
