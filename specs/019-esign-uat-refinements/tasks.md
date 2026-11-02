# Tasks: 電子簽 UAT 操作調整

**Input**: `specs/019-esign-uat-refinements/` 的 spec、plan、research、data-model、contracts 與 quickstart。
**Created**: 2026-11-02
**Status**: 待實作；所有 checkbox 均未完成。

**Tests**: 依 spec 驗收與憲章要求，為檔案存取、授權、DB查詢、快取與稽核提供必要測試。新增/更新測試先確認能抓到舊行為，再實作；既有正確行為只做回歸。client 無測試框架，使用 lint/build 與瀏覽器驗收。

**Format**: `- [ ] Tnnn [P?] [USn?] 說明與檔案路徑`。所有路徑相對 repository；標示新增的檔案於實作時建立。`[P]` 僅代表可在所述先決任務完成後與不衝突任務並行，不表示可跳過相依。

## Phase 1：Setup

確認設計基準與可安全驗證的環境。

- [ ] T001 核對目前工作樹、`AGENTS.md`、`client/AGENTS.md`、`server/AGENTS.md` 與六項設計，將實作基準 commit／分支記於 `specs/019-esign-uat-refinements/quickstart.md`；保留使用者變更，不直接在 dev 提交或自行合併其他 PR。
- [ ] T002 依 `server/test/jest-e2e.json`、`server/src/infrastructure/database/test/ensure-test-db.ts` 與 `client/package.json` 確認隔離 MySQL/Redis、fake HR/寄件測試方式，於 `specs/019-esign-uat-refinements/quickstart.md` 記錄可執行指令；不新增 client 測試框架或讀取 UAT 個資。

## Phase 2：Foundational

確認跨故事權限與契約；此檢查完成後才開始各故事，無新增共用框架。

- [ ] T003 核對 Spec017 是否已整合至 `server/src/features/esign/services/esign-access-policy.service.ts`、`server/src/features/esign/services/esign-export-history.service.ts` 與 `server/src/features/esign/services/esign-export.service.ts`；在 `specs/019-esign-uat-refinements/impact-analysis.md` 列出授權整合點。若尚未整合，可做本 spec 功能但不得宣稱同部門交付完成，不在本任務重做 Spec017。
- [ ] T004 依 `specs/019-esign-uat-refinements/contracts/uat-refinements.md` 核對 API DTO／回應與測試 fixture 的實際位置，確認既有 POST 下載相容、expiresAt nullable、q/label/exportSummary 新契約與 Spec018 HR service 相依；差異修正記入該合約，不新增表／欄位／env。

## Phase 3：US1 歷史重下載不記錄（P1，MVP）

獨立驗收：Excel/PDF/ZIP 重下載三次、並發與失敗皆零新增／零改寫；正常新匯出仍記錄。（FR001–006；SC001–004）

- [ ] T005 [US1] 在 `server/test/esign-export-history.e2e-spec.ts` 更新 PDF 重下載期待：成功／重複／並發不改 job 筆數與 metadata，未就緒409、不存在與未授權皆不寫入；保留新匯出與其他 PDF 入口會記錄的案例，先確認舊程式不符合新期待。
- [ ] T006 [US1] 修改 `server/src/features/esign/services/esign-export-history.service.ts` 的 redownloadPdf：不呼叫 recordPdf，保留 personalCopy 完整性檢查與 null→ESIGN_PERSONAL_COPY_NOT_READY，userId 繼續供授權；不改 creator/own/external 下載記錄。
- [ ] T007 [P] [US1] 修改 `client/src/features/export-history/ExportHistoryView.tsx` 的 Excel 重下載，以 `client/src/features/esign-documents/buildExportXlsx.ts` 既有 builder 與下載 helper 產檔，不呼叫記錄API；保留原條件與當前資料語意，僅移除重下載所需刷新與過時註解。
- [ ] T008 [US1] 更新 `server/src/features/esign/controllers/export-history.controller.ts` 的 Excel/PDF OpenAPI 說明，保留 PDF POST 路徑、OriginGuard 與附件契約，移除新增紀錄及寫入失敗敘述；核對 `client/src/api/requests/esignExports.ts` 仍相容。
- [ ] T009 [US1] 執行 US1 的 `server/test/esign-export-history.e2e-spec.ts` 及瀏覽器 Excel/PDF/ZIP 重下載，將紀錄筆數、metadata、缺檔／權限與正常新匯出結果寫入 `specs/019-esign-uat-refinements/quickstart.md`。

