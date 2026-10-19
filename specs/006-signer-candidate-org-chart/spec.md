# Feature Specification: 簽署人候選組織架構與兩小時快取

**Feature Branch**: `006-signer-candidate-org-chart`

**Created**: 2026-10-19

**Status**: Implemented — 後端已實作並通過本機驗證，前端未串接

**Input**: 使用者要求在 intranet 的 candidate 功能新增 API，呼叫饗賓人平台的組織架構 API，並以兩小時快取降低頻繁呼叫。

## 背景與已確認方向

- 饗賓人平台已提供 `GET /api/v1/hr/org_chart`，使用者已透過 Postman 確認能取得正確資料。
- intranet 已有 `GET /api/esign/signer-candidates`、饗賓 HTTP client 與 Redis；新功能沿用這些邊界。
- 採用跨使用者、跨 HTTP instance 共用的 Redis 快取，成功更新後有效 7,200 秒；過期後由下一次查詢觸發更新，不設排程。
- Spec 05 已由既有規格保留給一般匯出，因此本需求使用 Spec 06。
- 後端組織樹 API 與快取已實作；驗證紀錄見 quickstart.md。前端組織選人介面未包含於本次交付。

## Clarifications

### Session 2026-10-19

- 使用者確認組織樹只提供正式員工；既有員編搜尋仍可包含試用員工。
- 使用者確認本次不實作 Role／Permission／部門授權。Portal 只限制入口頁面，不構成 API 授權；任何持有效內部員工 session 的人均可直接呼叫本 API。
- 使用者後續要求刪除併發協調：改為讀快取、呼叫 API、寫入兩小時快取、回傳；同時未命中允許重複呼叫。
- 任一筆必要資料缺漏或型別錯誤，整批回傳 502、不寫入快取，不略過錯誤資料。合法空陣列可正常快取。
- 採 KISS：維持上述單一處理方式，不擴充權限系統、部分成功、額外重試或其他需求分支。

## User Scenarios & Testing

### User Story 1 - 查詢組織架構以選擇簽署人 (Priority: P1)

已登入的內部使用者需要取得部門樹及各部門直屬員工，作為選擇內部簽署人的資料來源。

**Why this priority**: 提供完整部門瀏覽來源，避免只能逐筆輸入員編；本次交付後端 contract，介面另行串接。

**Independent Test**: 以有效員工 session 呼叫新端點，使用合成上游資料驗證多個根節點、巢狀部門及員工欄位；確認查詢前後本機 users 與簽署資料沒有異動。

**Acceptance Scenarios**:

1. **Given** 使用者已登入且上游正常，**When** 第一次查詢且快取不存在，**Then** 取得組織樹，回應使用 intranet 的統一 envelope。
2. **Given** 上游含多個根節點、沒有員工的部門及深層子部門，**When** 查詢，**Then** 保留完整階層、來源排序及空陣列，不將子部門員工複製到父部門。
3. **Given** 使用者未登入或 session 已失效，即使快取存在，**When** 查詢，**Then** 回傳 401，不讀取組織快取或呼叫上游。
4. **Given** 員工尚未有 intranet 帳號，**When** 讀取整棵組織樹，**Then** 不批次建立或更新本機帳號，也不將員編當成本機 userId。

### User Story 2 - 多人查詢共用兩小時快取 (Priority: P1)

多人反覆開啟選人功能時，共用同一份最近取得的組織資料，降低饗賓人平台負載。

**Why this priority**: 本需求的主要目的是避免每次查詢都取得全公司名冊。

**Independent Test**: 使用可控制時間的測試與上游呼叫計數；另以至少兩個獨立服務實例連到同一測試 Redis 驗證併發。

**Acceptance Scenarios**:

1. **Given** 在 T 時刻成功寫入快取，**When** T 至 T+7,200 秒之前由任意已登入使用者查詢，**Then** 不呼叫上游，且讀取不延長到期時間。
2. **Given** 快取已過期且沒有使用者查詢，**When** 時間繼續經過，**Then** 不主動呼叫上游。
3. **Given** 快取不存在，**When** 多個請求同時抵達，**Then** 各自呼叫上游並快取成功結果，不互相等待。
5. **Given** 上游成功且 `data` 是合法的空陣列，**When** 更新完成，**Then** 空陣列也快取 7,200 秒，與「尚無快取」區分。

