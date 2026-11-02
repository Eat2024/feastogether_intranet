# Tasks: 電子簽部門可見、唯讀與匯出權限

**Input**: `specs/017-department-document-visibility/` 的 spec.md、plan.md、research.md、data-model.md、contracts/department-access.md、quickstart.md。

**日期**：2026-11-02；**狀態**：46 項實作與隔離驗證完成；真實 UAT 尚未執行。

**Tests**: 依 plan／quickstart 與專案憲章，權限、登入同步、migration、回填與直接下載需要單元／整合／E2E 驗證。測試先於對應實作建立，確認因預期缺少功能而失敗；環境或登入失敗不能冒充有效紅燈。client 無測試框架，不新增框架；以 lint/build 與雙帳號實際流程驗收。

**Organization**: Phase 1–2 共用前置；US1／US2／US4 為 P1，US3 為 P2。可用合成快照獨立測試 US1，不必先執行 UAT 回填。所有路徑以 repository root 為基準。

## Format: `[ID] [P?] [Story] Description`

- `[P]` 僅表示同階段前置完成後，可與明列的不同檔案任務並行，不代表可跳過依賴或自動啟動代理。
- 一項任務涉及多檔時，列出同一責任所需修改，不順便重構其他 feature。
- 本清單不授權立即執行 UAT 寫入或部署；回填任務產出可審查程序並在隔離資料演練，真實執行另依使用者部署指示。

## Phase 1: Setup

**目的**：建立目前基線與可執行的隔離驗證環境，不重新初始化專案。

- [x] T001 讀取 root／client／server 的 AGENTS.md 與 Spec 017 全部設計文件，核對當前工作區仍無 role=all 試作殘留，記錄原始 diff、FR-001～FR-012 與各驗收案例對應於 `specs/017-department-document-visibility/validation.md`，不改既有使用者變更。
- [x] T002 依 `server/.env.example`、`server/test/global-setup.ts`、`server/test/setup-e2e.ts` 確認 MySQL／Redis 測試環境及 feastogether_intranet_test 前綴保護，解決或明確記錄前次 MySQL 驗證失敗於 `specs/017-department-document-visibility/validation.md`；不提交本機 env、不使用 UAT DB 跑測試。

## Phase 2: Foundational

**目的**：所有故事共用的 schema、可信部門與錯誤契約。

- [x] T003 在 `server/src/features/users/entities/schema-metadata.spec.ts`、`server/src/features/esign/entities/schema-metadata.spec.ts` 與 `server/test/schema-migration.e2e-spec.ts` 補三欄、字串精確比較、NULL 舊資料、索引及 up/down/up 測試；驗證回滾不修改既有文件證據，先確認預期失敗。
- [x] T004 在 `server/src/features/users/entities/user.entity.ts` 與 `server/src/features/esign/entities/esign-document.entity.ts` 新增 departmentCode／createdByDepartmentCode／createdByDepartmentName，逐字落實 data-model 約束：「varchar(50), nullable」「varchar(50), nullable」「varchar(150), nullable」及「新建成功必須非空」；代碼使用 `utf8mb4_0900_bin`，保持字串、前導零及大小寫，原 departmentId 外鍵不變。
- [x] T005 建立 `server/src/infrastructure/database/migrations/1793664000000-DepartmentDocumentVisibility.ts`，於 `server/src/infrastructure/database/mysql/mysql.options.ts` 註冊，並更新 `server/src/infrastructure/database/schema.sql`；新增三個 nullable 欄位與 `idx_esign_documents_department_deleted_updated_id`（created_by_department_code, deleted_at, updated_at, id），down 反向移除；不得加 IT 預設值、呼叫 HR 或執行 UAT 回填，通過 T003。
- [x] T006 [P] 在 `server/src/features/auth/services/auth.service.spec.ts`、`server/src/features/auth/services/oauth-identity.service.spec.ts` 補登入部門新增／更新／缺值／上游失敗測試；落實「空白／空字串不作有效代碼」「上游明確缺值以 SQL NULL 清除舊值，不用 TypeORM undefined 跳過更新」，不把本機 departmentId 當上游代碼。
- [x] T007 [P] 在 `server/src/common/errors/app-error-code.ts`、`server/src/common/errors/app-errors.ts` 與 `client/src/api/errorCodes.ts` 加入 `ESIGN_DEPARTMENT_UNAVAILABLE`／409／「無法取得您的部門資料，請重新登入或聯絡系統管理員」，沿既有錯誤包裝，不新增 env 或 fallback。
- [x] T008 在 `server/src/features/auth/services/auth.service.ts` 與 `server/src/features/auth/services/oauth-identity.service.ts` 同步可信 HR 部門代碼／名稱；OAuth 依驗證後員編查既有 HR service，必要時更新 `server/src/features/auth/auth.module.ts` 的既有 provider wiring；不改 session token 格式或前端可寫欄位，通過 T006。
- [x] T009 在 `server/src/features/esign/services/esign-access-policy.service.spec.ts` 補建立人、同部門、跨部門、空代碼、失效帳號的政策測試，再於 `server/src/features/esign/services/esign-access-policy.service.ts` 使用既有 UserRepository 取得有效員工部門並提供「建立人或同部門可讀」及「必須同部門匯出」兩種明確判斷；保留 checkEsignCreator／草稿鎖的嚴格寫入規則，不新增通用 RBAC 層。
- [x] T010 建立 `server/test/department-visibility.helper.ts` 的合成兩部門、無部門、同名異碼及舊文件 fixtures；於 `server/test/jest-e2e.json`、`server/test/jest-e2e-security.json` 登記後續 `esign-department-visibility.e2e-spec.ts`／`security-esign-department.e2e-spec.ts`，使新測試確實被既有 testRegex 收集，不繞過安全 setup。

