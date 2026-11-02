# Spec 017 實作驗證

## 基線與範圍（T001／T002）

- 整合分支：`implement/spec-017-department-visibility`；review 基準：`6f81e3ae71286ed7bcdb1c49c9a2bc5741ea0a64`（已合併 PR 37 規格）。
- 開始前僅 `.scratch/017-department-document-visibility/` tickets 未追蹤，無使用者程式 diff；保留原檔案。已讀 root/client/server AGENTS、憲章及全部 Spec 017 設計文件。
- requirements checklist：13 checked、0 unchecked；只代表規格品質。無 extensions.yml hooks；ignore 已涵蓋 env、node_modules、dist、.next、coverage、私有 storage。
- 基線查核：client 固定 role=created，server DTO 只允許 created/assigned，無 role=all 試作。
- 前置腳本需用 SPECIFY_FEATURE_DIRECTORY 明確指定本 feature；原環境指向不存在的 Spec 019，已用本次命令覆寫，未改專案腳本。
- 本機專用容器 intranet-spec017-mysql（127.0.0.1:13317，MySQL 8.4）、intranet-spec017-redis（127.0.0.1:16317）；測試 DB feastogether_intranet_test017，保留原測試 DB 前綴保護。不用既有 UAT／正式連線或其他專案 Redis。
- 基線 `pnpm lint`：0 errors、267 warnings；server unit：108 suites／1,004 tests 通過（merge hook）。
- 本機明確覆寫 DB／Redis 連線及清空 SSL 設定後 `pnpm -C server test:schema`：3 suites／14 tests 通過。過往 MySQL 驗證失敗已由本次可用的獨立環境排除；mysqladmin ping、Redis ping 均成功。
- 後續命令沿用上述環境，同一 DB 的 schema／E2E 序列執行。此為開始時基線；後續完成證據見下文，未執行 UAT。

## 需求與驗收追蹤

| 需求 | 主責 tickets | 驗收案例／證據（完成結果見各票與最終核對） |
| --- | --- | --- |
| FR-001/002、SC-001 | 04/05/10 | 同部門精確列表、兩部門每部門兩位建立人、六狀態與刪除排除 |
| FR-003、SC-002 | 02/06 | 新建非空快照、交易失敗清檔、調職／流程不覆寫 |
| FR-004 | 03/06/09 | 三種正式登入、缺碼清空、上游失敗、舊 session |
| FR-005、SC-003 | 04/05/08/10 | 唯讀 DTO、管理 GET、憑證／個資裁切 |
| FR-006、SC-004 | 05/10 | 姓名／員編／標題、日期、狀態篩選與清除 |
| FR-007 | 04/10 | all／偽造部門拒絕、個人查詢回歸 |
| FR-008 | 03/04/05/10 | 草稿唯讀、直接路由／mutation 拒絕且無副作用 |
| FR-009/012、SC-005 | 09/10 | 隔離回填／回復、舊 ID 清單及簽署證據不變 |
| FR-010 | 07/08/10 | Excel/PDF/ZIP／歷史／計數、直接 ID／Range、調職拒絕 |
| FR-011 | 07/08/10 | 本人跨部門簽署／副本、外部 OTP／副本與公開驗證回歸 |

## 實作決策差異

- Spec 018 已使用 migration timestamp 1793577600000；Spec 017 改用後續唯一 timestamp 1793664000000，功能及 schema 範圍不變。

## Ticket 02（T003–T005）

- Metadata 先紅（缺三欄）、schema 先紅（Unknown column department_code），實作後 metadata 2 suites／64 tests、schema 3 suites／15 tests 通過。
- server build、修改檔案 ESLint（0 errors/warnings）、diff check 通過。
- schema.sql 由隔離 MySQL mysqldump 產出，只有三欄及一索引；up/down/up、精確代碼、NULL 舊資料及證據不變均通過。
- User.departmentName 與既有 nullable signer.departmentSnapshot 補上 TS null 型別，不改既有資料庫欄位。

## Ticket 03（T006–T010）