### User Story 3 - 更新失敗時得到明確結果 (Priority: P2)

使用者在上游或 Redis 異常時得到可辨識的暫時不可用訊息，不會看到由錯誤假造的空組織清單。

**Why this priority**: 必須避免錯誤覆蓋有效資料，以及多個實例在故障時各自繞過快取大量呼叫上游。

**Independent Test**: 注入上游拒絕、逾時、格式錯誤、Redis 失敗，驗證回應、呼叫次數與後續恢復。

**Acceptance Scenarios**:

1. **Given** 快取仍有效而上游不可用，**When** 查詢，**Then** 回傳快取，沒有上游請求。
2. **Given** 沒有有效快取且上游回傳非成功、401/403、逾時或格式不符，**When** 更新，**Then** 回傳 502，不寫入資料快取，也不把上游授權錯誤解讀為使用者 session 失效。
3. **Given** Redis 讀取或寫入失敗，**When** 查詢，**Then** 回傳 503；不得改為讓每個請求直接呼叫上游。寫入失敗的結果不宣稱已快取成功。

6. **Given** 上游名冊只有一筆必要資料缺漏或型別錯誤，**When** 驗證回應，**Then** 整批回傳 502、不寫入快取，也不略過該筆後回傳部分名冊。

### Edge Cases

- 快取 JSON 損毀、版本不符或結構不合法：視為無有效快取，經同一更新流程修復，不回傳部分資料。
- Redis 被清空、資料被淘汰或重新啟動：後續首次查詢可能提前呼叫上游；兩小時承諾以有效快取仍存在為前提。
- 更新失敗不建立兩小時的失敗快取；後續新請求可再次嘗試。同一請求不自動重試上游。這不是「任何故障情況下兩小時只能嘗試一次」的硬性限流。
- 上游保留符合條件的測試部門、略過無啟用部門的人員；intranet 不猜測或補出這些員工。
- 上游本身有 60 秒快取，因此使用者可見資料年齡可能約為兩小時加 60 秒及傳輸時間，不能宣稱人事異動精確在兩小時內反映。
- 組織資料有快取不代表登入 session 有效；每次查詢仍須通過既有授權流程。

## Requirements

### Functional Requirements