**Checkpoint**：US1 的上述獨立驗收通過後才標示故事完成；不得以僅完成UI或型別取代端到端驗證。

## Phase 4：US2 ZIP 永久沿用（P1）

獨立驗收：完成後第8/365天仍下載同一份ZIP；新增簽署不改內容、缺檔不重建。舊資料轉換僅於測試環境驗證。（FR007–012；SC005–007）

- [ ] T010 [US2] 在 `server/test/esign-export.e2e-spec.ts` 補測永久下載、最新曾成功工作固定選擇、多工作／缺檔不可回退、request/retry並發不建第二份、原快照重試及後續簽署不改檔；先確認舊期限與重用行為造成失敗。
- [ ] T011 [US2] 修改 `server/src/features/esign/repositories/export-job.repository.ts`：先選同文件最新曾成功工作（completedAt 非 null 或正常 completed，id DESC），再選未成功 active/failed；移除期限門檻，保留文件鎖，latest/summary 使用同規則；異常 completed 缺時間需列為不可用，不自動新建。
- [ ] T012 [US2] 修改 `server/src/features/esign/services/esign-export.service.ts` 的 request/retry/view/download：固定工作先選再查可用性、缺檔回 ESIGN_EXPORT_UNAVAILABLE，不跳選或重建；移除時間推導過期，保留串流/Range及原錯誤；舊 expired 缺檔仍不可用。
- [ ] T013 [US2] 修改 `server/src/worker/esign/document-export.processor.ts`：成功 expiresAt=null，不再轉 expired 或刪到期ZIP；配合 `server/src/features/esign/repositories/export-job.repository.ts` maintenance 篩選移除到期候選，保留租約、補列及孤兒暫存清理。此任務必須在 repository 修改完成後接續，不與其同時編輯。
- [ ] T014 [US2] 在 `server/src/features/esign/services/esign-document-query.service.ts` 與 `server/src/features/esign/dto/esign-common.dto.ts` 新增文件管理詳情 `exportSummary: EsignExportJob | null`，採相同固定工作選擇與公開投影，唯讀不排工作、不帶快照/object key；無匯出讀取資格不得新增揭露。
- [ ] T015 [US2] 同步 `client/src/api/types/esignDocuments.ts`、`client/src/api/types/esignExports.ts` 與 `client/src/features/esign-documents/ZipExportPanel.tsx`：初始選擇改用 exportSummary，保留3秒輪詢；移除期限及到期重建，新增簽署提示原ZIP固定不更新。
- [ ] T016 [US2] 更新 `client/src/features/export-history/ExportHistoryView.tsx`，舊 expired 顯示「檔案已不可用」且無重建操作；移除保存至／七天提示，保留未成功工作的重試及既有5秒處理中輪詢。
- [ ] T017 [P] [US2] 新增 `server/scripts/normalize-export-retention.ts`：預設dry-run，apply需顯式核對清單；串流驗證原檔大小/hash，僅受控修正可用 completed/expired 的 status/expiresAt/archiveStatus，保留建立時間與快照；記錄前值、可重跑、缺檔不重建，輸出不含個資/object key。不得直接連UAT執行。
- [ ] T018 [US2] 新增 `server/test/export-retention.e2e-spec.ts` 並納入 `server/test/jest-e2e.json`：測試dry-run零寫入、apply冪等、expired仍在/已刪/損毀、同文件多產物與最新固定缺檔；驗證active引用不被清理，維護仍恢復租約與清孤兒。只用隔離DB/儲存。
- [ ] T019 [US2] 執行 `server/test/esign-export.e2e-spec.ts`、`server/test/export-retention.e2e-spec.ts` 及相關儲存回歸，於 `specs/019-esign-uat-refinements/quickstart.md` 記錄結果、停止舊worker/排空/轉換/啟動順序及回滾限制；本任務不執行正式環境切換。

