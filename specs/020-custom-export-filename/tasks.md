# Tasks: 自訂當次匯出檔名

**Input**: `specs/020-custom-export-filename/` 的 spec、plan、research、data-model 與 contracts。

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[API 契約](contracts/export-downloads-http-api.md)。

**Tests**: 依 plan 與 Constitution 的檔案存取驗證要求，補上必要 helper／HTTP／整合測試；不新增前端測試框架。測試任務先於對應實作，先確認新案例在尚未實作時失敗。

**Organization**: 依 US1 Excel、US2 ZIP、US3 提示與修正分組。所有任務目前均未執行；文件生成不代表功能完成。

## Phase 1: Setup

**Purpose**: 提早確認 ZIP 命名方式可用，避免小功能演變成下載框架重寫。

- [x] T001 依 `specs/020-custom-export-filename/research.md` 的同源 `a.download`＋`Content-Disposition: attachment` 設計，以臨時、合成內容的最小瀏覽器驗證確認命名優先序、獨立 target 與原頁保留，將瀏覽器／結果記入 `specs/020-custom-export-filename/quickstart.md`；不提交測試站台、不動安全標頭。失敗先修訂 plan，不加入 Blob fallback、檔名 query 或儲存票證；實際入口網驗收留至 T012。

## Phase 2: Foundational

**Purpose**: 共用命名與 API 邊界；不建立資料模型、migration 或新的 infrastructure。

- [x] T002 在 `server/src/features/esign/helpers/export-file-name.spec.ts` 先建立名稱規則案例，再實作 `server/src/features/esign/helpers/export-file-name.ts` 與 `server/src/common/errors/app-errors.ts` 的中文 INVALID_REQUEST 定義：遵循「可省略的字串；null／非字串拒絕。trim 後輸入最多 100 Unicode code points；未指定或空白表示原預設。」及「最終含副檔名最多 255 UTF-8 bytes。」；trim 前拒絕控制／禁止字元，結尾 `.xlsx`／`.zip` 不分大小寫移除一次後補所選格式，拒絕空主檔名、起訖句點與 spec 保留名稱，覆蓋臨界值與不同副檔名切換，不回顯原名稱。
- [ ] T003 在 `server/src/features/esign/dto/export.dto.ts` 定義準備下載 request/response 與 GET query DTO：`type` 為「`excel` 或 `zip`。」；`documentId` 為「路徑中的既有文件 ID，後端驗證未刪除、非草稿與同部門權限。」；`exportId` 為「僅 ZIP 必填，既有匯出工作公開 UUID。」；`fileId` 為「僅 ZIP 必填，既有檔案 ID；必須屬於該文件的該工作。」；Excel 禁止這兩欄、未知欄位與不合法 ID 拒絕。名稱規則沿用 T002，不先 trim 掉控制字元；回應依 type 區分 Excel 的 nullable fileName 與 ZIP 的 fileName/downloadPath；GET 僅接受省略或單一 `downloadName=client`。
- [ ] T004 [P] 在 `client/src/api/endpoints.ts`、`client/src/api/types/esignExports.ts`、`client/src/api/requests/esignExports.ts` 登記 `POST /api/esign/documents/:documentId/export-downloads` 與 discriminated union 型別／純請求函式；確認 `client/src/api/types/index.ts`、`client/src/api/requests/index.ts` 可匯出。依契約解析現有 envelope，不新增 query hook、快取、token 或傳送身分／任意 URL。

**Checkpoint**: T002–T004 完成才進入使用者故事；T004 可與 T002–T003 並行，前後端只以契約對齊。

## Phase 3: US1 — 自訂 Excel 名稱 (Priority: P1, MVP)

**Goal**: 既有 Excel 匯出採用合法輸入，留白維持預設，失敗不新增成功紀錄。

**Independent Test**: 填寫「年度簽署紀錄」匯出，名稱為 `年度簽署紀錄.xlsx`、資料符合篩選；空白使用原名稱，非法名稱不記錄且可原頁修正。

- [x] T005 [US1] 在 `server/src/features/esign/controllers/export-file-name.spec.ts` 及 `server/src/features/esign/services/esign-export-file-name.spec.ts` 先補 Excel 準備的 HTTP/service 測試：有效 session／Origin、200 envelope、null 預設、400 非法欄位／類型／名稱、401 無或失效 session／僅外部憑證、403 Origin、404 跨部門／草稿／刪除文件；確認準備操作只讀、錯誤不包含原名稱。
- [x] T006 [US1] 在 `server/src/features/esign/services/esign-export.service.ts` 實作 Excel 準備分支，重用既有同部門 policy 並排除草稿；於 `server/src/features/esign/controllers/exports.controller.ts` 新增準備下載 POST，套用現有員工驗證、OriginGuard、200/no-store、DTO 與 Swagger。僅回 `{ type: 'excel', fileName }`，不記錄、不產檔、不保存設定，通過 T005。
- [x] T007 [US1] 在 `client/src/features/esign-documents/DocumentExportView.tsx` 與 `client/src/features/esign-documents/buildExportXlsx.ts` 接入 T004：點擊時擷取檔名與篩選值，準備成功後才沿用既有記錄及產檔；非 null 採自訂名稱、null 採原預設。請求失敗保留輸入／條件且停止後續記錄與下載，不修改歷史重下載流程。

