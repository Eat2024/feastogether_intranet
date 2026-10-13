# Feature Specification: WebView SSO 與員工 Session

**Feature Branch**: `[002-webview-sso-session]`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "第一版由主平台在開啟 WebView 時提供短效 JWT，電子簽後端驗證來源與內容，再以員工編號查詢 FGAPI 確認公司存在該員工，建立或更新本地員工資料並建立電子簽 session；本版不處理離職後同步、停用通知或既有 session 撤銷。"

## Clarifications

### Session 2026-10-12

- Q: 主平台目前是否已有固定的 WebView 身分交換協議？ → A: 沒有，由電子簽系統定義契約，主平台配合。
- Q: 身分交換採用什麼憑證？ → A: 採主平台私鑰簽章、電子簽系統以預先信任公鑰驗章的短效一次性 JWT；使用 SHA-256 型數位簽章，不使用無密鑰的裸 hash。
- Q: JWT 如何承載員工編號？ → A: 保留標準必填 claim `sub`，其值直接填入 `empid`；第一版不再另外提供重複的 `empid` claim。
- Q: 主平台是否可在 JWT 提供姓名作為第二身分因素？ → A: 主平台拿得登入 session 的姓名，因此可提供選填 `name`；但姓名不是第二認證因素、不參與身分決策，員工 profile 仍以 FGAPI 為準。
- Q: 電子簽後端如何確認 JWT 中的員工確實存在？ → A: 以已驗證 JWT 的員工編號查詢 FGAPI，只有精確找到唯一且具第一版登入資格的員工，才建立本地員工與 session。
- Q: 第一版是否處理員工離職後的持續同步與立即撤銷？ → A: 不處理；本版只在建立新 session 時查驗 FGAPI，不建立離職同步、停用通知、排程或既有 session 主動撤銷機制。
- Q: 主平台如何開啟 WebView？ → A: 主平台後端先以 HTTPS POST 將簽章 JWT 交給電子簽，電子簽驗證後回傳只可使用一次的短效 `launchUrl`；主平台直接用該 GET URL 開啟 WebView。GET 只回傳電子簽同源的自動提交頁、不改變 server 狀態；頁面隨即以 POST 提交 `code`，電子簽才原子消耗 code、設定 session cookie並導向固定首頁。
- Q: `code` 是否需要再向主平台交換 access token？ → A: 不需要。`code` 是電子簽自行產生並保存摘要的一次性隨機值，不是 OAuth authorization code；JWT 只做 RS256 驗簽而非解密，因此仍只有主平台持私鑰、電子簽持公鑰。
- Q: Session 是否只存在 Redis？ → A: 不。第一版新增 MySQL `auth_sessions` 表作為 launch 防重放與本地 session 的唯一權威來源；Redis 不得成為登入及受保護請求的必要依賴。

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 從主平台無縫進入電子簽 (Priority: P1)

已在公司主平台完成身分驗證的員工從主平台開啟電子簽 WebView 時，不需要再次輸入帳號密碼。主平台提供只供本次啟動使用的短效簽章憑證，電子簽系統確認憑證有效且員工可由 FGAPI 精確找到後，建立自己的登入 session，讓 WebView 進入電子簽系統。

**Why this priority**: 這是後續文件建立、資源授權與內部員工簽署的共同身分入口；沒有可信 session，所有業務功能都只能依賴不可接受的身分模擬。

**Independent Test**: 以一名 FGAPI 可精確查得的員工，由主平台測試簽發有效 JWT，先取得一次性 `launchUrl` 再用該 URL 開啟 WebView；確認系統建立或更新正確的本地員工、設定安全 session cookie、導向固定首頁，且後續受保護請求取得相同員工身分。

**Acceptance Scenarios**:

1. **Given** 主平台已驗證員工 A 並產生符合契約的有效短效 JWT，且 FGAPI 有唯一相符的員工 A，**When** 主平台取得 `launchUrl` 並以該 URL 開啟 WebView，**Then** GET bridge 自動 POST code，電子簽系統建立員工 A 的本地 session、導向無 code 的固定首頁並允許進入系統。
2. **Given** 員工 A 首次進入電子簽且本地尚無該員工，**When** JWT 與 FGAPI 查驗均成功，**Then** 系統以 FGAPI 的白名單資料建立唯一的本地員工，再建立 session。
3. **Given** 員工 A 已存在本地，**When** 再次成功交換且 FGAPI 的姓名、部門或職稱已更新，**Then** 系統只更新核准的目前資料與最近登入時間，不改寫歷史簽署快照或其他業務資料。
4. **Given** WebView 已成功取得本地 session，**When** 存取一般受保護功能，**Then** 系統從 session 取得本地員工身分，不接受 client 另外宣告的員工編號取代目前使用者。

---

### User Story 2 - 拒絕偽造、過期與重放憑證 (Priority: P2)

系統管理者可以確信只有指定主平台簽發、用途正確且仍在短效期限內的 JWT 能交換 session。任何被竄改、重複使用、用於其他系統或來自未知金鑰的憑證都不會建立登入狀態。

**Why this priority**: WebView 交換入口位於登入前，一旦錯誤接受憑證，攻擊者就能冒用員工身分存取後續電子簽文件。

**Independent Test**: 對交換入口提交簽章錯誤、演算法錯誤、issuer／audience／type 錯誤、缺少必要 claim、過期、尚未生效及重複 `jti` 的 JWT，確認所有請求均被拒絕且沒有 User 或 session 的局部寫入。

**Acceptance Scenarios**:

1. **Given** JWT 簽章無效、內容被改動或使用未允許演算法，**When** 提交交換，**Then** 系統拒絕建立 session，且不依其中資料查詢或建立員工。
2. **Given** JWT 的 issuer、audience 或用途類型不符合電子簽交換契約，**When** 提交交換，**Then** 系統拒絕該憑證，即使簽章本身可驗證亦同。
3. **Given** JWT 已過期、尚未生效、簽發時間不合理或缺少必要員工識別與一次性識別，**When** 提交交換，**Then** 系統拒絕建立 session。
4. **Given** 某個 JWT 已成功交換過 session，**When** 相同 `jti` 再次被提交，**Then** 系統拒絕重放且不建立第二個 session。
5. **Given** JWT 被放在 URL query、一般頁面網址或其他未允許位置，**When** 請求抵達系統，**Then** 系統不得把該值視為可交換的登入憑證。

---

### User Story 3 - 驗證公司員工並安全維持 Session (Priority: P3)

員工的 JWT 通過驗證後，電子簽系統以員工編號向 FGAPI 確認公司員工資料。只有查到唯一精確結果時才建立 session；FGAPI 查無資料、回傳歧義資料或暫時不可用時，系統採安全失敗。員工可在 session 到期前持續使用電子簽，並能主動登出。

**Why this priority**: JWT 證明資料由主平台簽發，FGAPI 則是第一版確認員工存在與取得目前公司資料的權威來源；兩者缺一不可。

**Independent Test**: 分別模擬 FGAPI 唯一精確結果、只有相似員編、沒有結果、多筆精確結果、格式錯誤與服務失敗；確認只有唯一有效結果能建立 session，且建立後的 session 可使用、會到期並可登出。

**Acceptance Scenarios**:

1. **Given** JWT 的 `sub` 為員編 `00123`，**When** FGAPI 同時回傳相似員編與唯一的 `00123`，**Then** 系統只接受完全相符的 `00123`，不得取第一筆或模糊比對結果。
2. **Given** FGAPI 查無完全相符員工、回傳多筆完全相符結果或資料格式不合法，**When** 系統處理交換，**Then** 不建立或更新本地員工，也不建立 session。
3. **Given** FGAPI timeout、連線失敗或回傳不可判讀結果，**When** 系統處理交換，**Then** 採安全失敗並回傳可重試的通用錯誤，不得退回只相信 JWT 或本地舊資料。
4. **Given** JWT 與 FGAPI 查驗成功，**When** 建立本地 session，**Then** 原始 JWT、FGAPI 憑證及其他秘密不會保存在 session、資料庫、URL 或一般日誌中。
5. **Given** 員工已有有效 session，**When** 在有效期間存取受保護功能，**Then** 系統以不透明 session 識別還原員工身分，且 client 無法讀取 session 識別內容。
6. **Given** session 已到期或員工主動登出，**When** 再次存取受保護功能，**Then** 系統拒絕存取；重新進入必須由主平台提供新的交換 JWT。