- 登入同步新增14個行為斷言先紅後綠，相關3 suites／65 tests通過；OAuth使用現有HR且無需新增provider。
- 政策先確認缺少新方法／constructor參數失敗，再實作後47 tests通過；涵蓋精確字串、NULL／空白、失效員工、調職建立人讀取與匯出差異、交易鎖User。
- 完整server unit 108 suites／1,032 tests通過，server lint 0 errors／267 warnings，server build通過。既有policy constructor mocks僅補新增repository依賴。
- 合成fixtures與E2E／security收集規則已建立，HTTP功能案例待ticket04建立執行；三種登入E2E待ticket09，不宣稱已驗收。
- 前後端新增 ESIGN_DEPARTMENT_UNAVAILABLE／409；無新env／session格式。未連線UAT。

## Ticket 04（T011–T016）

- T011先紅5 failed／3 passed（缺dep/唯讀功能及history未帶signerId的管理事件裁切），實作後query單元9 tests通過。
- 安全E2E先確認同部門detail 404、dep缺功能400；補合法multipart與發起body後4 tests全綠，含14管理入口拒絕及文件／簽署人／audit／notification／queue均無變更。
- 正常E2E 7 tests通過：兩部門各兩位建立人×六狀態、NULL舊文件、精確大小寫／同名異碼、來源PDF、DTO裁切、歷程、個人查詢、調職舊session。
- 全server unit 109 suites／1,041 tests通過，server build、修改檔ESLint 0 errors/warnings通過。
- 契約補全canExport與既有GET detail的view=export；同部門才可取得完整Excel欄位，草稿404，GET不寫紀錄，不影響一般唯讀裁切。詳見department-access.md。

## Ticket 06（T022–T026）

- TDD：draft unit先紅5案，creation E2E先紅6案（4個未知欄位負向原已通過）；交易以requireDepartment(userId,manager,true)先鎖User再建立Document。
- Creation E2E 10/10、8套既有fixtures 78/78、completion+creation 16/16、draft單元22/22通過；全server unit109 suites／1,047 tests通過。
- 缺碼409並清檔、非法multipart欄位拒絕、名稱缺值、保存失敗清檔、調職前後快照與列表／建立人管理驗收通過。發起／補簽／停止／完成流程保留部門與簽署payload。
- Server build、lint:check（0 errors）及diff check通過。既有8套fixtures逐人明列合成部門，保留跨人負向案例；沒有runtime預設部門。

## Ticket 05（T017–T021）與 08 client 提前整合

- client lint／build通過；無新增測試框架或dependency。
- 以原始碼臨時副本啟動獨立Next server（13000），保留使用者既有3000 dev process；Chrome156三個隔離context搭配真實Nest API（13017，DB feastogether_intranet_test017ui、Redis1）驗收，不替換HTTP回應。
- 23個API請求檢查通過：兩位同部門看到彼此、跨部門不可見；文件／建立人搜尋、狀態、單邊／雙邊日期篩選與清除；草稿來源預覽入口及進度；無Email／note／管理控制；直接edit/signers導回唯讀且無通知／邀請／組織查詢；建立人保留管理；跨部門直接詳情拒絕。
- 同部門非建立人view=export獨立cache／API取得核准Email欄位，與一般唯讀DTO分離。瀏覽器測試用合成快照與文件，建立交易正確性另由ticket06驗證。
- 為同一組判別DTO／頁面保持可建置，T033／T034的client修改一併整合：Excel預覽、PDF canExport與history/ZIP失敗顯示；ticket08尚未完成，等待07與全匯出安全回歸，不能宣稱整體隔離可上線。

## Ticket 07（T027–T032）

- 有效紅燈：跨部門ZIP列表洩漏與Excel紀錄錯誤受理201；修正後ZIP／歷史E2E兩套84 tests通過（最後ID錯置錯誤順序修正亦重跑通過）。
- 所有一般匯出、歷史項目／分頁／total／typeTotals先限制文件部門；指定document/job/file及PDF record/signer/document關係均驗證。原建立人調職不能匯出，現有舊網址重新授權。
- 同部門非建立人成功、跨部門本人副本仍可使用，worker固定快照／Range下載回歸通過。一般下載更名departmentFile/downloadDepartmentCopy；本人與外部入口維持原資格。
- CompletionAccess單元17 tests、server build、diff check通過；修改檔ESLint 0 errors／17既有warnings。未執行UAT。