**Checkpoint**：欄位、可信登入同步、政策、錯誤與合成 fixtures 可用；未接上任何全公司瀏覽能力。

## Phase 3: US1 — 查閱同部門電子簽（P1）

**Goal**：列表 role=dep；同部門可讀草稿／詳情／來源 PDF／裁切歷程，只有發起人可修改。

**Independent Test**：合成 A1/A2、B1 與各狀態文件；A2 可讀 A1，B1 不可讀；A2 直接呼叫所有修改與邀請管理入口均拒絕。無需真實 UAT 回填。

### Tests

- [x] T011 [P] [US1] 建立 `server/src/features/esign/services/esign-document-query.service.spec.ts`，測試 dep 精確比對、所有狀態／已刪除、status 有效到期推導、created／assigned／未帶 role 回歸、isCreator、詳情裁切與文件層級歷程；先對缺少 dep 功能確認失敗。
- [x] T012 [P] [US1] 在 `server/test/esign-department-visibility.e2e-spec.ts` 與 `server/test/security-esign-department.e2e-spec.ts` 建立列表、直接 ID、來源預覽、草稿唯讀、未知 all／偽造部門參數、401／409／404，以及非建立人編輯／刪除／發起／停止／補簽／備註／通知／邀請 GET 拒絕案例；拒絕後驗證無 DB 寫入或 queue job。

### Implementation