### Edge Cases

- 主平台後端取得 `launchUrl` 不代表 WebView 已登入；GET 該 URL 也不得寫入或消耗 code，只有 bridge POST 成功消耗 code 並收到電子簽 cookie 後才建立 session。
- JWT 使用正確公鑰但演算法、用途類型、issuer 或 audience 不符時仍必須拒絕，不能只驗簽章成功。
- JWT 時鐘與 Server 有輕微誤差時只能使用明確且有限的容許值；不得因此接受長時間過期或尚未生效的 token。
- 兩個相同 `jti` 請求同時抵達時，只能有一個成功完成交換。
- 同一員工首次登入的多個不同 JWT 同時交換時，本地只能存在一筆對應該員編的 User，但可依合法需求建立彼此獨立的 session。
- FGAPI 員工查詢可能回傳員編片段結果；只有正規化後完全相同的員編可作為身分依據。
- JWT 姓名、部門或職稱與 FGAPI 不一致時，以 FGAPI 白名單資料為準，並不得在錯誤訊息中回傳兩邊的完整個資。
- FGAPI 回傳超長、格式錯誤或未預期欄位時不得直接落庫。
- Code 已消耗但 cookie 或導向回應未送達 WebView 時，同一 code 與原 JWT 仍須被拒絕；主平台必須簽發新 JWT 重新取得 `launchUrl`。
- Cookie 被清除、WebView 重建或跨 cookie store 開啟時，既有 session 不應透過 URL 或 client 儲存的 JWT 自動復原。
- 第一版不因 FGAPI 在 session 建立後的資料或在職狀態變動而主動更新 User 或撤銷既有 session；待 session 到期並再次交換時才重新查驗。

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: 系統 MUST 提供主平台後端建立一次性 WebView launch 的 HTTPS POST 入口、由 WebView GET 載入同源 bridge 的入口，以及由該 bridge POST 建立 session 的入口。
- **FR-002**: Launch 建立入口 MUST 只接受主平台後端以 `Authorization: Bearer` 提交的 JWT；MUST NOT 從 URL query、fragment、cookie、request body 或 client 宣告的員工資料接受 JWT。
- **FR-003**: 主平台 JWT MUST 使用預先約定的非對稱 SHA-256 數位簽章演算法；主平台持有私鑰，電子簽系統只以預先信任的公鑰驗章。
- **FR-004**: 系統 MUST 固定允許的演算法、issuer、audience、用途類型及信任金鑰，不得依 JWT 內容動態信任未知 issuer、公鑰、金鑰網址或演算法。
- **FR-005**: 交換 JWT MUST 包含用途類型、issuer、audience、唯一 `jti`、簽發時間、生效時間、到期時間及必填 `sub`；`sub` 的值 MUST 為員工編號 `empid`。第一版 MUST NOT 另外要求或接受重複的 `empid` claim 作為另一個身分來源。任一必要值缺少或格式不符時 MUST 拒絕。
- **FR-006**: 交換 JWT 的 `exp` 與 `iat` 差距 MUST 不超過 2 分鐘；驗證 `iat`、`nbf` 與 `exp` 時 MAY 接受最多正負 30 秒的時鐘誤差，超出後 MUST 拒絕。
- **FR-007**: 每個 `jti` MUST 透過 MySQL 唯一約束與交易原子地只能被接受一次；一次性狀態 MUST 保留以拒絕後續重放，不依賴 Redis TTL。
- **FR-008**: JWT 驗證未全部通過前，系統 MUST NOT 使用其中員工資料查詢 FGAPI、查詢／建立本地 User 或建立 session。
- **FR-009**: JWT 驗證完成後，系統 MUST 只以已驗證且格式正確的 `sub` 值作為員工編號查詢 FGAPI，不得以其他 claim、姓名、Email、部門或職稱推測身分。
- **FR-010**: FGAPI 查詢結果 MUST 以正規化後的完整員工編號精確比對；只有恰好一筆完全相符且符合第一版登入資格的結果可以繼續。
- **FR-011**: FGAPI 查無完全相符結果、回傳多筆完全相符結果、結果不具登入資格或欄位格式不合法時，系統 MUST 拒絕建立 session。
- **FR-012**: FGAPI 無法連線、逾時或回傳不可判讀結果時，系統 MUST 採安全失敗，不得改用 JWT 自帶 profile 或本地舊 User 當作存在性證明。
- **FR-013**: 系統 MUST 對 FGAPI 回應執行允許欄位與格式驗證，再將員工編號、姓名、人員狀態、部門名稱及職稱映射至本地 User。FGAPI 的字串部門代碼 MUST 驗證格式，但第一版 MUST NOT 將它直接寫入代表本地 `hr_departments.id` 的 `users.department_id`；本地部門外鍵保留原值，待後續組織主檔同步建立明確映射。
- **FR-014**: 本地不存在該員工時，系統 MUST 以 FGAPI 驗證資料建立唯一 User；本地已存在時，只能更新核准的目前員工資料與最近登入時間。
- **FR-015**: 員工建立或更新 MUST 保留既有歷史文件、簽署快照、稽核關聯與非 FGAPI 管理欄位，不得以外部回應整列覆蓋。
- **FR-016**: 同一員工編號的並發首次登入 MUST 最終對應同一筆本地 User，不得建立重複員工主體。
- **FR-017**: JWT 驗證通過後，系統 MUST 先以不可逆摘要原子 claim `jti`，再執行 FGAPI 精確查驗與 User 建立／更新；後續失敗不得釋放同一 `jti` 供重試。
- **FR-018**: 上述步驟全部成功後，系統 MUST 以密碼學安全亂數產生至少 256-bit 的一次性 `code`，只保存摘要，建立最長 60 秒的待啟動紀錄並向主平台回傳固定電子簽 origin 的 `launchUrl`。
- **FR-019**: WebView launch GET 入口 MUST 只接受 `code` query，只能回傳同源自動提交 bridge，且 MUST NOT 消耗 code、建立 session 或產生任何業務寫入。Bridge MUST 將 code 以 `application/x-www-form-urlencoded` POST 至 `/api/auth/session`；該 POST 才能原子消耗未過期且未使用的 code、建立本地 session cookie，並以 `303 See Other` 導向固定電子簽首頁，不接受任意 redirect URL。
- **FR-020**: Launch code MUST 不含員工資料、User ID 或 JWT，且只能成功使用一次；GET bridge 與 POST session 回應 MUST 使用 `Cache-Control: no-store` 與 `Referrer-Policy: no-referrer`，access log MUST 不記 GET query 或 POST body。Bridge MUST 限制為同源 form action、不得載入第三方資源，並提供 JavaScript 無法執行時的手動提交按鈕。
- **FR-021**: 電子簽 MUST NOT 使用 launch code 向主平台交換 access token；主平台 JWT 是簽章資料而非加密資料，電子簽只以公鑰驗簽，不持有主平台私鑰或任何解密金鑰。
- **FR-022**: 本地 session MUST 使用與上游 JWT 及 launch code 分離、至少 256-bit 的不透明亂數識別；cookie 保存原始值，MySQL `auth_sessions` 只保存其不可逆摘要、User、來源、驗證時間、啟用時間、到期時間及撤銷時間。
- **FR-023**: 本地 session 的最長有效期間 MUST 為 8 小時，且不得透過活動自動延長；到期後必須重新由主平台建立 launch。
- **FR-024**: Session cookie MUST 限於加密連線、禁止 client script 讀取，並採適合 WebView 同源使用的跨站限制；不得將上游 JWT 或 launch code 當作 session cookie。
- **FR-025**: 系統 MUST 提供員工主動登出本地 session 的能力；登出後須在 MySQL 原子標記撤銷，且相同 session 不得再通過驗證。
- **FR-026**: 一般受保護功能 MUST 以 cookie token 摘要查詢 MySQL 有效 session 取得 User，並重新確認該 User 仍存在且本地未被標示為不可使用；不得信任 request body、query 或 header 另行宣告的員工編號。
- **FR-027**: 登入、launch 防重放與 session 驗證 MUST 以 MySQL 為唯一權威來源；Redis 不可用時不得影響既有 session 驗證、建立 launch、消耗 code 或登出。
- **FR-028**: 系統 MUST 對交換成功、交換失敗類型、重放拒絕、FGAPI 不可用、code 消耗、session 建立、session 到期與登出保存不含秘密及非必要個資的安全事件。
- **FR-029**: 原始 JWT、原始 `jti`、任何私鑰、FGAPI API key、session cookie 及完整 FGAPI 個資回應 MUST NOT 寫入資料庫、URL、一般日誌、錯誤訊息或回傳 payload。原始 launch code 只允許出現在建立成功時回傳的 `launchUrl` 與該次 WebView GET URL，不得出現在其他儲存、log、錯誤或回應位置。
- **FR-030**: FGAPI 查詢失敗的 log MUST 不包含員工編號或帶有 `person_empid` 的完整 query path；對外錯誤不得洩漏員工是否存在、上游回應內容或驗章細節。
- **FR-031**: 正式環境 MUST NOT 提供可繞過主平台 JWT 與 FGAPI 查驗的開發登入、指定員工登入或 client 身分覆寫入口。
- **FR-032**: 本規格 MUST NOT 建立員工離職同步、停用通知、背景排程、登入後週期性 FGAPI 重驗、上游狀態變動主動撤銷既有 session、Email 外部簽署 session、文件綁定的簽署前重新驗證、文件／簽署業務 API、角色或 permission 系統。