**Checkpoint**：US2 的上述獨立驗收通過後才標示故事完成；不得以僅完成UI或型別取代端到端驗證。

## Phase 5：US3 搜尋與分頁（P1）

獨立驗收：兩列表三類欄位搜尋與10/10/3頁碼分頁，條件、總數、權限一致。（FR013–019；SC008–011）

- [ ] T020 [US3] 在 `server/test/esign-export-history.e2e-spec.ts` 補真實MySQL案例：title/docNumber/creator姓名員編、creator與exporter不同、缺/軟刪creator、中文/大小寫/%/_/!、空白/超長q、23筆分頁及跨部門不計數。
- [ ] T021 [US3] 在 `server/src/features/esign/dto/export-history.dto.ts` 增加 `q?: string`，「trim 後最多 100 字，空字串等同未提供」；保留 type/documentId/page/pageSize，page為安全正整數，pageSize維持1–100；直接非法API輸入400，不讓offset溢位。
- [ ] T022 [US3] 修改 `server/src/features/esign/repositories/export-job.repository.ts` 的列表與counts共用條件，join文件createdByUser，以4欄OR加括號後AND權限，參數綁定並使用ESCAPE !跳脫!/%/_；依research的LOWER/CONVERT utf8mb4/binary定序比對，不回傳多餘creator資料。
- [ ] T023 [US3] 修改 `server/src/features/esign/services/esign-export-history.service.ts`：短讀交易先counts再有效頁items，total取目前type而typeTotals不受目前type限制；保留 createdAt DESC,id DESC，零結果page1；同步 `server/src/features/esign/controllers/export-history.controller.ts` 的q與超頁契約。
- [ ] T024 [US3] 在 `client/src/api/types/esignExports.ts`、`client/src/api/requests/esignExports.ts`、`client/src/api/queries/esignExports.ts` 串接q至query參數及key；`client/src/features/export-history/ExportHistoryView.tsx` 加SearchField、historyHref保留q、依response.page導正網址，改q/tab回第一頁。
- [ ] T025 [P] [US3] 修正 `client/src/lib/paginate.ts` 的完整正整數及safe integer解析；`client/src/features/signing-tasks/taskQuery.ts`、`client/src/features/signing-tasks/SigningTasksListView.tsx` 保留filter→split→sort→paginate及每頁10，補穩定唯一排序與網址導正，保留q/tab/sort/order，不改任務API為後端分頁。
- [ ] T026 [US3] 執行 `server/test/esign-export-history.e2e-spec.ts`，並依 `specs/019-esign-uat-refinements/quickstart.md` 瀏覽器驗收兩頁的空結果、非法/超頁、IME、清空搜尋、重整與條件保留；記錄23筆10/10/3及typeTotals結果。

**Checkpoint**：US3 的上述獨立驗收通過後才標示故事完成；不得以僅完成UI或型別取代端到端驗證。

## Phase 6：US4 組織圖快取30分鐘（P1）

獨立驗收：1799秒命中、1800秒後按需更新、讀不續期、舊key不命中。（FR020–022；SC012–013）

- [ ] T027 [P] [US4] 更新 `server/src/features/esign/services/esign-signer-candidate.service.spec.ts`：TTL1800秒、key v2且payload version1、舊v1 key不沿用、空陣列與失敗處理；先確認兩小時設定不符測試。
- [ ] T028 [US4] 修改 `server/src/features/esign/services/esign-signer-candidate.service.ts` 的TTL為1800、key為 `esign:org-chart:v2:<原hash>`，保留隔離/不續期/按需更新，payload version1不變；不新增排程或清空Redis。
- [ ] T029 [US4] 更新並執行 `server/test/org-chart.e2e-spec.ts`：真實TTL、跨實例共用、v1/v2隔離、不續期與到期行為；以隔離key縮短期限或受控時間測試，不等待半小時。
- [ ] T030 [US4] 更新 `client/src/api/query-options.ts` 的過時兩小時註解，保留10分鐘staleTime；在 `specs/019-esign-uat-refinements/quickstart.md` 記錄所有API實例切換與client快取非定時更新的驗收結果。

**Checkpoint**：US4 的上述獨立驗收通過後才標示故事完成；不得以僅完成UI或型別取代端到端驗證。

