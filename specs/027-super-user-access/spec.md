# Feature Specification: Super user 登入、隱藏入口輪換與 REPL 基礎

**Feature Branch**: 未建立專用分支；規格編號 `027-super-user-access`

**Created**: 2026-11-04

**Status**: Draft — grilling 決策已確認，待 plan

**Input**: 保留 OAuth 與 WebView launch；一般員工不提供帳密登入。唯一 Super user 帳密由 `.env` 管理，透過隱藏前端入口登入。入口存 DB、REPL 查詢，每週一台北時間 04:00 輪換。更換帳密撤銷舊 Super user session，同瀏覽器只保留一個登入身分。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 維護者登入與辨識操作身分 (Priority: P1)

維護者從有效隱藏網址輸入專用帳密登入，不依賴 OAuth 或員工資格；畫面明確顯示目前為 Super user。

**帳密適用範圍**：本規格的帳密產生、雜湊驗證與更新僅供 intranet 的 Super user 專用。`SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH` 與 OAuth 無關，不是員工 OAuth 帳密，也不是 OAuth client ID／client secret；不得向 OAuth 專案傳送或使用這組帳密驗證。一般員工仍經 OAuth／WebView 登入；兩類身分只共用 intranet 會話與切換規則。

**Why this priority**: 提供後續授權管理的獨立維護入口。

**Independent Test**: 在員工登入上游無法使用時，完成入口查詢、維護登入、身分查詢及登出，不需要角色管理功能。

**Acceptance Scenarios**:

1. **Given** 有效入口與正確帳密，**When** 登入，**Then** 建立可辨識的 Super user 會話；帳密及會話憑證不出現在回應內容或網址。
2. **Given** 有效入口但帳密錯誤，**When** 登入，**Then** 不建立會話、不透露帳號是否存在，連續嘗試受頻率限制。
3. **Given** 未知、過期或格式不合法的入口，**When** 開啟頁面或送出登入，**Then** 都回 404、不顯示登入表單，不能透過另一個未檢查入口的登入介面繞過。
4. **Given** 有效 Super user 會話，**When** 進入既有內部頁面，**Then** 頁面身分檢查承認此身分，持續顯示 Super user 並可登出；業務授權由 Spec 028 決定。

### User Story 2 - 兩種員工入口與單一身分會話 (Priority: P1)

員工繼續使用 OAuth／WebView；切換至維護身分時，不留下可混用的舊會話。

**Why this priority**: 舊系統仍需長期嵌入，不能破壞既有登入。

**Independent Test**: 從兩種員工入口登入同一員工，完成與 Super user 雙向切換及登出。

**Acceptance Scenarios**:

1. **Given** 同一有效員工，**When** 分別透過 OAuth 與 WebView 登入，**Then** 對應同一本地員工，遵守相同員工資格、可信部門及會話規則。
2. **Given** 瀏覽器已有員工會話，**When** Super user 成功登入，**Then** 原會話撤銷，其他分頁後續請求使用新身分，原憑證不可重放。
3. **Given** 已登入 Super user，**When** 員工成功經 OAuth／WebView 登入，**Then** 同樣替換並撤銷該瀏覽器原會話；登入失敗不提前撤銷原會話。
4. **Given** 已切換身分，**When** 登出，**Then** 撤銷目前會話，不恢復先前身分，不撤銷其他瀏覽器獨立會話。
5. **Given** 一般員工帳密或開發登入請求，**When** 嘗試建立應用程式會話，**Then** 不能繞過 OAuth／WebView；唯一帳密例外為本 spec 的 Super user。

### User Story 3 - 每週輪換與受控查詢入口 (Priority: P1)

維護者透過 REPL 查詢入口；系統自動換新網址，跨重啟及服務實例保持一致。

**Why this priority**: 滿足隱藏入口的輪換與維護需求。

**Independent Test**: 控制時間跨越輪換點，驗證新舊入口、並發執行、停機補做與重啟持久性。

**Acceptance Scenarios**:

1. **Given** 尚無入口，**When** 首次受控初始化，**Then** 只建立一個有效入口，可立即查詢，不必等到下週。
2. **Given** 已有入口，**When** 到每週一台北時間 04:00，**Then** 原子切換為新隨機入口，舊入口立即失效，既有登入會話不受影響。
3. **Given** 多執行者同時觸發，**When** 輪換同一週期，**Then** 只有一次有效輪換，各服務接受同一入口。
4. **Given** 停機錯過多個週期，**When** 背景服務恢復，**Then** 只補做一次，之後恢復固定週期，不連續產生多個短暫入口。
5. **Given** 輪換寫入失敗，**When** 舊入口仍存在，**Then** 保持舊入口完整有效並回報不含原值的故障，不出現半更新或硬編碼備援入口。
6. **Given** 輪換前已開啟舊表單，**When** 輪換後提交，**Then** 拒絕登入，需取得新網址。
7. **Given** 維護者只啟動 REPL 並查詢，**When** 指令完成，**Then** 不執行業務寫入或背景工作；初始化入口則必須是明確寫入操作。

### User Story 4 - 帳密輪換撤銷舊維護會話 (Priority: P1)

帳密更新後，舊 Super user 會話不得繼續行使權限。

**Why this priority**: 憑證輪換必須收回既有登入資格。

**Independent Test**: 建立員工及 Super user 會話後套用新帳密，驗證各自下一次存取。

**Acceptance Scenarios**:

1. **Given** 舊 Super user 會話，**When** 新帳號或密碼設定生效，**Then** 下一次請求拒絕舊會話，舊帳密不能登入，員工會話不受影響。
2. **Given** 服務重啟但帳密未變更，**When** 使用未過期會話，**Then** 不因單純重啟而被視為帳密輪換。
3. **Given** 多實例部署，**When** 帳密輪換完成，**Then** 所有對外實例都拒絕舊憑證；只更新部分實例不得視為完成。

### Edge Cases

- 設定缺漏或不合法：設定驗證失敗，不使用無密碼、預設密碼或員工登入旁路。
- 無法查驗入口／會話：拒絕登入／存取，不以舊快照放行。
- 切換交易失敗：不留下同瀏覽器新舊兩個有效身分；新會話與原會話撤銷須一致。
- Super user 沒有員編或部門：不得偽造人事資料、配對同名員工或冒用指定簽署人。
- 入口不列於導覽、sitemap、一般紀錄、analytics 或錯誤；REPL 主動查詢是指定揭露管道。
- 隨機網址只代表入口位置；持有它不授予登入身分、會話或業務資料存取。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系統 MUST 保留 OAuth／WebView，沿用員工資格、可信部門與身分配對；移除一般員工帳密登入，不開放開發用身分旁路。（US2）
- **FR-002**: 系統 MUST 僅有一組部署管理的 Super user 帳密，僅使用 Super user 專用設定驗證，與 OAuth 帳密及 client 憑證無關，不依賴 OAuth 或員工資格，不能由角色管理授予、撤銷或產生第二組帳號。（US1、US4）
- **FR-003**: 密碼 MUST 以雜湊保存；不提供註冊、忘記密碼、網頁改密碼或預設帳密，登入受後端驗證與限流保護。（US1、Edge Cases）
- **FR-004**: 隱藏頁與登入提交 MUST 同時驗證目前入口；無效入口回 404，維持來源防護與禁止敏感回應快取，使用受保護會話。（US1、US3）
- **FR-005**: 所有入口 MUST 共用會話及身分查詢／登出規則；切換成功撤銷原會話，失敗保留原會話，登出不還原先前身分。（US2）
- **FR-006**: 系統 MUST 用最小必要資料區分員工與 Super user 操作者；不偽造員編／部門／簽署關聯，頁面身分檢查及顯示須支援兩者。（US1、Edge Cases）
- **FR-007**: 入口 MUST 不可預測、獨立於帳密產生，持久保存且跨實例只認一個有效值；初始化與輪換須防止並發重複。（US3）
- **FR-008**: 入口 MUST 每週一 Asia/Taipei 04:00 輪換，舊入口立即失效；錯過週期恢復後只補一次。（US3）
- **FR-009**: 網址輪換 MUST NOT 撤銷會話；帳密變更生效後 MUST 使所有舊 Super user 會話於下一請求失效，不影響員工。（US3、US4）
- **FR-010**: 系統 MUST 提供 REPL 入口初始化／查詢及必要身分診斷；一般 HTTP 使用者不得列出或取得入口。（US3）
- **FR-011**: REPL 啟動 MUST NOT 額外啟動業務背景消費、排程或自動同步寫入；查詢無業務副作用，初始化是明確寫入。（US3）
- **FR-012**: 登入、登出、憑證輪換失效、入口初始化及輪換結果 MUST 可追查種類、結果、時間及必要操作身分，不保存帳密、完整入口、token 或 cookie。（US1～US4）
- **FR-013**: 登入成功及既有內部頁面 MUST 顯示 Super user 並可登出；不製作 OAuth 登入／callback 或其他管理畫面。（US1、US2）
- **FR-014**: 後續授權尚未接入前，Super user MUST NOT 被視為普通員工 ID 或自動略過業務檢查；全業務權限由 Spec 028 驗收。（US1）

