# Tasks: 已簽署 ZIP 按需更新與舊版清除

**Input**: `specs/030-refresh-signed-zip/` 的 spec、plan、research、data-model、contracts 與 quickstart。

**Prerequisites**: 設計已完成；實作前重讀 root/client/server AGENTS.md。

**Tests**: 依 Spec 030 的獨立驗收／SC、plan 的驗證設計及 constitution 檔案存取要求，包含必要 service、並發 e2e、storage 與瀏覽器驗證。先建立能捕捉問題的測試，再實作；不新增 client 測試框架。

**Organization**: 按 US1～US3 分組；全部尚未執行。僅完成某故事可在隔離環境示範，不表示完整功能可發布。

## Format: `[ID] [P?] [Story] Description`

- [P] 表示在該階段前置完成後，可與相鄰、不修改相同檔案的任務並行；不表示忽略依賴。
- 檔案路徑相對 repository root；標示的新測試／validation 文件於該任務建立。
- 不新增 schema、套件、環境變數、排程；不建立遠端 issue／PR，不自動 commit 或部署。

## Phase 1: Setup（範圍與測試準備）

保留使用者變更，沿用既有測試基礎，不安裝新套件。

- [ ] T001 核對現有分支、測試命令與隔離 MySQL／Redis／storage 前置條件，在 specs/030-refresh-signed-zip/quickstart.md 記錄實作驗證入口；不得讀印 secret 或動 UAT 資料。
- [ ] T002 在 specs/030-refresh-signed-zip/validation.md 建立驗證紀錄骨架，對應 SC-001～008、實際命令、待執行及限制；不得預填通過。

## Phase 2: Foundational（共用契約）

完成後才能開始使用者故事；只是擴充型別與契約，不開啟刪檔。

- [ ] T003 在 server/src/features/esign/entities/esign-export-job.entity.ts、server/src/features/esign/entities/esign-file-object.entity.ts 定義／說明新狀態並移除 ZIP expired 相容分支；遵守「status/archiveStatus 既有 varchar 足夠」、「受理後不可變；重試不擴大名單」及「保留完整 reference，deleted 後也不硬刪 metadata」；不新增欄位或 migration。
- [ ] T004 在 server/src/features/esign/dto/export.dto.ts、server/src/features/esign/dto/esign-common.dto.ts 定義 exportState 的 current/work（ExportJobView 或 null）、兩個非負新增數（對應 null 時為 0）及 superseded 投影；保持 exportSummary 相容且不暴露快照。
- [ ] T005 [P] 在 client/src/api/types/esignExports.ts、client/src/api/types/esignDocuments.ts 同步 exportState 與 superseded 型別並移除 ZIP expired 狀態／畫面，保持既有下載及名稱欄位，不新增 force／名單輸入。

## Phase 3: User Story 1 — 有需求才更新 ZIP（P1）

獨立驗收：1 人舊 ZIP 加第 2 人後，讀取只提醒，明確申請才產生 2 份；最新時重下載不新增工作。

- [ ] T006 [US1] 先在 server/src/features/esign/services/esign-export.service.spec.ts 補按需申請與摘要測試：無新增沿用、同數不同 ID、PDF ready／改名不重包、只讀不寫入、舊 current 與新 work 分離，確認舊行為失敗。
- [ ] T007 [P] [US1] 在 server/test/esign-export.e2e-spec.ts 補無簽署、1→2 人、只讀新增 100 簽署不建工作、最新下載 10 次無新歷史及舊 ZIP 缺檔的測試；解壓驗證正確個人 PDF，替換永久沿用的舊斷言。
- [ ] T008 [US1] 在 server/src/features/esign/repositories/export-job.repository.ts 拆分 current/work 選取與窄 ID 查詢，排除 superseded，遵守「缺檔仍保持其識別供錯誤呈現，不退回較舊成果」；舊 failed 不遮住較新成功版。
- [ ] T009 [US1] 在 server/src/features/esign/services/esign-export.service.ts 實作後端紀錄 ID 差集、單次名單固定及按需建立；依文件鎖驗權並先共用進行中工作，latest failed 回原工作供重試；有新增可更新缺檔 current，無新增缺檔回不可用。
- [ ] T010 [US1] 在 server/src/features/esign/services/esign-document-query.service.ts 與 server/src/features/esign/services/esign-export.service.ts 組合一致性 exportState、exportSummary=work??current 和列表 latestExportSummary；新增數只在匯出預覽計算，避免歷史或輪詢載全份 metadata。
- [ ] T011 [US1] 在 server/src/features/esign/controllers/exports.controller.ts 更新 POST 回應與 OpenAPI：進行中／新工作 202、completed／failed 沿用 200；failed 不宣稱產檔成功，GET 不觸發產製。
- [ ] T012 [US1] 在 client/src/features/esign-documents/DocumentExportView.tsx 與 client/src/features/esign-documents/ZipExportPanel.tsx 接入 exportState，呈現無檔／最新／過時與後端新增數；新增「更新並下載 ZIP」，明確保留舊版份數下載，名稱變動不觸發產製。
- [ ] T013 [US1] 執行本故事 service/e2e 與瀏覽器 1→2 人示範，將實際結果、ZIP entries 及未執行原因追加至 specs/030-refresh-signed-zip/validation.md；不宣稱已完成 US3 清理。