- **FR-001**: 系統 MUST 新增 `GET /api/esign/signer-candidates/org-chart`，沿用員工 session guard，不標示為公開端點。本次不新增 Role／Permission／部門檢查；任何有效內部員工 session 均可讀取。既有 candidate 查詢 contract 不變。
- **FR-002**: Server MUST 經既有饗賓 HTTP client 呼叫固定的 `GET /api/v1/hr/org_chart`，使用既有 base URL 與 API Key；不附使用者 Bearer Token，不接受使用者指定上游網址。
- **FR-003**: 系統 MUST 只回傳本規格列出的部門、員工欄位，保留樹狀結構、來源排序、字串代碼及前導零。額外上游欄位不得透傳；任一筆必要欄位缺漏或型別錯誤 MUST 視為整批上游格式錯誤，不略過個別部門或員工。
- **FR-004**: 成功回應 MUST 使用 intranet 的 `{ success, data, timestamp }` envelope；Controller 回傳資料 DTO，由既有 interceptor 包裝。不得把上游 envelope 巢狀放入 `data`。
- **FR-005**: 系統 MUST 使用同部署環境、同上游來源共用的 Redis 快取，不依使用者或 process 分份。不同環境／來源不得共用同一快取命名空間；key 不含 API Key、cookie 或個資。
- **FR-006**: 快取 MUST 在上游成功、內容驗證通過並完整寫入 Redis 後設定 7,200 秒 TTL；讀取不續期，API 及使用者不得指定 TTL 或強制刷新。無需求時不排程更新。
- **FR-007**: 快取未命中時直接呼叫上游，驗證成功後寫入快取並回傳；允許同時未命中的請求各自呼叫上游。
- **FR-008**: 不使用更新鎖、持有者識別、二次讀取、輪詢等待或發布期限。
- **FR-009**: 上游逾時為 10 秒，單次請求不自動重試；Redis 沿用既有 get/set 行為，不新增專用命令期限。
- **FR-010**: 只有合法成功 payload（包含 `[]`）可以寫入快取；失敗、逾時及格式錯誤 MUST NOT 轉成成功空陣列，亦不得快取上游錯誤 envelope，或回傳略過錯誤資料的部分成功名冊。
- **FR-011**: 上游非成功及格式錯誤 MUST 對應 502；Redis 讀寫失敗 MUST 對應 503。錯誤集中定義，不洩漏上游 body 或憑證；上游 401/403 不轉為使用者登入錯誤。
- **FR-012**: 本 API MUST 不寫入 users、簽署人、文件或業務稽核資料；允許必要的 Redis 快取操作及既有 HTTP 操作紀錄。不得為此建立資料表、同步排程或額外 Repository。
- **FR-013**: 組織樹 MUST 僅用於瀏覽／選人，不得作為簽署資格或權限的最終依據。儲存／發起仍須由 Server 執行既有身分、啟用狀態與業務資格檢查，不接受 client 或快取中的資格宣告。
- **FR-014**: 成功及失敗日誌 MUST 不記錄組織樹、姓名、員編、API Key、cookie 或 token；僅允許端點、耗時、HTTP 狀態、錯誤類型與必要的彙總計數。上游錯誤 body 也不可包含在日誌中。
- **FR-015**: HTTP 回應 MUST 避免瀏覽器／共享代理快取名冊（`Cache-Control: private, no-store`）；兩小時快取只存在受控後端。Redis 快取只含必要資料，不保存上游認證資訊。

### API Contract

| 項目 | 定義 |
| --- | --- |
| intranet 路由 | `GET /api/esign/signer-candidates/org-chart` |
| 驗證 | 既有員工 session；每次請求都驗證，不做 Role／Permission／部門限制 |
| 參數 | 無 query/body 業務參數；沒有 refresh 參數 |
| 上游 | `GET /api/v1/hr/org_chart`，server 端 `X-API-KEY` |
| 成功 | 200，`{ success: true, data: OrgDepartment[], timestamp: string }` |
| 未登入 | 401，沿用既有認證錯誤格式 |
| 上游失敗 | 502，穩定的本系統服務不可用錯誤 |
| 快取失敗 | 503，穩定的本系統暫時不可用錯誤 |

部門 DTO 欄位依序為：

| 欄位 | 型別與語意 |
| --- | --- |
| `department_ch_id` | string，非空部門代碼 |
| `department_name` | string，部門名稱 |
| `department_parent_guid` | string 或 null，上層部門代碼 |
| `startdate` | string 或 null，保留來源字串，允許空字串 |
| `stopdate` | null，目前上游只查詢 stopdate IS NULL |
| `children` | OrgDepartment[]，直屬子部門 |
| `employees` | OrgEmployee[]，直屬員工 |

員工 DTO 欄位依序為 `person_empid: string`、`person_name: string | null`、`title: string | null`。員編不可轉為數值；無本機 `userId`。只轉送以上欄位，非本地帳號匯入格式。

intranet 的 `timestamp` 是本次回應時間，不是快取建立時間或人事資料同步時間；上游的 `code`、`message`、`meta` 不重複轉送。錯誤 envelope 沿用 intranet 現有規範。

### Scope Boundaries

**包含**：candidate 下的新唯讀組織樹 API、饗賓部門服務介接、型別與欄位裁切、兩小時共用快取、錯誤對應、Swagger 與對應測試。

**不包含**：Role／Permission／部門授權、前端樹狀選人介面、全公司帳號批次匯入、員工資料同步、資料表／migration、新環境變數、背景排程、手動刷新 API、過期資料 fallback、每位使用者獨立快取，或改動 fgapi 的原有 60 秒快取。

