# 04: 完成受保護的隱藏登入、身分顯示與登出

**What to build:** 在員工登入上游不可用時，維護者仍可用 REPL 取得的有效隱藏網址完成登入，看到 Super user 身分並登出；非法入口不顯示表單，錯誤登入不影響原身分。

**Status:** ready-for-agent

**Blocked by:** [03-narrow-repl-entry](03-narrow-repl-entry.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T003、T017、T018、T019、T020、T021、T022、T023、T024、T025、T026、T028、T050、T051。

## Acceptance Criteria

- [ ] 入口位置 GET 有效回 200、無效回 404，無 DB 寫入、無 Set-Cookie；提交在 KDF 前檢查位置並在交易 commit 前重驗位置與有效設定。
- [ ] 帳號 1～128 字元、密碼 1～1024 UTF-8 bytes、body 上限 8 KiB、不接受額外欄位；正確登入回 201，錯帳號與錯密碼統一 401，不透露帳號存在性。
- [ ] explicit Origin 與可信 IP 限流實際生效：10 次／60 秒及 50 次／300 秒，依 IP＋固定登入類別計數；429 有 Retry-After，缺可信 IP／Redis／DB 時拒絕而不放行。
- [ ] 成功登入與原會話替換及安全事件原子完成，commit 後才 Set-Cookie；失敗不清原 cookie。session 讀取及登出真正經過共用會話服務，兩類 actor 都能使用。
- [ ] cookie 沿用 HttpOnly、host-only、根路徑及固定八小時；正式環境 SameSite=None＋Secure，本機 Lax；未明確允許的業務路由對 Super user 仍回 403。
- [ ] 隱藏頁在 HTML／RSC 渲染前驗位置；未知／舊／格式錯誤入口均無表單；有效頁 no-store、no-referrer、noindex 且禁止 iframe，此限制不影響一般 WebView。
- [ ] MUI 表單防重送，錯帳密只在表單顯示，不觸發全站 session-expired 對話框；409 重查身分、429 等待人工重試。成功清輸入、replace 到根頁並清舊身分快取。
- [ ] 內部 layout 能辨識 Super user、持續顯示身分並提供登出；不產生 OAuth 前端、角色管理頁或選單改造。
- [ ] Nest、Next、SSR 與部署代理在成功、404、guard、429、exception 情境不記錄完整入口、raw URL/query/body/Referer、密碼或 cookie。倉庫外代理尚未套用時明列部署阻擋，不聲稱全鏈已驗收。
- [ ] 真正 REPL 到瀏覽器登入／錯密碼／無效 RSC／身分標示／登出的完整旅程有實際驗證紀錄；只有隔離展示資格，尚不能視為完整 027 正式交付。

## Comments & Implementation Results

（尚未開始）