- [x] T013 [US1] 在 `server/src/features/esign/repositories/document.repository.ts` 增加文件建立部門代碼等值查詢，deleted_at IS NULL、updated_at DESC／id DESC；在 `server/src/features/esign/services/esign-document-query.service.ts` 接 dep 分支，部門取自登入 User，不載入全公司後再裁切，保留個人查詢語意。
- [x] T014 [US1] 更新 `server/src/features/esign/dto/document-query.dto.ts` 與 `server/src/features/esign/controllers/documents.controller.ts` 支援 dep／created／assigned 及原 status；不支援 all 或 caller departmentCode；更新 Swagger，串接 userId，通過列表測試。
- [x] T015 [US1] 在 `server/src/features/esign/dto/esign-common.dto.ts` 與 `server/src/features/esign/services/esign-view.mapper.ts` 定義以 isCreator 區分的管理／唯讀 DTO，必要時更新呼叫 mapper 的簽署任務型別；唯讀僅含契約列出的文件／來源 metadata 與姓名、狀態、時間，不能傳 Email、note、個別拒簽理由、驗證連結、邀請憑證、寄送資格或 object key。
- [x] T016 [US1] 在 `server/src/features/esign/services/esign-document-query.service.ts` 將詳情與來源讀取改用 T009 唯讀政策，重命名 creatorDetail／creatorSource 至符合共用讀取責任並更新 `server/src/features/esign/controllers/documents.controller.ts` 呼叫；history 增加同部門文件層級事件視角，保留本人簽署視角、來源完整性驗證，reopeningInvitations 仍限建立人。
- [x] T017 [US1] 在 `client/src/api/types/esignDocuments.ts` 對齊 dep 與 isCreator 判別 DTO，更新 `client/src/features/esign-documents/DocumentsListView.tsx` 固定 role=dep；保留 `client/src/features/esign-documents/listQuery.ts` 的原關鍵字／日期／狀態邏輯，不新增後端搜尋 API。
- [x] T018 [US1] 修改 `client/src/features/esign-documents/DocumentRowActions.tsx`、`DocumentsTable.tsx`，讓非建立人可進草稿與已發起文件的檢視，但不能顯示修改／發起／停止／補簽／刪除操作；匯出按鈕留待 US4 以部門授權串接，不能以 isCreator 當匯出資格。
- [x] T019 [US1] 修改 `client/src/features/esign-documents/DocumentDetailView.tsx` 與 `DocumentSignerTable.tsx` 呈現唯讀 DTO；非建立人不 mount `NotificationHistory.tsx`、備註 mutation、催簽與補簽邀請控制，保留來源預覽與必要進度，避免先讀取敏感資料再 UI 隱藏。
- [x] T020 [US1] 在 `client/src/features/esign-documents/DocumentEditView.tsx`、`DocumentSignersEditor.tsx` 加建立人判斷，直接進 /edit／/signers 的同部門非建立人導回唯讀頁，不進可寫 editor；確認 backend mutation 一律仍驗證建立人與文件狀態。
- [x] T021 [US1] 執行 T011／T012 及 `specs/017-department-document-visibility/quickstart.md` 的前端雙帳號／日期搜尋／草稿檢視案例，於 `specs/017-department-document-visibility/validation.md` 記錄 isCreator、隱私欄位及無管理 side effect 驗收；client 跑 lint/build。

**Checkpoint**：可在合成資料展示同部門瀏覽；仍不可宣稱整體可上 UAT，必須完成 US2／US4／US3。

## Phase 4: US2 — 建立時固定部門（P1）

**Goal**：新文件有部門快照，調職或文件生命週期不改既有歸屬。

**Independent Test**：A 建文件後登入同步到 B，再新建；舊文件快照仍 A，新文件 B；缺代碼新建失敗且無孤立檔案。

- [x] T022 [P] [US2] 在 `server/src/features/esign/services/esign-draft.service.spec.ts` 先補非空代碼、名稱缺值、建立交易失敗清檔、拒絕前端覆寫、調職後新舊快照及文件流程不覆寫的 service 測試；精確驗證「schema 允許舊資料 NULL，新建成功必須非空」。
- [x] T023 [P] [US2] 建立 `server/test/esign-department-creation.e2e-spec.ts` 的 multipart 建立、缺代碼 409、未知部門 body 欄位拒絕、回應不洩漏部門來源及證據不變案例；於 `server/test/jest-e2e.json` 登記收集規則。
- [x] T024 [US2] 在 `server/src/features/esign/services/esign-draft.service.ts` 的建立交易取得可信有效 User 部門並保存兩欄快照；需要鎖時沿 `server/src/features/users/repositories/user.repository.ts` 模式，先 User 再新 Document、避免相反鎖順序；缺代碼拒絕並沿既有檔案清理，不新增 caller 可填部門或 IT default。
- [x] T025 [US2] 審核 `server/src/features/esign/services/esign-draft.service.ts`、`esign-initiation.service.ts`、`esign-reopening.service.ts`、`esign-stoppage.service.ts` 的更新欄位，確認沒有覆寫建立部門；補 T022 必要斷言，保留原建立人與 signing payload／signature／manifest／PDF。
- [x] T026 [US2] 執行 T022／T023，並以 A→B 部門同步驗證原部門同事可讀舊文件、新部門無關者不可讀，原發起人個人管理仍可用；在 `specs/017-department-document-visibility/validation.md` 留存結果而不記錄個資／secret。