## Phase 4: User Story 2 — 固定本次成果與並行共用（P1）

獨立驗收：13 份處理時加入第 14 人，10 人重複申請仍同工作，完成可下載 13 份且不自動重做。

- [ ] T014 [US2] 先在 server/test/esign-export.e2e-spec.ts 補 10 個並發申請、申請與簽署交錯、13→14 固定範圍、等待來源、queue 加入失敗恢復及失敗重試測試，確認每案具工作數與快照斷言。
- [ ] T015 [US2] 在 server/src/features/esign/services/esign-export.service.ts 完成 request/retry 的文件→工作鎖序，適用重試保持同 ID／快照；舊 completed 不截走新 failed，過時 failed／superseded／完整性失敗拒絕，其他進行中工作直接共用。
- [ ] T016 [US2] 在 server/src/worker/esign/document-export.processor.ts 保留固定 snapshot 的等待來源、租約及串流驗證，確保不重查簽署範圍或自動排下一版；失敗與重送只處理原工作，不改原個人 PDF。
- [ ] T017 [US2] 在 client/src/api/queries/esignExports.ts 與 client/src/features/esign-documents/ZipExportPanel.tsx 固定 requestedId、進行中輪詢與重開恢復；終態刷新預覽／文件／歷史快取並停止輪詢，避免 effect 自動 mutation。
- [ ] T018 [US2] 在 client/src/features/esign-documents/ZipExportPanel.tsx 分離「下載本次成果」與「再次更新」，13 份完成仍可直接下載；failed 僅提供適用重試，處理中及失敗時原 current 可下載且標示份數。
- [ ] T019 [US2] 執行雙 session／離頁返回／13→14 與並發測試，將工作 ID、固定範圍、零自動續包與重試結果追加至 specs/030-refresh-signed-zip/validation.md。

## Phase 5: User Story 3 — 新版取代與舊檔清理（P1）

獨立驗收：新版成功才停用刪除舊 ZIP；新版失敗舊版可用；刪檔失敗與 crash 可補清理，歷史保留。

- [ ] T020 [US3] 先在 server/test/export-retention.e2e-spec.ts 補發布前失敗、發布後 crash、刪檔失敗、刪成功回寫前 crash、重複清理與參照保護測試，確認新版及個人 PDF 不受影響。
- [ ] T021 [P] [US3] 先在 server/test/esign-export-history.e2e-spec.ts 補已取代歷史／名稱不變、prepare／直接下載／Range 拒絕舊版與跨部門／錯文件拒絕測試，不以重新導向新版作通過。
- [ ] T022 [US3] 在 server/src/features/esign/repositories/export-job.repository.ts 與 server/src/features/esign/repositories/file-object.repository.ts 實作同文件較舊曾成功工作及 ZIP 查詢、superseded/delete_pending 條件式轉移；保留 completedAt／歷史及 reference，禁止反向轉 active。
- [ ] T023 [US3] 在 server/src/worker/esign/document-export.processor.ts 實作新版確認可用後的短交易發布：先 document 後工作鎖、重驗租約／文件／合法工作、儲存新 active/completed 並同交易停用舊版；交易失敗不清舊檔，storage I/O 不持長鎖。
- [ ] T024 [US3] 在 server/src/common/errors/app-error-code.ts、server/src/common/errors/app-errors.ts、server/src/features/esign/services/esign-export.service.ts 與 server/src/features/esign/controllers/exports.controller.ts 實作 ESIGN_EXPORT_SUPERSEDED 409，先驗權再判舊版；superseded files=[]，prepare／GET／Range 均拒絕，既有傳輸不持長鎖。
- [ ] T025 [US3] 在 server/src/features/esign/services/esign-export-history.service.ts、client/src/api/errorCodes.ts、client/src/features/export-history/ExportHistoryView.tsx 與 client/src/features/esign-documents/ZipExportPanel.tsx 呈現已被取代且無下載／重試，保留原歷史資訊；收到取代錯誤僅刷新摘要，不自動打包。
- [ ] T026 [US3] 在 server/src/worker/esign/document-export.processor.ts 加入發布成功後獨立清理與 maintain 補清理：僅 superseded+delete_pending+signed_copies_zip，以完整 objectVersion reference 刪除並條件式標 deleted；先確認無 active/staging 引用，清理錯誤不得落回產製 failed catch。
- [ ] T027 [US3] 在 server/src/features/esign/repositories/export-job.repository.ts 完成待清理有界查詢：每輪最多 50 工作、nextAttemptAt/id 排序、失敗延後 60 秒、全清完排除；原 pending/waiting 的時間語意與既有 orphan sweep 保持相容，避免失敗首批造成飢餓。
- [ ] T028 [US3] 在 server/test/s3-export.e2e-spec.ts 補 S3 指定版本真正不存在與中斷重入測試，並執行 server/test/export-retention.e2e-spec.ts 的隔離 local 實體刪除驗證；記錄結果於 specs/030-refresh-signed-zip/validation.md，不以 mock/delete marker 代替清除證據。

