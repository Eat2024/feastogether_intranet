# 05: OAuth／WebView 共用單一身分並移除員工帳密入口

**What to build:** 員工保留 OAuth 與舊系統 WebView 入口，與 Super user 在同瀏覽器成功切換時只保留新身分；錯誤切換不把原使用者登出。

**Status:** ready-for-agent

**Blocked by:** [04-hidden-login](04-hidden-login.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T029、T030、T031、T032、T033、T034、T035、T036。

## Acceptance Criteria

- [ ] OAuth／WebView 對同員編仍對應同一本地員工，保留資格、可信部門、state／nonce／一次性 code／jti 重放防護。
- [ ] OAuth callback 與 WebView activation 用目前 cookie 進行共用原子替換；WebView launch 不先改瀏覽器身分，activation 成功仍 303 回根頁。
- [ ] employee→super_user→employee 雙向切換後舊 cookie 重放失敗；相同舊 token 並發只有一成功，另一回 409 且無 Set-Cookie；上游／KDF／DB 失敗保留原身分。
- [ ] 登出只撤目前會話、不恢復舊身分、不影響另一瀏覽器；無 cookie 冪等成功，適用的 OAuth 交易 cookie 與主 cookie 用相同屬性清除。
- [ ] 一般員工帳密與開發替代入口移除並回 404，沒有 reset／forgot／change-password 新旁路；仍被其他功能使用的上游 client 保留。
- [ ] EmbedBridge 遇 Super user 視為員工 mismatch，沿既有撤銷／launch-required 流程，不以全權限冒充員工、不因 user:null 例外；正式 iframe cookie 行為維持。
- [ ] 完成兩入口、替換競態、舊路徑移除與 iframe 瀏覽器回歸；紀錄 commit 後網路丟失需重新登入，以及無舊 cookie 無法辨識同瀏覽器並發的限制，不新增裝置 cookie。

## Comments & Implementation Results

（尚未開始）