## Phase 5: US4 — 同部門匯出與下載（P1）

**Goal**：匯出列表、歷史計數、Excel／PDF／ZIP 各入口全部限制文件所屬部門，不被直接 URL 或原匯出人身分繞過。

**Independent Test**：同部門 A2 可匯出 A1 文件；B1 直接持有所有 ID 仍拒絕且無紀錄／工作。原發起人調職後一般匯出亦拒絕，本人簽署副本入口維持原資格。

- [x] T027 [P] [US4] 在 `server/test/esign-export.e2e-spec.ts` 補同部門可建立／重用／查詢／重試／Range 下載 ZIP、跨部門全部拒絕、錯置 document/job/file ID、調職後舊 URL 失效測試；原全員成功測試改成同部門 fixture，不刪除負向斷言。
- [x] T028 [P] [US4] 在 `server/test/esign-export-history.e2e-spec.ts` 補 Excel／PDF 紀錄與重下載、total／typeTotals 同部門過濾、跨部門 documentId filter 空資料、外部匯出人按文件部門歸屬及拒絕無紀錄 side effect 測試。
- [x] T029 [US4] 修改 `server/src/features/esign/repositories/export-job.repository.ts` 的 exportable documents／historyPage／historyCounts／單筆讀取介面，透過文件快照加同部門條件；列表先限部門再分頁與計數，不以 exporter 部門判斷、不新增匯出部門欄位。
- [x] T030 [US4] 在 `server/src/features/esign/controllers/exports.controller.ts` 所有列表／request／detail／retry／download 傳入 userId；`server/src/features/esign/services/esign-export.service.ts` 於讀 snapshot、重用 job、寫入／enqueue、檔案 metadata／Range／stream 前驗證同部門與 ID 關係，不能給建立人跨部門例外。
- [x] T031 [US4] 在 `server/src/features/esign/controllers/export-history.controller.ts` 及 `server/src/features/esign/services/esign-export-history.service.ts` 對列表、Excel 記錄／重下載、PDF 歷史重下載套用同部門政策；未授權 404 或契約定義的空列表，檔案未就緒等錯誤必須在授權後判斷。
- [x] T032 [US4] 釐清並調整 `server/src/features/esign/services/esign-export-history.service.ts`、`esign-completion-access.service.ts` 及 `server/src/features/esign/controllers/documents.controller.ts` 的一般 completed-file/downloads 路徑為同部門；不能放寬 `server/src/features/esign/controllers/signing-tasks.controller.ts`／`external-signature.controller.ts` 的本人副本或邀請驗證。
- [x] T033 [US4] 修改 `client/src/features/esign-documents/DocumentExportView.tsx`、`buildExportXlsx.ts` 及 `client/src/api/types/esignExports.ts`／既有 request，確保同部門非建立人匯出使用 server 授權的完整 Excel 匯出資料，不拿 US1 已裁切詳情產生缺欄 Excel；沿用既有 API 路徑與授權後記錄流程。
- [x] T034 [US4] 在 `client/src/features/esign-documents/DocumentRowActions.tsx`、`DocumentDetailView.tsx`、`DocumentSignerTable.tsx`、`ZipExportPanel.tsx` 與 `client/src/features/export-history/ExportHistoryView.tsx` 接同部門匯出／下載能力，不能以 isCreator 作匯出資格；保持非建立人不可修改文件，409／404 走既有錯誤處理，無法取得資格時不 fallback 全公司資料。
- [x] T035 [US4] 在 `server/test/security-esign-department.e2e-spec.ts` 擴充所有匯出直接 URL、ID 關係、cookie 無效、缺代碼、調職舊 session、文件軟刪除與欄位洩漏案例；同時跑 `server/test/internal-portal-completion.e2e-spec.ts`、`server/test/internal-email-copy.e2e-spec.ts` 及外部副本原測試，證明本人留存資格未被部門規則封鎖。
- [x] T036 [US4] 執行 T027／T028／T035，驗證 worker 固定快照未改且檔案領取重新授權；在 `specs/017-department-document-visibility/validation.md` 記錄每一匯出入口、筆數、拒絕無 DB／queue／bytes side effect 的結果與前端 Excel 內容比對。