**Checkpoint**: Excel 可獨立展示與驗收；這是 MVP，不代表 ZIP 與完整功能已完成。

## Phase 4: US2 — 自訂 ZIP 名稱 (Priority: P1)

**Goal**: 新產生與既有 ZIP 都能以當次名稱下載，保留原生串流、Range 與共用成果。

**Independent Test**: 兩名同部門員工以不同名稱下載同一 ZIP，各自名稱正確，工作 ID、內容 hash、metadata、歷史筆數不變；未填名稱維持原標頭。

- [ ] T008 [US2] 擴充 `server/src/features/esign/controllers/export-file-name.spec.ts` 及 `server/src/features/esign/services/esign-export-file-name.spec.ts`：先寫 ZIP 準備、export/file 必填與歸屬錯誤、未就緒／不可用、預設與自訂下載路徑、兩種 GET 標頭、200／206／416／If-Range、非法或重複 downloadName、準備後 session 失效仍拒絕 GET 的案例；驗證無 metadata／歷史／queue 寫入。
- [ ] T009 [US2] 在 `server/src/features/esign/services/esign-export.service.ts` 加入 ZIP 準備分支，重用 `download` 的授權、成果歸屬與可用性檢查；回傳 `{ type: 'zip', fileName, downloadPath }`，自訂名稱只附固定 `downloadName=client`，空白使用原成果名稱與原路徑。僅由服務組合 `/api/...` 相對路徑，不重打包或持久保存；同步 `server/src/features/esign/controllers/exports.controller.ts` 的 ZIP OpenAPI 說明。
- [ ] T010 [US2] 在 `server/src/features/esign/controllers/exports.controller.ts` 讓既有 GET 使用 T003 query DTO；client 模式僅送 `Content-Disposition: attachment`，完全移除該回應的 filename／filename*，省略旗標則維持原標頭。保留既有授權、Range／If-Range、Content-Type、ETag、private/no-store 與 nosniff，通過 T008。
- [ ] T011 [US2] 在 `client/src/features/esign-documents/ZipExportPanel.tsx` 接收並擷取點擊當下的名稱，以 T004 先準備再交付原生同源下載，`a.download` 採回傳名稱；必要的路徑檢查放 `client/src/api/requests/esignExports.ts`，禁止任意 origin。於 `client/src/features/esign-documents/DocumentExportView.tsx` 傳入現有輸入值；獨立 target／noopener 保留原頁，不使用 Blob、不把名稱寫入 URL、不將啟動下載顯示為完成。
- [ ] T012 [US2] 按 `specs/020-custom-export-filename/quickstart.md` 在真瀏覽器驗收首次／沿用 ZIP、空白／中文名稱、修改輸入時機、兩位員工並行、下載中斷與續傳、大檔記憶體，以及 Chrome／Edge 實際入口網 iframe、Safari／Firefox 同源頁；將環境與結果記入同文件。若目標環境不支援或無法取得，明列未驗證，不得勾選此任務或宣稱 ZIP 完成。

**Checkpoint**: 實際瀏覽器採用檔名是交付門檻，不能只靠 HTTP 測試通過；不因失敗擴大架構。

## Phase 5: US3 — 提示與錯誤修正 (Priority: P2)

**Goal**: 使用者理解當次性與副檔名規則，能在原頁修正錯誤。

**Independent Test**: 輸入非法路徑看到中文提示，保留條件並修正成合法名稱後成功下載；切換 Excel／ZIP 不重複追加副檔名。

- [ ] T013 [US3] 在 `client/src/features/esign-documents/DocumentExportView.tsx` 與 `client/src/features/esign-documents/ZipExportPanel.tsx` 移除未完成 TODO／提示，改為當次下載、留白預設與副檔名說明；沿用既有錯誤處理／session 過期 UI，準備中顯示 busy 並防重複提交。確認輸入限制不以 UTF-16 maxlength 取代後端 Unicode 規則，不清除失敗輸入、不永久保存名稱、不宣稱原生下載成功。
- [ ] T014 [US3] 依 `specs/020-custom-export-filename/quickstart.md` 驗收非法名稱→修正重試、`.xlsx`→ZIP／`.zip`→Excel、準備失敗、連續點擊、下載前後改值及重新整理清空；將結果記入同文件，確認無默默退回預設、篩選遺失或額外歷史紀錄。

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 只執行與本功能相關的整合驗證及文件同步，不增加功能或重構。

