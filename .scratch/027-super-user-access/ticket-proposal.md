# 027 tickets 拆分提案

狀態：**待確認拆分，尚未發布 tickets，尚未實作**。依 `to-tickets` 的核准流程，這份文件供確認粒度與依賴；核准後才建立逐張本機 ticket。規格、設計與原始 tasks 仍是實作依據，本提案不另複製規格。

來源：[Spec](../../specs/027-super-user-access/spec.md)、[Plan](../../specs/027-super-user-access/plan.md)、[Tasks](../../specs/027-super-user-access/tasks.md)、[資料模型](../../specs/027-super-user-access/data-model.md)、[API 行為](../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../specs/027-super-user-access/quickstart.md)。

## 編號清單

1. **027-01：安全產生與驗證 Super user 專用帳密設定**。Blocked by：無。交付：離線產生 Super user 專用密碼雜湊並驗證設定，與 OAuth 帳密及 client 憑證無關。
2. **027-02：擴充可辨識操作者的共用會話，保持員工相容**。Blocked by：027-01。交付：可驗證兩類操作者的會話生命週期與原子替換，既有員工資料與會話保持相容；這是後續登入旅程的前置重構。
3. **027-03：透過窄 REPL 初始化及查詢維護入口**。Blocked by：027-02。交付：維護者不用啟動 HTTP 或業務 worker，即可明確初始化、查入口及檢查設定版本。
4. **027-04：完成受保護的隱藏登入、身分顯示與登出**。Blocked by：027-03。交付：真正從 REPL 取得入口、在瀏覽器登入並辨識維護身分及登出；錯誤入口、帳密與來源均無法繞過，入口不洩漏到一般紀錄。
5. **027-05：OAuth／WebView 共用單一身分並移除員工帳密入口**。Blocked by：027-04。交付：員工與維護者可雙向安全切換，舊 cookie 不可重放，既有 iframe 仍可用。
6. **027-06：每週輪換隱藏入口並支援停機補做**。Blocked by：027-04。交付：每週只生效一個新入口；多實例、重啟或漏跑都不重複輪換，既有會話保留。
7. **027-07：明確啟用新帳密並跨實例撤銷舊維護會話**。Blocked by：027-04。交付：維護者啟用新設定後，所有舊維護會話失效，舊設定實例不能重新簽發，員工不受影響。
8. **027-08：完成部署、回復與三入口整合驗收**。Blocked by：027-05、027-06、027-07。交付：完整可交付的 027，具備實際驗證、部署及回復證據與清楚限制。

## 027-01：安全產生與驗證 Super user 專用帳密設定

**What to build:** 維護者透過不連外的互動工具產生 Super user 專用密碼雜湊；服務只接受符合契約的唯一 Super user 帳密設定，並能穩定辨識設定版本。這組設定與 OAuth 無關，不用於員工登入或 OAuth client 驗證。

**Blocked by:** None (can start immediately).

**主要 tasks:** T005、T011、T027。