**與既有 candidate 流程的界線**：查詢整棵樹不建立帳號。未來前端選取員工後，仍需透過既有流程取得本機 userId。既有 candidate GET 可能匯入帳號，與 Constitution 的 GET 無業務寫入原則有待另案整理，本功能不得複用該寫入行為來取得樹狀名冊。

**人員資格限制**：現有 candidate 對已存在的本機帳號不會重新查詢上游，因此本規格不宣稱即時在職驗證。若業務要求發起時重新確認 HR 在職資格，需另立寫入流程需求；不能以本規格的快取或既有本機查詢宣稱已解決該問題。

### Key Entities

- **組織樹**：上游提供的啟用部門與正式員工快照，服務於選人功能，非授權來源。
- **有效快取**：經驗證的必要 DTO 資料，帶有固定到期時間；合法空陣列也是有效快取。

## Success Criteria

- **SC-001**: 固定成功快照寫入後，在 7,200 秒內跨使用者發出 1,000 次查詢，上游額外呼叫數為 0；讀取後到期時間不變。
- **SC-002**: 兩個 HTTP 實例共用快取；成功寫入後另一實例直接讀取，不額外呼叫上游。同時未命中允許重複呼叫。
- **SC-003**: 在 T+7,199 秒查詢命中舊快取，T+7,200 秒之後第一次查詢觸發一次更新；無請求期間上游呼叫數為 0。
- **SC-004**: 上游失敗、逾時及格式錯誤不快取、不回傳假成功；Redis 讀取失敗時不呼叫上游，寫入失敗回 503。
- **SC-005**: 未登入請求在快取存在與不存在時均回傳 401，且未觸發快取或上游讀取；名冊不出現在日誌與對外錯誤中。
- **SC-006**: 使用包含多根、空部門、前導零員編、nullable 姓名／職稱及 10 層部門的合成資料，階層、順序與欄位裁切驗證全部通過；查詢造成的本機帳號／簽署資料異動為 0。
- **SC-007**: 上游失敗後，後續獨立請求可再次取得資料並建立快取。

## Assumptions 與 Dependencies

- 本草稿按「成功更新後兩小時有效」解讀使用者需求；不採固定時刻更新或硬性上游嘗試次數上限。
- 失敗後不提供過期資料；Redis 讀取失敗不直連上游；上游逾時 10 秒。
- 上游由 fgapi 提供並已可在 UAT 取得資料；只含狀態 1 的員工，既有員編搜尋可含狀態 0 與 1，兩者覆蓋範圍不同。
- 沿用既有 `FEASTOGETHER_BASE_URL`、`FEASTOGETHER_API_KEY` 與 Redis 設定。切換上游來源時必須隔離或失效既有快取；不新增設定項目。
- 所有通過既有內部員工 session 驗證的使用者可讀取同一組織樹，權限範圍與既有 candidate 入口一致；未來若增加資料可見範圍，不能直接沿用未裁切的共用回應。
- Redis 快取資料是暫存狀態，非業務主檔；任何測試樣本均須合成，不提交真實組織名冊。

## 實作銜接與規劃限制

- 入口：`server/src/features/esign/controllers/signer-candidates.controller.ts`。
- 業務服務：`server/src/features/esign/services/esign-signer-candidate.service.ts`。
- 上游介接：`server/src/infrastructure/http-client/feastogether/services/feastogether-department.service.ts` 及既有 `FeastogetherClient`；後者目前對其他名冊端點採取錯誤 body 省略策略，本功能也須涵蓋。
- Redis：沿用既有 RedisService.get/set，不新增專用命令或 Lua。
- 後續 Plan / Tasks 應涵蓋 service 測試、真實測試 Redis 的快取／TTL 驗證、HTTP 認證與錯誤契約測試，以及 server lint、test、build。測試 Redis 必須使用專案既有測試隔離機制，不操作正式資料。
- 本次已完成 Server API、共用快取與對應測試；Client、migration、環境變數與目前分支均未改動。未部署或連線驗證真實上游名冊。