## Phase 7：US5 移除Email預檢（P1）

獨立驗收：選人零預檢請求；有/無信箱均保留指派，來源故障仍保持草稿。（FR023–025；SC014–015）

- [ ] T031 [P] [US5] 在 `server/test/internal-email-initiation.e2e-spec.ts` 強化混合有/無信箱、skipped/RECIPIENT_UNAVAILABLE、本人仍可簽署及HR來源失敗502保持草稿案例；核對既有發起測試，不重複建立鏡像測試。
- [ ] T032 [US5] 從 `server/src/features/esign/controllers/documents.controller.ts` 移除employee-email-checks及專用注入/import/OpenAPI；刪除 `server/src/features/esign/dto/employee-email-check.dto.ts`，於 `server/src/features/esign/dto/employee-directory-response.dto.ts` 僅移除預檢DTO，保留組織圖/解析與共用envelope。
- [ ] T033 [US5] 移除 `server/src/features/esign/services/esign-employee-email.service.ts` 的checkDraft與專用依賴，更新 `server/src/features/esign/services/esign-employee-email.service.spec.ts`；保留resolveUsers/lookupEmails、每批100/最多4併發及發起用途，不刪上游getStaffEmails。
- [ ] T034 [US5] 將 `server/test/esign-employee-email-checks.e2e-spec.ts` 與 `server/test/internal-email-capacity.e2e-spec.ts` 仍有效的容量/來源失敗/批次驗證移至發起或共用service，刪預檢專用檔並更新 `server/test/jest-e2e.json`；在容量測試保留已移除路由404、OpenAPI無該path且不查HR的驗證。
- [ ] T035 [US5] 執行 `server/test/internal-email-initiation.e2e-spec.ts`、`server/test/internal-email-capacity.e2e-spec.ts` 與service測試；搜尋 `client/src/api` 確認無殘留預檢呼叫，於 `specs/019-esign-uat-refinements/quickstart.md` 記錄結果及Spec018共用HR能力仍保留。

**Checkpoint**：US5 的上述獨立驗收通過後才標示故事完成；不得以僅完成UI或型別取代端到端驗證。

## Phase 8：US6 歷程中文標籤（P1）

獨立驗收：27種已知事件＋未知事件皆中文，補簽actor一致、權限與稽核不變。（FR026–028；SC016–017）

- [ ] T036 [P] [US6] 在 `server/src/features/esign/services/esign-view.mapper.spec.ts` 依 `specs/019-esign-uat-refinements/history-event-inventory.md` 建立27種label與未知事件表格測試，未知回「其他簽署歷程事件」，不依前端字典驗證後端。
- [ ] T037 [US6] 於 `server/src/features/esign/services/esign-view.mapper.ts` 建立單一label映射；`server/src/features/esign/dto/esign-common.dto.ts` 的EsignHistoryItem新增「label: string（必填）」；不改DB event_type、metadata或audit hash。
- [ ] T038 [US6] 在 `server/src/features/esign/services/esign-document-query.service.ts` 所有history分支回label與actor物件；補簽建立人用mapper、非建立人用泛稱actor與reason=null，保留原允許期限欄位及相容裁切，不新增姓名/userId揭露；同步必要DTO/OpenAPI。
- [ ] T039 [US6] 在 `client/src/api/types/esignDocuments.ts` 加label與正確補簽回應型別；修改 `client/src/features/esign-documents/DocumentHistory.tsx` 顯示e.label並刪EVENT_LABEL，保留type分組及EVENT_COLOR，不以原始代碼當fallback。
- [ ] T040 [US6] 擴充並執行 `server/test/esign-signer-management.e2e-spec.ts` 的歷程HTTP：label必填、補簽兩視角actor shape、未知事件、未授權與metadata裁切、audit/hash未變；瀏覽器驗證合併/顏色，在 `specs/019-esign-uat-refinements/quickstart.md` 記錄結果。

**Checkpoint**：US6 的上述獨立驗收通過後才標示故事完成；不得以僅完成UI或型別取代端到端驗證。

## Phase 9：Polish 與整合驗證

六個故事驗收後，完成跨故事權限及交付文件。