## Ticket 08（T033–T036）

- Client部分隨05整合；07完成後重啟真實合成API，Chrome三session重驗26個API請求，實際點擊匯出下載.xlsx並以既有ExcelJS解析：姓名與Email正確、note未洩漏，歷史count=1，跨部門以紀錄ID重下載404。
- 部門security 10/10（原4案+新增6案）通過：所有匯出URL、跨部門／大小寫異碼、NULL、invalid cookie、調職舊session、軟刪除、document/job/file與history/signer錯置；拒絕後DB／檔案metadata／queue不變且沒有stat／stream／enqueue。
- 本人副本：internal-portal-completion + internal-email-copy共15 tests通過；原外部與交付安全：security-core-esign-flow + esign-document-delivery-security共16 tests通過。
- Worker固定快照與領取時重新授權已有07 ZIP回歸證據；檔案lint 0 errors/warnings及diff check通過。
- 尚未執行UAT回填或部署。

## Ticket 09（T037–T041）

- 正式帳密、WebView、OAuth 登入 E2E：3 suites／14 tests 通過（`pnpm -C server test:e2e --runTestsByPath test/password-login.e2e-spec.ts test/webview-session.e2e-spec.ts test/oauth-login.e2e-spec.ts`）。A→B→NULL 同步後舊 cookie 仍有效，文件權限依目前 User 改變；HR 失敗不覆寫已知部門、不發新 session，保留本機 departmentId。
- OAuth 使用合成 HR HTTP client stub，保留真正 HR parser，未連外部 HR。Server build 通過，lint 無錯誤。
- 完整 `pnpm -C server test:schema`：4 suites／24 tests 通過，含直接解析 uat-cutover.md SQL 的 9 個回填測試。
- 目標3筆舊文件含1軟刪除與1已同值，首次實改2、重跑0、原值回復2、再次回復0；第4筆後建文件、User／建立人／簽署證據摘要與微秒 updated_at 不變。
- 缺失／重複 ID、不完整備份、未知非空值與回復衝突皆整批拒絕。移除 valid_count 防護後3個負向案例確實轉紅，已還原。新測試 lint 與 diff check 通過。
- 隔離切換演練完成；尚未執行真實 UAT 盤點、備份、回填或部署。回滾不可直接重開舊全員下載版本。

## 最終入口與需求核對（T045）

| 要求 | 實作／驗證證據 |
|---|---|
| FR-001/002、SC-001 | dep repository 精確代碼查詢；department-visibility E2E 兩部門、各兩建立人、六狀態，軟刪除排除 |
| FR-003、SC-002 | draft transaction 鎖 User 後保存快照；creation E2E 涵蓋調職、非法欄位、流程後快照／payload 不變 |
| FR-004、SC-003 | 三種正式登入同步與舊 session 回歸；NULL 409、偽造部門與 role=all 400、大小寫異碼拒絕 |
| FR-005 | readonly DTO 不查通知、不含 Email/note/驗證憑證/object key；一般列表只摘要，匯出另走已授權 DTO |
| FR-006、SC-004 | Chrome 實測文件／建立人搜尋、狀態、單邊／雙邊期間及清除，排序／分頁沿既有邏輯 |
| FR-007/008 | created/assigned 保留個人範圍；14 管理入口非建立人拒絕且無寫入，edit/signers 直接路由導回且不 mount 管理查詢 |
| FR-009/012、SC-005 | uat-cutover.md 明列舊 ID 與原值，包含軟刪除；實際 SQL 隔離演練及證據摘要不變，真實 UAT 尚未執行 |
| FR-010、SC-003 | exportable-documents、Excel view=export／歷史資料與紀錄、ZIP request/status/retry/file、PDF completed-file／history downloads 全部目前部門授權；ID 關聯、檔案與 queue 副作用負向測試 |
| FR-011 | 跨部門本人副本、內部簽署與外部／公開驗證沿既有資格；完整相關回歸與 security suites |