- [ ] T015 擴充並執行 `server/test/esign-export.e2e-spec.ts` 的真 DB 驗證：兩位同部門員工可準備同一成果、跨部門與 export/file 不匹配拒絕、重複準備／GET 不改 job/file metadata 或歷史筆數；搭配既有 `server/test/esign-export-history.e2e-spec.ts` 確認歷史重下載行為不變。僅使用 `feastogether_intranet_test` 前綴資料庫，未具備環境時記錄未完成。
- [ ] T016 [P] 檢查 `server/src/framework/interceptors/http-access-log.interceptor.ts` 的既有電子簽日誌排除及 `server/src/features/esign/controllers/exports.controller.ts`／`client/src/api/requests/esignExports.ts` 的資料邊界，確認請求與錯誤 log 不含檔名、URL 僅含固定旗標、回應不含 entity／object key／其他個資；把檢查結果記入 `specs/020-custom-export-filename/quickstart.md`，只有發現缺口才作必要修正。
- [ ] T017 執行 `specs/020-custom-export-filename/quickstart.md` 的 server helper／HTTP／e2e、package lint/build 與 root lint/build，記錄實際指令、結果與限制；server 使用 lint:check，不新增 client 測試框架，不以舊草稿測試結果替代本次驗證。
- [ ] T018 逐項核對 `specs/020-custom-export-filename/spec.md` 的 FR／SC 與驗收紀錄，必要時同步 `specs/020-custom-export-filename/contracts/export-downloads-http-api.md`、`specs/020-custom-export-filename/quickstart.md` 及本檔勾選狀態；只有實際完成的任務才勾選。交付分述前端、後端、無 migration/config 變更及尚未驗證項目，不執行部署或發布。

## Dependencies & Execution Order

```text
T001 → T002 → T003 ─┐
     └→ T004 ──────┤
                   ↓
US1：T005 → T006 → T007
                   ↓
US2：T008 → T009 → T010 → T011 → T012
                                 ↓
US3：                         T013 → T014

US1／US2／US3 → T015、T016 → T017 → T018
```

- 預設依編號執行；T004 可與 T002–T003 並行，T015 與 T016 可並行。
- US2 的程式修改等 US1 完成，以免同時修改共用 service/controller；US2 的驗收資料可獨立於 Excel 準備。
- T013 可於 T011 完成後開始；T012 的瀏覽器驗收與 T013 的提示修整可分開進行，但驗收結果須針對最終 UI 複核。
- 所有測試先確認能觀察到尚未實作的失敗，再進行對應實作；不得為了通過而降低既有權限／測試 DB 保護。
- T017 在前述變更穩定後執行；相同驗證不因文件勾選而無故重跑。

## Parallel Examples

以下為檔案與工作依賴說明，不要求啟動多代理或增設工具。

| 故事 | 可分開進行的工作 | 限制 |
| --- | --- | --- |
| US1 | T006 後，T007 前端串接可與執行 T005 後端案例並行。 | T005 的測試編寫已先完成；不得並行改共用 DTO。 |
| US2 | T011 後，T012 可由不同環境分別驗證 Chrome／Edge 與 Safari／Firefox。 | 各環境先回報結果，最後單一寫入者彙整 quickstart，未測環境不得勾選。 |
| US3 | T013 完成後，T014 的格式切換與失敗重試可分開驗收。 | 不同驗收者使用獨立頁面／資料，同文件結果集中彙整。 |

## Implementation Strategy

1. 先完成小型瀏覽器可行性檢查與共用邊界，不初始化新專案或安裝依賴。
2. US1 作為最小可展示範圍：Excel 命名與預設值、錯誤流程完整。
3. 接上 US2 的既有 ZIP 下載，再完成 US3 提示；完整交付須涵蓋三個故事。
4. 最後核對授權、無副作用、真瀏覽器與 lint/build 證據，保留未完成事項，不為通過驗收加入 spec 外機制。

## Requirement Coverage

| 需求 | 主要任務 |
| --- | --- |
| FR-001、FR-002 | T003–T007、T009、T011 |
| FR-003、FR-007 | T002、T003、T005、T008、T014 |
| FR-004、FR-005、FR-006 | T007、T009–T012、T015 |
| FR-008 | T005、T006、T008–T010、T015 |
| FR-009、FR-011 | T007、T011、T013、T014 |
| FR-010 | T005–T009、T014、T015 |
| FR-012 | T001、T008、T010–T012、T015 |
| FR-013 | T003、T009、T011、T016 |
| SC-001–SC-005 | T002、T005、T008、T012、T014–T018 |

**任務統計**：18 項；Setup 1、Foundational 3、US1 3、US2 5、US3 2、跨功能驗證 4。


### Ticket 01 進度

T003／T004 已完成 Excel 所需 DTO 與請求層；ZIP 型別與旗標留給 ticket 02，故暫不勾選。T005 的 service 測試已整合至真 HTTP／service／policy seam，避免重複 fixture。詳細驗證與未完成限制見 quickstart。