- [ ] T041 核對並同步 `specs/006-signer-candidate-org-chart/spec.md`、`specs/010-internal-email-signing/spec.md`、`specs/015-export-history/spec.md` 與其相關contracts中的TTL/預檢/重下載/ZIP舊說明，標記被Spec019取代的範圍；不改寫既有測試證據，最終合約更新於 `specs/019-esign-uat-refinements/contracts/uat-refinements.md`。
- [ ] T042 完成Spec017整合後，在 `server/test/esign-export-history.e2e-spec.ts`、`server/test/esign-export.e2e-spec.ts` 驗證同部門list/count/Excel/PDF/ZIP/status/exportSummary與本人例外；核對Spec018白名單未被預檢移除繞過，記錄 `specs/019-esign-uat-refinements/quickstart.md`，依賴未滿足不得勾完成。
- [ ] T043 依 `specs/019-esign-uat-refinements/quickstart.md` 執行server lint/unit/e2e、client lint、root build/lint及瀏覽器驗收；測試不可執行時如實記錄，不重複擴大無關測試，不聲稱client不存在的test script通過。
- [ ] T044 核對 `specs/019-esign-uat-refinements/tasks.md`、`plan.md`、`data-model.md` 與實際變更一致，更新 `quickstart.md` 驗證證據及部署/回滾步驟；區分完成的程式與尚未執行的UAT ZIP轉換，產出可review差異，不自動部署或寄信。

## Dependencies & Execution Order

- T001 → T002 → T003 → T004；此為設計／環境前置。Spec017尚未實作不阻止局部工作，但阻止最終同部門交付驗收。
- 各故事預設依任務編號依序執行；測試可先撰寫，實作依model/查詢→service→contract→UI→驗收順序。
- US1 → US2 → US3 建議依序整合：共用 export-history.service、export-job.repository、ExportHistoryView 及歷史e2e，不可同時編輯同檔。故事的驗收本身可獨立執行。
- US4、US5 可在Foundational後獨立處理；US5與其他故事共用jest-e2e.json時需串行整合。
- US6 的 document-query.service/esign-common.dto/client esignDocuments.ts 與US2 exportSummary共用，須在US2該檔修改完成後接續或序列套用。
- Phase9依賴所有故事及Spec017整合完成；任何UAT資料轉換依部署手冊另行執行，不是本tasks自動授權操作。

## Parallel Examples

| 故事 | 可並行範例及限制 |
| --- | --- |
| US1 | T007前端Excel改動可與T006後端PDF服務分開進行；兩者以T009整合驗收。 |
| US2 | T017一次性工具可與T014–T016 API/UI工作分開；T018整合工具測試前先完成T017與worker政策。 |
| US3 | T025我的電子簽/共用頁碼處理可與T022–T023歷史後端查詢分開；T024前端整合需等新契約確認。 |
| US4 | T027測試檔可在其他故事獨立檔案工作時先撰寫；T028必須在測試案例定義後執行。 |
| US5 | T031既有發起回歸測試可與US4不同檔案工作並行；T032–T034刪除與測試移轉依序整合。 |
| US6 | T036 mapper測試可與US4/US5並行；T037–T039與US2共用DTO/query/type修改不得並行。 |

## Implementation Strategy

1. MVP：完成Setup/Foundational及US1，先交付「歷史重新下載不新增紀錄」，其餘規則仍按尚未變更的現況。
2. US2是完整切換單位：worker、API、UI與資料轉換工具一起驗證；不得只移除前端期限。
3. US3–US6逐項驗收後再整合，保留既有授權與簽署完整性，避免刪共用HR或maintenance能力。
4. 勾選任務需有實際變更與驗證依據；本檔產生不等於執行任何任務。

## Coverage

| 需求 | 任務範圍 | 成功條件 |
| --- | --- | --- |
| US1 / FR001–006 | T005–T009 | SC001–004 |
| US2 / FR007–012 | T010–T019 | SC005–007 |
| US3 / FR013–019 | T020–T026 | SC008–011 |
| US4 / FR020–022 | T027–T030 | SC012–013 |
| US5 / FR023–025 | T031–T035 | SC014–015 |
| US6 / FR026–028 | T036–T040 | SC016–017 |