### Scope Boundaries

**本規格包含**：

- 主平台與電子簽系統間固定的 WebView JWT 交換契約。
- 主平台後端建立一次性 launch、WebView GET bridge、同源 POST session、cookie 設定與固定首頁導向。
- 固定 issuer、audience、用途、必要 claims、信任公鑰及簽章演算法驗證。
- 短效期限、一次性 `jti` 與重放防護。
- 以已驗證員編呼叫 FGAPI，精確確認唯一員工及取得白名單公司資料。
- 本地 User 的首次建立、白名單欄位更新與並發唯一性。
- MySQL `auth_sessions`、WebView cookie、受保護請求身分還原、到期與主動登出。
- 登入與上游錯誤的安全稽核、敏感資料裁切及 FGAPI query log 遮罩。
- 開發與驗收環境在不開放正式繞過入口的前提下驗證完整交換流程。

**本規格不包含**：

- 員工離職、停職或其他狀態變更後的事件通知、定期同步、立即停用及既有 session 主動撤銷。
- 主平台登出時的 back-channel logout。
- 多 issuer、多身分提供者、動態 discovery、自動公鑰下載或完整金鑰管理平台。
- JWT payload 加密、JWE 或在 JWT 傳遞非必要敏感員工資料。
- OAuth authorization code／access token 交換；本規格的 launch code 只由電子簽產生並消耗。
- Redis session、Redis replay claim 或 Redis/MySQL session fallback。
- 一般帳號密碼登入、員工自行註冊、忘記密碼或員工管理後台。
- Email 外部簽署人的邀請與單一文件 session。
- 綁定特定文件與摘要的簽署前重新驗證、MFA、OTP 或 WebAuthn。
- 文件建立、簽署、通知、匯出或公開驗證功能。
- 角色、permission 或功能選單授權。