詳情／source／history 同部門可讀，原建立人仍可跨部門管理；reopening-invitations 與通知管理不放寬。canExport 僅為 UI 提示，各下載重新授權；缺碼與調職不以 isCreator 繞過。一般讀取、核准匯出、本人副本 DTO 分開，沒有新增取得原始簽名或永久物件 URL 的入口。

## Ticket 10 與最終交付（T042–T046）

- T042：Spec 002／003／014／015 契約同步完成，舊決策保留並註記被 Spec017 取代；原不存在的014只新增登入部門交互契約。OpenAPI YAML解析、160個本地引用、管理／唯讀成功案例與10種敏感欄位拒絕、role/view與非草稿限制驗證通過。無新增dependency。
- T043：[query-plan.md](query-plan.md) 保存實際 repository SQL、EXPLAIN 與可重跑腳本。20,002文件／100,010紀錄，dep及history使用部門索引，count與完整分頁一致。跨文件歷史排序仍有temporary/filesort；未作正式效能保證，未新增索引或查詢架構。

| 最終檢查 | 結果 |
|---|---|
| `pnpm -C server test --runInBand`（commit hook） | 109 suites／1,047 tests 通過 |
| `pnpm -C server test:schema` | 4 suites／24 tests 通過 |
| `pnpm -C server test:e2e` | 34 suites／369 tests 通過 |
| `pnpm -C server test:e2e:security` | 14 suites／83 tests 通過 |
| `pnpm lint` | 通過，0 errors／266既有warnings |
| `pnpm build` | server、client 均通過 |
| Chrome 真實 API 與實際 Excel 下載 | 3隔離sessions、26 API請求檢查通過 |
| `git diff --check`、query-plan腳本語法 | 通過 |

一般 E2E 使用本機 13317 的 feastogether_intranet_test017 與 Redis16317 DB2；安全 E2E 使用獨立 feastogether_intranet_test017security／Redis DB3。每個 DB 內序列執行，與效能／UI DB 分離。完整連線前綴如下（安全測試替換 DB 名與 REDIS_DB=3）：

```bash
DB_MYSQL_HOST=127.0.0.1 DB_MYSQL_PORT=13317 DB_MYSQL_USER=root DB_MYSQL_PASS='' DB_MYSQL_DB=feastogether_intranet_test017 DB_MYSQL_SSL='' DB_MYSQL_SSL_CA_B64='' REDIS_HOST=127.0.0.1 REDIS_PORT=16317 REDIS_PASSWORD='' REDIS_DB=2 pnpm -C server test:e2e
```

先前整套失敗已定位：舊容量建立人缺部門、原「無關員工」同部門、OAuth安全fixture缺HR stub且員編含不合法連字號；已明列合成部門、不同部門與合法合成HR資料，保留正式parser及負向斷言。另3套測試拒絕Redis DB0，改用隔離DB2通過，未放寬測試保護。這些失敗不計作成功證據。

交付範圍：

- **Client**：dep列表、明確唯讀詳情、直接管理路由保護、獨立Excel預覽、PDF/ZIP與歷史授權失敗呈現；實際下載驗收完成。
- **Server**：可信登入同步、固定建立快照、目前部門政策、讀取裁切、管理資格保留、所有一般匯出與下載入口逐次授權；本人／外部資格回歸通過。
- **Migration/config**：`1793664000000-DepartmentDocumentVisibility` 新增三個nullable欄位與一個索引；同步schema.sql，無新增表、dependency、env、fallback或排程；`.env.example`無新增設定需求。
- **限制**：只在合成隔離資料完成驗證，尚未真實UAT盤點、備份、回填或部署。切換及回復依 [uat-cutover.md](uat-cutover.md)，不能直接重開舊全員下載版本。大型偏態／併發效能沒有保證。

獨立 [PR review](review.md)：Standards 0、Spec 0 findings；未合併或部署。驗收用Chrome／獨立Next／Nest process已停止，測試cookie暫存已移除，使用者原3000開發服務保留。