## Phase 6: US3 — 舊資料與既有入口切換（P2）

**Goal**：可審查、可核對、可回滾的一次性 UAT 回填；既有 session 與各正式登入入口一致。

**Independent Test**：隔離資料模擬切換前 ID 清單、軟刪除與切換後新文件；舊集合歸 1029030000，新建依實際部門，User／證據不變，重跑與回復可驗證。

- [x] T037 [P] [US3] 在 `server/test/password-login.e2e-spec.ts`、`server/test/webview-session.e2e-spec.ts`、`server/test/oauth-login.e2e-spec.ts` 增補既有帳號補代碼、缺值清空、調職及舊 session 後續讀 DB 新值的測試；dev-login fixtures 明確使用合成部門，不新增通用測試登入旁路。
- [x] T038 [P] [US3] 建立 `specs/017-department-document-visibility/uat-cutover.md`，提供可審查的一次性唯讀盤點、維護窗口、備份、顯式 ID 清單回填及按原值回復的 SQL／執行步驟；固定字串 `1029030000`／「IT策略本部系統開發部」，包含軟刪除舊文件、不更新 User／createdByUserId／updated_at／證據、不呼叫 HR 於 migration、不提交真實備份，真實 UAT 寫入留待部署指示。
- [x] T039 [US3] 建立 `server/test/department-backfill.e2e-spec.ts` 並加入 `server/test/jest-schema.json` 收集規則，在隔離 DB 驗證 T038 的實際 SQL／同一資料操作：精確 ID 集合、重跑、非預期非空值停止、回復原值、切換後資料不被覆蓋、代碼精確比對、影響筆數及證據摘要不變。
- [x] T040 [US3] 將 `specs/017-department-document-visibility/uat-cutover.md` 與 `quickstart.md` 的順序對齊：先停寫／停下載、備份與 schema、盤點舊集合、確認指定代碼對應、回填核對、部署相容程式、正式重登入同步後驗收再開放；回滾不得直接讓舊全員下載版本恢復對外服務。
- [x] T041 [US3] 執行 T037／T039 與隔離切換演練，將新舊文件筆數、回填／回復結果、各登入入口與既有 session 驗收摘要寫入 `specs/017-department-document-visibility/validation.md`；明確區分「隔離演練完成」與「尚未執行 UAT 回填」。

## Phase 7: Polish & Cross-Cutting

- [x] T042 [P] 更新 `specs/003-core-esign-flow/contracts/openapi.yaml` 與 `specs/003-core-esign-flow/spec.md`，記錄 dep、isCreator 與唯讀 DTO／建立快照；更新 `specs/015-export-history/spec.md`、`specs/015-export-history/contracts/export-history-http-api.md`，明確由 Spec 017 取代全員匯出規則；對齊 `specs/002-webview-sso-session/spec.md`、`specs/014-account-password-login/spec.md` 的登入同步敘述，不抹除歷史決策。
- [x] T043 [P] 在隔離代表性資料對 `server/src/features/esign/repositories/document.repository.ts`、`export-job.repository.ts` 查詢跑 EXPLAIN，於 `specs/017-department-document-visibility/validation.md` 記錄部門條件、索引與分頁／計數一致性；若需要調整索引，同步 migration/schema/data-model，不新增 pagination 或快取架構。
- [x] T044 依 `specs/017-department-document-visibility/quickstart.md` 執行受影響 server 單元測試、schema、E2E、安全 E2E、root pnpm lint 與 pnpm build，將命令、結果與未完成限制記錄於 `specs/017-department-document-visibility/validation.md`；有失敗先定位修復，不把環境失敗標成通過。
- [x] T045 依 `specs/017-department-document-visibility/contracts/department-access.md` 逐項檢查所有讀取／寫入／匯出入口與前端直接路由，確認無其他跨部門旁路、無 token／signature／Email 非必要洩漏；將 FR／SC 對照和最終 UI 雙帳號驗收補入 `specs/017-department-document-visibility/validation.md`。
- [x] T046 以 `specs/017-department-document-visibility/validation.md` 與 `uat-cutover.md` 產出交付摘要，分列 client／server／migration-config、已執行檢查、未執行 UAT 動作與回滾限制；核對無新增表／dependency／env／排程，tasks 只勾選有證據完成的項目。