### Key Entities

- **WebView 交換憑證**: 主平台為單次 WebView 啟動簽發的短效 JWT，包含固定用途、來源、接收者、員工識別、時間限制及一次性識別；只用於交換本地 session。
- **受信任簽發者**: 第一版唯一允許的主平台 issuer、固定演算法、用途、audience 與預先配置的驗章公鑰。
- **員工查驗結果**: FGAPI 對已驗證員編回傳的唯一精確員工及允許同步的姓名、狀態、部門與職稱資料。
- **本地員工**: 電子簽登入、後續文件建立與內部簽署使用的唯一 User，以公司員工編號對應，不保存主平台 JWT 或密鑰。
- **WebView Launch**: JWT 與員工查驗成功後建立的待啟動狀態，以短效一次性 code 連接主平台後端與實際 WebView，不交換 access token。
- **本地 Session**: WebView 消耗 launch code 後啟用的短效登入狀態，以不透明 cookie 識別綁定本地員工、來源、驗證時間、到期及撤銷狀態。
- **一次性交換紀錄**: 保存在 `auth_sessions` 的 `jti` 摘要與 launch code 摘要，用於拒絕 JWT 及 code 重放，不保存原始值。

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 95% 的有效主平台 launch 建立在 FGAPI 正常回應時能於 3 秒內完成；WebView GET 有效 code 並由 bridge 自動 POST 後能於 1 秒內建立 session 並導向電子簽首頁。
- **SC-002**: 90% 的受測員工可從主平台開啟 WebView 並進入電子簽，不需再次輸入帳號密碼或接受人工協助。
- **SC-003**: 簽章、演算法、issuer、audience、用途、必要 claims、期限或生效時間任一不合法的驗收案例，拒絕率為 100%，建立 User 或 session 的筆數為 0。
- **SC-004**: 同一 `jti` 的重放及並發重放驗收案例中，成功交換次數最多為 1，額外 session 數量為 0。
- **SC-005**: FGAPI 查無精確員工、多筆精確結果、資料格式錯誤或服務不可用的驗收案例，建立或更新 User 及建立 session 的筆數均為 0。
- **SC-006**: 首次登入並發驗收中，每個員工編號對應的本地 User 數量恆為 1；姓名、部門與職稱非白名單欄位被外部資料改寫的筆數為 0。
- **SC-007**: Session 到期與登出驗收案例的存取拒絕率為 100%；client 端可讀取 session cookie 內容的案例數為 0。
- **SC-008**: 安全與錯誤 log 掃描中，原始 JWT、session cookie、FGAPI API key、員工編號 query 及完整 FGAPI 個資出現次數為 0。
- **SC-009**: 後續受保護功能可在 100% 的有效 session 驗收案例中取得唯一且正確的本地 User，並在 client 嘗試覆寫員工識別時維持原 session 身分。
- **SC-010**: Redis 完全不可用的驗收情境中，launch 建立、WebView code 消耗、既有 session 驗證與登出仍可在 MySQL 正常時成功完成。