- [ ] 離線工具以 TTY 無回顯輸入及二次確認取得密碼，只輸出 hash；不接命令列密碼、不載入 Nest／DB、不留密碼歷史。
- [ ] 僅使用 server-only 的 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH` 驗證 Super user；不讀取、修改或共用 OAuth 員工帳密、client ID／client secret，不將這組帳密送往 OAuth 專案。一般員工保留 OAuth／WebView，後續僅共用 intranet 會話機制。
- [ ] 僅接受兩個 Super user 專用 server-only 帳密設定與固定 scrypt 格式：N=32768、r=8、p=1、salt 16 bytes、derived key 64 bytes、maxmem 64 MiB；缺漏或格式錯誤明確失敗，沒有預設密碼或 fallback。
- [ ] 帳號及密碼不 trim／normalize；非同步 KDF、固定長度安全比較，錯帳號仍執行相同 KDF 工作量。
- [ ] fingerprint 使用契約既定 domain separation 與序列化；同一 hash 穩定，新 salt 視為新版本；本張不自動啟用 DB 版本。
- [ ] 使用合成 fixture 驗證合法／非法設定、輸入邊界與 fingerprint 行為；不提交真實 secret、不新增密碼 dependency。

## 027-02：擴充可辨識操作者的共用會話，保持員工相容

**What to build:** 先將既有會話擴充為可辨識 employee／super_user 的共用生命週期，使後續三種入口能原子替換身分；完成後以既有員工回歸與隔離整合測試證明相容性。

**Blocked by:** 027-01：安全產生與驗證 Super user 專用帳密設定。

**主要 tasks:** T001、T002、T004、T006、T007、T008、T009、T010、T012、T013、T014、T053。

**切片說明:** 這是 `to-tickets` 允許先完成的 prefactoring。它同時涵蓋持久約束、repository、會話交易與驗證；不把單純建表當成功能交付，也不提前開放 Super user 業務權限。新登入路徑與前端尚未公開。

- [ ] 核對現有變更與測試入口，將新增 security/schema 測試納入實際執行範圍；所有 DB 測試只用受保護的隔離測試庫。
- [ ] 增量擴充既有會話並建立入口 singleton／append-only 安全事件；落實資料模型全部型別、NULL、CHECK、FK、unique 與索引約束，保留既有員工、文件關聯及歷史資料。
- [ ] employee 保留原 user 回應；super_user 無員工 FK、無偽造員編，僅 employee 設員工 request／CLS context。查會話使用可接受非員工的關聯方式。
- [ ] 會話固定八小時不滑動；過期、撤銷、員工停用或維護版本失配均拒絕。每次驗維護會話查 DB 有效版本，不使用權限／版本快取。
- [ ] 撤舊、簽新、replacement 關聯與成功安全事件同交易；固定鎖序，失敗 rollback 保留舊會話，已被替換舊 token 再使用回 409。cookie 原值只在 commit 後交回呼叫端。
- [ ] 安全事件僅白名單種類與欄位，credential 拒絕另短交易；不保存帳密、入口、token、IP、UA、body 或文件資料，不恢復簽署事件鏈。
- [ ] 實際驗證空庫與既有資料 migration、apply/down/reapply、約束與 employee 回填；有維護事件或維護 session 時拒絕破壞性 down。以專案工具產出 schema 快照。
- [ ] 共用會話的行為測試及既有員工回歸通過；本張不要求尚未存在的隱藏登入頁或週排程。

## 027-03：透過窄 REPL 初始化及查詢維護入口

**What to build:** 維護者能在不啟動應用 HTTP、業務 worker 或外部人事服務的維運環境，明確建立唯一入口、查詢目前位置及診斷設定是否生效。

**Blocked by:** 027-02：擴充可辨識操作者的共用會話，保持員工相容。

**主要 tasks:** T015、T016。

- [ ] 真正 REPL 可呼叫 initialize、currentEntry、credentialStatus；啟動不自動初始化，查詢不寫入，未初始化回明確結果。
- [ ] 首次初始化以 singleton PK 仲裁，產生 32 random bytes 的 43 字元 base64url 入口與兩個初始 generation；記錄最近週一台北 04:00 的已到期週期及同交易安全事件。
- [ ] 重複初始化不覆寫入口或憑證版本；有並發時只有一組有效初始狀態。週期 helper 的邊界行為有測試，後續排程直接沿用。
- [ ] 只有明確 currentEntry 呼叫回傳目前路徑與時程；credentialStatus 不回帳號、hash 或 fingerprint。
- [ ] 窄 context 不啟動 HTTP、queue consumer、Portal、mail、storage 或自動同步，不暴露裸 SQL／repository helpers，不保留 REPL history；結束關閉 DB 連線。
- [ ] 開發與建置後 REPL 指令可用，實際展示「初始化 → 查入口／狀態 → 結束」；完整副作用與並發回歸在 027-06 再驗。

## 027-04：完成受保護的隱藏登入、身分顯示與登出

**What to build:** 在員工登入上游不可用時，維護者仍可用 REPL 取得的有效隱藏網址完成登入，看到 Super user 身分並登出；非法入口不顯示表單，錯誤登入不影響原身分。

**Blocked by:** 027-03：透過窄 REPL 初始化及查詢維護入口。

**主要 tasks:** T003、T017、T018、T019、T020、T021、T022、T023、T024、T025、T026、T028、T050、T051。

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

## 027-05：OAuth／WebView 共用單一身分並移除員工帳密入口

**What to build:** 員工保留 OAuth 與舊系統 WebView 入口，與 Super user 在同瀏覽器成功切換時只保留新身分；錯誤切換不把原使用者登出。

**Blocked by:** 027-04：完成受保護的隱藏登入、身分顯示與登出。

**主要 tasks:** T029、T030、T031、T032、T033、T034、T035、T036。

- [ ] OAuth／WebView 對同員編仍對應同一本地員工，保留資格、可信部門、state／nonce／一次性 code／jti 重放防護。
- [ ] OAuth callback 與 WebView activation 用目前 cookie 進行共用原子替換；WebView launch 不先改瀏覽器身分，activation 成功仍 303 回根頁。
- [ ] employee→super_user→employee 雙向切換後舊 cookie 重放失敗；相同舊 token 並發只有一成功，另一回 409 且無 Set-Cookie；上游／KDF／DB 失敗保留原身分。
- [ ] 登出只撤目前會話、不恢復舊身分、不影響另一瀏覽器；無 cookie 冪等成功，適用的 OAuth 交易 cookie 與主 cookie 用相同屬性清除。
- [ ] 一般員工帳密與開發替代入口移除並回 404，沒有 reset／forgot／change-password 新旁路；仍被其他功能使用的上游 client 保留。
- [ ] EmbedBridge 遇 Super user 視為員工 mismatch，沿既有撤銷／launch-required 流程，不以全權限冒充員工、不因 user:null 例外；正式 iframe cookie 行為維持。
- [ ] 完成兩入口、替換競態、舊路徑移除與 iframe 瀏覽器回歸；紀錄 commit 後網路丟失需重新登入，以及無舊 cookie 無法辨識同瀏覽器並發的限制，不新增裝置 cookie。

## 027-06：每週輪換隱藏入口並支援停機補做

**What to build:** 背景服務每週一台北 04:00 換新入口；維護者可透過同一 REPL 查詢結果，在服務停機或多實例競爭下仍只有一個有效網址，既有會話不被登出。

**Blocked by:** 027-04：完成受保護的隱藏登入、身分顯示與登出。

**主要 tasks:** T037、T038、T039、T040、T041、T042、T043、T044。

- [ ] 共用輪換服務鎖 singleton，以最近到期週期大於 DB 已處理週期才產新入口、增加 entry generation 並同交易寫事件；同週 no-op、不改 credential generation、不撤會話。
- [ ] 只有獨立 worker 註冊週排程；固定 queue／scheduler／job、Asia/Taipei 週一 04:00、空 payload、3 次重試及既定 exponential backoff，保留最近 100 成功／失敗 metadata。
- [ ] startup 先做 DB catch-up，再處理 overdue job／排程；停機多週只補一次，Redis 排程遺失、job 重試及多 worker 並發仍由 DB 仲裁。
- [ ] 03:59:59／04:00、跨年、同週重啟、DB 故障與恢復有測試；失敗保留舊入口，未初始化不偷建帳號，不新增掃描排程或 production 時間設定。
- [ ] 輪換後舊 GET／POST 立即 404，包括已開舊表單；輪換先 commit 則登入失敗，登入先 commit 的會話仍有效。
- [ ] REPL 提供到期才輪換與白名單安全事件查詢（limit 預設 20、最大 100，beforeId 倒序），沒有任意強制輪換或 token 查詢；唯讀 helpers 不寫入。
- [ ] 真正 REPL 的初始化並發、重複不覆寫、開發／建置模式與連線關閉通過；HTTP／Console 不註冊 queue、不啟動外部業務服務。
- [ ] 完成週期、故障、競態與副作用驗收紀錄，未跑的停機環境情境明列限制。

## 027-07：明確啟用新帳密並跨實例撤銷舊維護會話

**What to build:** 維護者準備新設定後，以 REPL 明確啟用該版本；提交生效後所有舊維護會話失效，舊配置實例不能恢復舊憑證，而員工會話繼續運作。

**Blocked by:** 027-04：完成受保護的隱藏登入、身分顯示與登出。

**主要 tasks:** T045、T046、T047、T048、T049。

- [ ] activateCredentials 僅讀本機已驗格式的設定，要求 expectedGeneration CAS；不接受任意帳密參數，不在啟動時自動覆寫 DB 版本。
- [ ] 新 fingerprint 增加 generation、更新生效時間、撤銷全部 active 維護會話及寫事件同交易；錯 expectedGeneration 拒絕，相同 fingerprint no-op，故障整筆 rollback。
- [ ] 每次登入及驗會話沿用本機／DB active／session 三方版本檢查，不另加快取；再啟用舊設定也必須增加 generation，舊會話不復活。
- [ ] 使用兩個共享 DB／Redis、載不同設定的真實測試實例，證明未啟用新設定登入 503，啟用後舊會話兩側拒絕、舊實例不能新登入，新設定可登入。
- [ ] 原員工會話在兩側仍有效；相同設定單純重啟不撤維護會話。測試不得以單一程序改 env 代替雙實例。
- [ ] 記錄 commit 生效點、混跑期間維護 503 與全實例更新的完成條件，不宣稱零中斷或只更新部分實例便完成。

## 027-08：完成部署、回復與三入口整合驗收

**What to build:** 將已完成的登入、員工相容、網址輪換與憑證撤銷整合為可部署交付，讓維護者有明確首次部署、變更帳密及回復操作與實測證據。

**Blocked by:** 027-05：OAuth／WebView 共用單一身分並移除員工帳密入口；027-06：每週輪換隱藏入口並支援停機補做；027-07：明確啟用新帳密並跨實例撤銷舊維護會話。

**主要 tasks:** T052、T054、T055。

- [ ] 設定範例及維運文件說明兩項 server-only 設定、hash／REPL、首次部署停舊版再 migration／初始化／開流量、帳密版本啟用與回復；不寫實際 secret，不因回退重新開放員工密碼入口。
- [ ] 文件及必要 agent 指引反映 actor 邊界及 028 前業務 403；修改 agent 文件前使用適用技能，不描述不存在的授權功能。
- [ ] 執行適用 server lint:check、unit、build、e2e、security、schema，以及 client lint/build 與 root build/lint；記錄實際結果與未執行原因，不宣稱不存在的 client 自動測試。
- [ ] 最終驗收涵蓋八小時 cookie、iframe、無效 HTML／RSC、所有一般 log 遮罩、雙實例撤銷、REPL 副作用及三入口切換；倉庫外代理部署阻擋必須解除或明列未完成，不能誤報可正式交付。
- [ ] 實作與 API／維運契約逐項核對，交付摘要分列前端、後端、migration/config、限制與證據；沒有角色表、管理 UI、OAuth 前端、029 選單或提前 028 業務放行。

## 依賴與平行安排

- 起點只有 027-01；其後 027-02 → 027-03 → 027-04。
- 027-05、027-06、027-07 可在 027-04 後各自推進；同一 auth／console 組合檔案變更須序列整合，不能用可平行取代衝突處理。
- 原 tasks 將 US4 保守地排在 US3 完整 REPL 之後；實際 US4 只需要 027-03 已交付的窄 REPL、027-04 的登入及會話。因此 027-07 不依賴 027-06 的週輪換，避免人為增加 blocker。原 task ID 與驗收不變，僅票單採真正必要依賴。
- 027-08 阻擋正式交付；完成 027-04 僅可隔離展示，不能跳過員工入口清理、週輪換或憑證撤銷。

## 跨 spec 能力界線

027 無須等待 028 或 029。後續 spec 可引用下列已完成能力，但實際跨 spec ticket 邊由整體提案統一整理：

- **027-02**：持久 actor／SessionService 與交易、最小安全事件及 schema 相容基礎，可供後續純後端授權測試整合。
- **027-03**：窄 Console context 與受控 auth helpers，可供 028 擴充同類 REPL 管道。
- **027-04**：真正可登入的 Super user、session 讀取／登出與前端 actor union；028 授權端點的真實維護者驗收、029 身分相容驗收需要此能力。
- **027-05**：OAuth／WebView 共用替換與 EmbedBridge 相容；跨三入口授權驗收需要此能力。
- **027-07**：受控憑證啟用與當前版本診斷；028 REPL 維護身分有效性驗收可依此完成行為核對。
- **027-08**：正式整合交付門檻，不能用前面能力切片的單項完成取代。

## Tasks 覆蓋檢查

55 個原 tasks 皆只有一張主要負責票；完整驗收可能重跑前票行為，不代表重複承擔實作。

| Ticket | 主要 tasks | 數量 |
|---|---|---:|
| 027-01 | T005、T011、T027 | 3 |
| 027-02 | T001、T002、T004、T006、T007、T008、T009、T010、T012、T013、T014、T053 | 12 |
| 027-03 | T015、T016 | 2 |
| 027-04 | T003、T017、T018、T019、T020、T021、T022、T023、T024、T025、T026、T028、T050、T051 | 14 |
| 027-05 | T029、T030、T031、T032、T033、T034、T035、T036 | 8 |
| 027-06 | T037、T038、T039、T040、T041、T042、T043、T044 | 8 |
| 027-07 | T045、T046、T047、T048、T049 | 5 |
| 027-08 | T052、T054、T055 | 3 |
| 合計 | T001～T055，無缺漏、無重複主要歸屬 | 55 |

這份文件只完成拆分設計及靜態核對；沒有建立正式 issues、執行 migration、登入上游、操作真實設定或宣稱功能測試通過。