### Key Entities

- **員工身分**：通過既有資格查核的人員，保留既有文件及簽署關聯。
- **Super user 身分**：部署管理的唯一維護身分，與員工不同，須可被操作與稽核辨識。
- **登入會話**：連結唯一操作者、期限與撤銷狀態；維護會話亦須判定是否由目前帳密建立。
- **隱藏入口**：目前識別、輪換週期及生效時間，不直接授權。
- **登入／維護安全紀錄**：必要安全事件與結果，不是文件簽署歷程。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 三種入口的登入、切換及登出驗收全部通過；同瀏覽器切換後舊身分重放成功數為 0。
- **SC-002**: 無效入口、錯誤帳密與超限嘗試皆不能建立維護會話；敏感入口／帳密／會話值在一般紀錄中出現數為 0。
- **SC-003**: 並發、重啟與跨週停機驗收中，每週期最多一次有效輪換；切換後舊入口接受數為 0。
- **SC-004**: 帳密輪換生效後，舊維護會話下一次存取全部失敗，原有效員工會話全部不受影響。
- **SC-005**: 維護者不依賴員工登入上游即可完成入口查詢、登入、身分確認及登出；必要安全事件全部可追查。

## Assumptions

- 使用者已同意一組共用維護帳號；紀錄可辨識 Super user，無法識別實際保管者，不宣稱個人歸責。
- DB 保存入口、週排程、REPL 查詢與 `.env` 帳密是已確認交付限制；具體表、欄位、API 路徑與輪換機制留待 plan。
- 員工資格新鮮度沿用登入查核與本地停用規則，不新增人事同步排程。
- 首次部署明確初始化入口；週排程沿用獨立 worker 責任，不由每個 HTTP 實例各自執行。
- 不搬 CKS 的 JWT／Redis session、SAP helpers、本地員工密碼或 API registry 啟動寫入。
- 主頁身分防護與嵌入流程須相容新操作者，不覆蓋同期其他任務修改。

## Scope & Dependencies

- 本次拆分順序為 **027 → 028 → 029**；本 spec 負責維護身分與 REPL 基礎。[028](../028-module-authorization/spec.md) 實作全權限與角色管理；[029](../029-permission-navigation/spec.md) 實作選單。
- 取代 [014](../014-account-password-login/spec.md) 一般員工帳密入口；保留 [002](../002-webview-sso-session/spec.md) 的 WebView 與既有 OAuth 後端防護。不新增全站 OAuth 登出。
- 不做角色管理／員工指派／OAuth 登入與 callback 前端；允許必要的目前身分顯示及登出。
- 隱藏網址不是 URL session/token：持有網址不授權；仍不得揭露登入憑證或個資，不擴張憲章的外部邀請例外。
- 安全紀錄不恢復 [026](../026-retire-signing-audit/spec.md) 停用的文件／簽署事件歷程；授權異動稽核由 028 負責。
- 本 spec 明確授權必要入口持久狀態、專用帳密設定與週排程：手動配置及記憶體狀態無法滿足自動輪換、跨實例一致。將來停用維護入口時，可移除其排程／狀態而不影響員工登入。
- plan 須處理跨實例帳密輪換、cookie／身分回應相容、入口紀錄遮罩與環境範例文件；本階段不修改程式或實際設定。