## Assumptions

- 主平台願意依電子簽定義的固定 JWT 契約，由自己的後端建立 launch，並以電子簽回傳的 `launchUrl` 開啟實際 WebView。
- 第一版只有一個受信任主平台 issuer、一組固定用途與一把當前有效的驗章公鑰；自動金鑰發現與多 provider 留待未來需求。
- 第一版採 RS256 作為主平台 JWT 簽章演算法；其中 SHA-256 提供摘要，RSA 私鑰／公鑰提供來源驗證，不使用可被任意重算的裸 SHA-256。
- FGAPI 的員工查詢是第一版確認公司員工存在及取得目前 profile 的權威來源，且電子簽後端具有既有受控 API key 可呼叫。
- FGAPI 的「具第一版登入資格」沿用現有員工查詢契約可辨識的有效員工結果；本規格不延伸定義離職、留停、復職或其他人事狀態工作流。
- 8 小時本地 session 對應單一工作日內的 WebView 使用；未來若主平台提供可驗證的上游 session 到期時間，再另行限制不得晚於上游 session。
- JWT 只攜帶交換及查詢必要的身分 claims；`sub` 是第一版唯一的使用者識別，其值就是 `empid`，不另外放置同名 `empid` claim。主平台可選填 `name`，但它不是第二認證因素，也不用於身分對應；姓名、部門與職稱仍以 FGAPI 結果為準。
- 本地 User 是電子簽歷史關聯的長期主體；session 到期不刪除 User，重新交換時再次向 FGAPI 查驗。
- 本規格完成後只代表正式身分與 session 基礎可用，不代表文件建立或電子簽署功能已完成。

## Dependencies

- Spec 1 建立的唯一 `users.empid`、員工資料欄位、全域 guard 與窄化資料存取邊界必須保持可用；既有 Redis session 實作將由 MySQL `auth_sessions` 取代。
- 主平台必須安全保管簽章私鑰、產生符合契約的短效一次性 JWT，並只由後端提交 launch 建立請求。
- 電子簽部署環境必須以受控方式取得主平台驗章公鑰、FGAPI base URL 與 API key；實際秘密不得寫入 repository。
- FGAPI `staff_lookup` 必須能依員編回傳可精確比對的員工資料；若上游契約改變，Spec 2 必須先更新並重新驗收。
- Spec 3 的核心電子簽流程將直接依賴本規格提供的本地員工 session，不得另建平行登入或 client 身分模擬。