## Dependencies & Execution Order

```text
Setup T001–T002
  → Foundation T003–T010
      → US1 T011–T021（P1，合成快照可獨立驗收）
      → US2 T022–T026（P1，真實建立快照）
      → US4 T027–T036（P1，匯出；UI 整合需 US1，端到端需 US2）
  → US3 T037–T041（P2，需 US1/US2/US4 後完整切換演練）
  → Polish T042–T046
```

- Foundation：T003 → T004 → T005；T006／T007 可並行，T008 依 T006，T009 依 T004/T007/T008，T010 收尾。所有故事均等待 Foundation 完成。
- US1：T011／T012 可並行；T013 → T014；T015 → T016；T017 依 API/DTO，T018 → T019 → T020 → T021。T013 與 T016 共用 query service，不並行修改。
- US2：T022／T023 可並行；T024 → T025 → T026。若與 US1 並行，E2E config 與共用 policy 的修改需序列整合。
- US4：T027／T028 可並行；T029 → T030 → T031 → T032；T033 → T034 → T035 → T036。T033 依 US1 的 DTO 定稿；T034 共用 US1 前端檔案，必須等待 T018–T020。
- US3：T037／T038 可並行，T039 依 T038，T040 依 T039，T041 依 US1/US2/US4 完整可用；回填程序的撰寫可提早，真實 UAT 不自動執行。
- 最後：T042 與 T043 的資料庫操作可並行，但 T043 的 validation 記錄要避開其他任務寫入同一文件；T044 → T045 → T046。不可同時跑會重設同一測試 DB 的 E2E/schema 套件。

## Parallel Examples by Story

- **US1**：T011 的 query service 單元測試與 T012 的 E2E／安全測試在不同檔案，可同時撰寫；測試 DB 執行仍序列。
- **US2**：T022 draft service 單元測試與 T023 creation E2E 可同時撰寫；其後 T024 實作按測試規格完成。
- **US4**：T027 ZIP E2E 與 T028 匯出歷史 E2E 可同時撰寫；服務／repository 變更按依賴整合，不跨檔重複實作授權。
- **US3**：T037 登入回歸測試與 T038 切換文件不同責任，可並行；T039 必須使用 T038 定義的同一 SQL，不能另寫鏡像邏輯假測試。

## Implementation Strategy

1. 先完成 Foundation，取得可信部門與隔離驗證基礎。
2. **本機 MVP**：US1 + US2，能建立部門文件、同部門唯讀且發起人管理；僅供本機驗收，不可標示整體部門隔離已交付。
3. 完成 US4 封住一般匯出／歷史／下載旁路，保留本人任務資格，再完成 US3 切換／回復演練。
4. **可部署範圍**：四個故事及 cross-cutting 驗證都完成，具有可審查回填程序；不以未受限的匯出入口作為可暫時上線的半成品。
5. 實作沿用現有 feature/service/repository 與 API 路徑，不新增角色管理框架或設定；發現現有語意與契約衝突時先記錄並修訂規格，不自行擴權。

## Coverage & Completion

| 範圍 | 任務 | 驗收來源 |
|---|---|---|
| 可信部門與欄位／錯誤 | T003–T010 | FR-003/004，data-model |
| US1 同部門瀏覽與管理分離 | T011–T021 | FR-001/002/005/006/007/008，SC-001/003/004 |
| US2 建立快照 | T022–T026 | FR-003/004，SC-002 |
| US4 同部門匯出 | T027–T036 | FR-010/011，SC-003 |
| US3 登入與 UAT 切換 | T037–T041 | FR-009/012，SC-005 |
| 全面回歸與交付 | T042–T046 | 全部 FR／SC、constitution |

共 46 項：Setup 2、Foundation 8、US1 11、US2 5、US4 10、US3 5、Polish 5。各項已依 validation.md 的實測證據完成；切分當時全部未勾選，現在勾選代表本機實作與驗證，不代表 UAT 部署。

`.specify/extensions.yml` 不存在，無 before_tasks／after_tasks hooks 需執行。
