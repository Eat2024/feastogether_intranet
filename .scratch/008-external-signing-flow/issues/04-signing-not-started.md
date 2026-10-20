# 04: 簽署尚未開始時顯示開始時間

**What to build:** 建立人把簽署開始日設在未來時，邀請信會先寄出。簽署人在開始時間前按下「開啟電子簽署文件」，看到「簽署尚未開始，請於（開始時間，台北時間）後簽署」，而不是失效頁；開始後用同一連結即可正常簽署。

**Blocked by:** 03: 邀請確認頁與失效頁依設計稿改版

**Status:** resolved

- [x] 只有在邀請憑證有效、簽署人待簽署、文件簽署中且尚未到開始時間時，才顯示「簽署尚未開始」頁（設計稿 ① 尚未開始），以台北時間顯示開始時間。
- [x] 尚未開始時不設存取 cookie、不記錄開啟、不顯示任何文件內容。
- [x] 無效、竄改或其他期間外的情況仍顯示通用失效頁，不揭露開始時間。
- [x] 新增的「尚未開始」錯誤有穩定錯誤碼與繁體中文訊息，其他外部 API 遇到相同情況回相同錯誤。
- [x] 單元測試涵蓋開始前、開始當下、期間內與期間外；e2e 以未來開始日驗證 409 頁面、開始時間、沒有 Set-Cookie、沒有開啟稽核，並在開始後可正常建立存取。

## 交付界線

與 05 都會調整外部存取的授權判斷，兩票同時進行時須留意同一處程式的衝突。

## 實作紀錄（2026-10-20）

- 分支 `008/04-signing-not-started`，commit `c13ba6f`；合併至整合分支 `6d3da01`。
- `ESIGN_SIGNING_NOT_STARTED(startAt)`（409、`ESIGN_STATE_CONFLICT`、台北時間訊息），以 `AppException` details 帶 `{ startAt }`；`AppErrors` 型別約束放寬為 `(...args: never[])`。
- 存取政策新增私有 `assertSigningStarted`，只在憑證有效且待簽者時判斷；controller `createSession` 改用 `sessionErrorPage(error)` 分流尚未開始頁（409、不設 cookie）、失效頁與服務暫停頁。
- 新增 `signingNotStartedPage(startAt)`；contracts/http-api.md 記錄 `details.startAt`。
- 驗證：server lint:check 0 error、test 90 suites／738 tests、build、e2e 11 suites／73 tests（含 scale）、security 25/25；整合後 lint、test、build 通過。
- 待確認（列入 09）：尚未開始頁目視檢查；其他外部 API 的 409 也會回傳 `details.startAt`（僅有效邀請持有人可見）。