## Phase 6: Polish & Cross-Cutting Concerns（整合交付）

三個故事均完成才能交付；本輪只產生任務，不執行以下驗收或部署。

- [ ] T029 在 server/test/esign-export.e2e-spec.ts 完成既有多版／最新缺檔相容與無批次重包測試，加入 6,000 份代表性 PDF 的背景更新驗證，記錄耗時／峰值記憶體與產物完整性至 specs/030-refresh-signed-zip/validation.md。
- [ ] T030 [P] 在 docs/deployment/uat-cicd.md 記錄 030 同版 client/API/worker 切換、舊 worker 停止消費／退出、既有資料不批次變更、修正版回復及已刪 ZIP 不可復原；無新增 env／migration，不執行部署。
- [ ] T031 依 specs/030-refresh-signed-zip/quickstart.md 執行最終跨故事瀏覽器驗收、非授權及資料邊界檢查；涵蓋雙 session 取代、名字獨立、舊連結與刪檔恢復，把實際證據追加至 specs/030-refresh-signed-zip/validation.md。
- [ ] T032 完成對應 server unit/e2e/storage、client lint、root pnpm build／pnpm lint，核對所有結果並更新 specs/030-refresh-signed-zip/validation.md 與 specs/030-refresh-signed-zip/quickstart.md；未能執行的 DB/S3/容量驗證明列限制，不標通過。

## Dependencies & Execution Order

```text
Setup T001–T002
  → Foundational T003–T005
  → US1 T006–T013
  → US2 T014–T019
  → US3 T020–T028
  → 整合 T029–T032
```

- T003 後 T004/T005 可分 server/client 同步；所有故事等基礎契約完成。
- US1：T006/T007 先建立失敗訊號；T008→T009→T010→T011→T012→T013。T007 與 T006 檔案不同可並行。
- US2 依 US1 的申請及摘要；T014→T015→T016→T017→T018→T019。共用 service、processor、UI 檔案，不跨故事同時修改。
- US3 依 US2 的穩定工作與重試；T020/T021 可並行，T022→T023→T024→T025→T026→T027→T028。T023 發布與 T026 清理為同一交付不可缺一。
- T029 依三個故事；T030 可與 T029 並行，T031 在功能完成後驗收，T032 最後核對交付。
- 測試資料與功能串接可能要求後段任務完成才全綠；每階段應記錄已證實範圍，不以 mock 通過替代完整發布／刪除驗證。

## Parallel Examples

- **US1**：T006 service 測試與 T007 e2e 情境可並行；實作依序接起，避免同一 repository/service 檔案衝突。
- **US2**：T014 後，測試情境的瀏覽器驗收腳本準備可與後端工作並行，但 T015～T018 共用流程，預設依序執行；沒有無前置依賴的實作並行組。
- **US3**：T020 retention 故障測試與 T021 history/HTTP 測試可並行；同一 processor 的發布與清理順序完成，不能同時改檔。
- **整合**：T030 部署文件可與 T029 相容／容量測試並行；兩者都不授權部署。

## Requirements Traceability

| 規格 | 任務 |
| --- | --- |
| FR-001、FR-002 | T006–T013、T017–T019 |
| FR-003、FR-004 | T006–T011、T029 |
| FR-005、FR-006 | T014–T016、T019 |
| FR-007、FR-008 | T014、T016–T019 |
| FR-009 | T014–T016、T018–T020 |
| FR-010、FR-011、FR-012 | T020、T022–T023、T026–T028 |
| FR-013 | T021、T024–T025 |
| FR-014 | T004、T009–T010、T021、T024、T031 |
| FR-015 | T008–T009、T022–T023、T029–T030 |
| FR-016 | T006、T012、T021、T025、T031 |
| SC-001、SC-002 | T007、T013 |
| SC-003、SC-004 | T007、T014、T019 |
| SC-005、SC-006 | T020、T028 |
| SC-007 | T021、T025、T031 |
| SC-008 | T029 |

## Implementation Strategy

1. 先完成共用型別及 US1，作為按需更新的最小示範，證明 1→2 份及無變更沿用。
2. US2 補足固定範圍、並發、重試、離頁恢復，避免持續簽署造成重做。
3. US3 完成安全切換、舊檔清理及補償，才能滿足完整使用者需求。
4. 三個故事皆 P1，實際發布的最小範圍必須包含 US1+US2+US3 與最終驗證；不能只發布按需更新而遺漏清理保護。
5. 若拆成本機 tickets，可跨任務分組形成垂直可驗收切片；以 ticket Blocked by 為領取依據，所有功能先整合再發布。未通過的項目保持未勾選並記錄原因。
