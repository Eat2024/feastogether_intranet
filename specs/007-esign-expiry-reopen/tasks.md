# Tasks: 文件已到期狀態與補簽

**Input**: `specs/007-esign-expiry-reopen/` 的 spec、plan、research、data-model、contracts/http-api 及 quickstart。

**Branch**: `007-esign-expiry-reopen`，基底為更新後的 `dev`（`b9ae324`）。

**Scope**: 本次實作任務交付後端、migration 與前端串接契約；前端正式 API 串接依 plan 另開 PR。後端任務已實作並依下方驗證配置驗收；不因已有 mock 而宣稱前端完成。

**Tests**: 依專案 Constitution V、server/AGENTS.md 及本規格的截止、授權、重放與證據驗收要求安排測試。相關測試先加入並確認能揭露未實作行為，再實作；不新增測試框架。

**Format**: `- [x] Tnnn [P?] [USn?] 說明與檔案路徑`。[P] 僅代表前置條件完成後可與同階段不同檔案的工作並行，不授權略過依賴或共改檔案。

## Phase 1: Setup

**目的**：確認功能基準與測試環境，不建立新專案或安裝新套件。

- [x] T001 對照 `specs/007-esign-expiry-reopen/plan.md` 與 `server/AGENTS.md` 確認實作基準、既有 finalizing／個人副本流程及檔案位置；只記錄會影響本功能的差異，不順便重構。
- [x] T002 確認 `server/test/schema-migration.e2e-spec.ts` 與 `server/test/core-esign-flow.e2e-spec.ts` 的既有合成資料及初始化可復用，將 MySQL／Redis／測試 DB 名稱保護與可執行指令記錄於 `specs/007-esign-expiry-reopen/quickstart.md`，不得使用正式資料。

## Phase 2: Foundational

**目的**：先備妥狀態、錯誤及稽核共用契約。完成本階段才開始各故事。

- [x] T003 在 `server/src/features/esign/entities/esign-document.entity.ts`、`server/src/infrastructure/database/schema.sql` 與新增 `server/src/infrastructure/database/migrations/1792368000000-ExpiredDocuments.ts` 擴充 status 為「draft / active / expired / finalizing / completed / stopped」；只改 CHECK，不新增欄位、不改既有 stopped。down 遇 expired 或 document.reopened 歷史即拒絕；在 `server/test/schema-migration.e2e-spec.ts`、`server/test/schema-constraints.e2e-spec.ts`、`server/src/features/esign/entities/schema-metadata.spec.ts` 驗證 up/down/up 與有資料時拒絕回滾。（FR-001、016）
- [x] T004 [P] 在 `server/src/common/errors/app-error-code.ts`、`server/src/common/errors/app-errors.ts` 與 `server/src/common/errors/app-errors.spec.ts` 定義補簽輸入 400、期限已變更 409、不可補簽 409 與穩定繁體中文訊息，沿用 401／404／完整性錯誤，不洩漏 token 或文件存在性。（FR-017）
- [x] T005 [P] 在 `server/src/features/esign/services/esign-audit.service.ts` 及其 `.spec.ts` 擴充 previousSignEndAt、signEndAt、expiredAt 日期白名單；原因「trim 後 1–500 個 Unicode code points」，不得以 UTF-16 slice 截斷；沿用文件鎖與 hash-chain，不建立補簽表。（FR-007、015）

## Phase 3: US1 — 文件到期後保留補簽可能性（P1）

**Goal**：到期顯示 expired 並禁止新增簽署，已簽證據與個人副本維持可用。

**Independent Test**：讓部分已簽文件跨過期限，先暫停 worker，再恢復；查詢／篩選／簽署結果始終正確，只有一筆到期事件且沒有永久停止。

- [x] T006 [P] [US1] 在 `server/src/features/esign/services/esign-document-validation.service.spec.ts` 與 `server/src/features/esign/services/esign-view.mapper.spec.ts` 覆蓋截止前／等於／之後、pending=0、null 期限、finalizing／completed／stopped、同一 now，以及原期限／補簽標記投影。（FR-001、002、014）
- [x] T007 [P] [US1] 在 `server/src/worker/esign/esign-maintenance.processor.spec.ts` 與新增 `server/src/features/esign/services/esign-expiry.service.spec.ts` 覆蓋批次 100 筆、重複執行、延遲掃描、新期限競態、未簽邀請清除、已簽證據不變及 expired 稽核，不再預期 stopped_by_deadline。（FR-001、009、015）
- [x] T008 [US1] 在 `server/src/features/esign/services/esign-document-validation.service.ts`、`server/src/features/esign/services/esign-view.mapper.ts`、`server/src/features/esign/dto/esign-common.dto.ts`、`server/src/features/esign/dto/document-query.dto.ts` 實作有效狀態與投影：active＋pending>0＋now>=signEndAt 才呈現 expired；「originalSignEndAt：DTO 投影自固定 payload；草稿為 null」、「isReopened：已發起且有效期限不同於原期限；草稿為 false」；不修改 payload/hash。（FR-001、006、014）
- [x] T009 [US1] 在 `server/src/features/esign/services/esign-expiry.service.ts`、`server/src/features/esign/services/esign-stoppage.service.ts`、`server/src/features/esign/repositories/document.repository.ts` 與 `server/src/worker/esign/esign-maintenance.processor.ts` 將到期從永久停止分離：鎖內重讀狀態／期限／pending，轉 expired 並清未簽邀請；occurredAt 為處理時間、expiredAt 為截止時間，不填 stoppedAt／stopReason；提供同交易可復用的到期轉換供補簽使用，不新增排程。（FR-001、002、009、015）
- [x] T010 [US1] 在 `server/src/features/esign/services/esign-document-query.service.ts`、`server/src/features/esign/services/esign-signing-task.service.ts`、`server/src/features/esign/services/external-access.service.ts` 統一摘要與有效期限，先算有效狀態再篩選，單次請求共用 now；保留 expired 的內部 pending 列表且 GET 不寫業務資料。於 `server/test/core-esign-flow.e2e-spec.ts` 驗證 worker 延遲時列表與篩選。（FR-008、014）
- [x] T011 [US1] 在 `server/src/features/esign/services/esign-signing.service.ts` 及其 `.spec.ts` 確保昂貴驗證後、建立證據前重新驗證截止且使用一致簽署時間，合法重送回傳有效 documentStatus；在 `server/src/features/esign/services/completed-pdf.service.ts`、`server/src/worker/esign/document-finalization.processor.ts`、已簽者 source validation 與其既有測試加入 expired 白名單，保留 finalizing → completed。（FR-002、006）

**Checkpoint**：US1 可獨立驗收；此時仍沒有完整補簽入口，不宣稱補簽功能完成。

## Phase 4: US2 — 建立人重新開放補簽（P1）

**Goal**：建立人更新期限、保留原證據與歷程，支援多輪且不會重複開放。

**Independent Test**：以只有內部簽署人的文件驗證兩輪補簽、最後完成、授權失敗、同輪與跨輪重送及交易回滾。完整外部流程待 US3。

- [x] T012 [P] [US2] 新增 `server/src/features/esign/services/esign-reopening.service.spec.ts`，覆蓋建立人權限、到期 active／expired、完整性失敗、同輪與跨輪 expectedSignEndAt、兩輪補簽、null／已完成／已停止／finalizing、固定證據不變及中途失敗回滾。（FR-003–007、011、012、016）
- [x] T013 [P] [US2] 新增 `server/src/features/esign/dto/reopening.dto.ts` 及其 `.spec.ts`，限定 expectedSignEndAt、signEndAt 為「帶明確時區、最多毫秒精度的 ISO 8601 時間」，reason 為「trim 後 1–500 個 Unicode code points」；拒絕未知業務欄位、不接受新開始時間或簽署人，使用 T004 錯誤。（FR-004、017）
- [x] T014 [US2] 在 `server/src/features/esign/repositories/notification.repository.ts`、`server/src/features/esign/repositories/signer.repository.ts` 加入補簽所需既有記錄鎖定／保存操作：文件鎖先行，notification log → signer 且固定 ID 順序；準備舊通知 failed／INVITATION_SUPERSEDED、清 lease／nextAttemptAt／記 completedAt，不刪 delivered 歷史。（FR-011、012）
- [x] T015 [US2] 新增 `server/src/features/esign/services/esign-reopening.service.ts` 並於 `server/src/features/esign/esign.module.ts` 註冊；依 data-model 交易順序驗證建立人、expectedSignEndAt、pending、快照 hash 與「new > now >= old」，必要時同交易補到期事件，更新 signEndAt、退休舊通知、替 pending email signer 輪替憑證並追加 reopened。保持 signStartAt／payload／signed 證據不變，不建立通知工作；所有操作使用同一 EntityManager。（FR-003–007、009、011、012）
- [x] T016 [US2] 在 `server/src/features/esign/controllers/documents.controller.ts` 加入 `POST :documentId/reopenings`，沿用員工 session、OriginGuard 與建立人權限；回傳契約的 201 交易摘要，不提交後讀 PDF、不重複包 envelope；在 `server/test/api-coverage.e2e-spec.ts` 登錄端點。（FR-003–005、017）
- [x] T017 [US2] 在 `server/test/core-esign-flow.e2e-spec.ts` 與 `server/test/security-core-esign-flow.e2e-spec.ts` 驗證 POST 契約、401／403／404／400／409、兩輪與舊要求重放、真實 DB 同時補簽／到期／停止／最後簽署、回應遺失與回滾；成功補簽最多一次且原證據／副本雜湊不變。（FR-006、011、012；SC-002–004）

**Checkpoint**：內部補簽可獨立驗收；在 US3 舊通知防護完成前不得部署含外部簽署人的補簽功能。

## Phase 5: US3 — 未簽署者使用正確的補簽資格（P1）

**Goal**：內部原入口可續簽，外部使用新邀請；舊連結、cookie 與舊寄信工作不能影響新輪。

**Independent Test**：混合內外部簽署文件完成補簽；新邀請可簽、舊邀請不可簽、到期／簽完／停止後不能續用，且沒有自動通知。

- [x] T018 [P] [US3] 在 `server/src/features/esign/services/external-access.service.spec.ts` 與 `server/src/features/esign/services/esign-access-policy.service.spec.ts` 覆蓋舊 token／cookie、補簽新 token 的文件與簽署人綁定、期限、簽完／停止失效；不得為過期外部邀請放寬詳情或來源檔資格。（FR-009）
- [x] T019 [P] [US3] 在 `server/src/worker/esign/external-invitation.processor.spec.ts` 覆蓋舊 pending／failed／processing log 被退休後不寄送新 token，舊成功／失敗回寫不覆蓋新密文，以及 errorCode=null 的原通知仍可重試。（FR-009–012）
- [x] T020 [US3] 在 `server/src/features/esign/repositories/notification.repository.ts` 與 `server/src/worker/esign/external-invitation.processor.ts` 於 scanner／claim 排除 INVITATION_SUPERSEDED，保留 SQL NULL 錯誤碼；回寫重驗 lease、claim digest 與期限，退休後不能清新密文或恢復舊通知；不新增通知狀態、欄位或排程。（FR-009–012）
- [x] T021 [US3] 在 `server/src/features/esign/services/esign-document-query.service.ts`、`server/src/features/esign/controllers/documents.controller.ts` 新增 creator-only `GET :documentId/reopening-invitations`，使用既有 `server/src/features/esign/services/esign-token.service.ts` 解密與站台設定組 URL；僅回 signerPublicId／invitationUrl／expiresAt，無符合者 `[]`，應有密文卻損毀時報錯不重建。加入 private,no-store 與 no-referrer，GET 不寫入；補簽輪 invitationDelivery=null。（FR-008–010、014、017）
- [x] T022 [US3] 在 `server/test/core-esign-flow-queue.e2e-spec.ts`、`server/test/security-core-esign-flow.e2e-spec.ts` 與 `server/test/api-coverage.e2e-spec.ts` 驗證混合簽署流程、新邀請 GET 重讀穩定、401／404／空陣列／密文錯誤、舊 worker 回寫、零新通知工作，以及回應／日誌／錯誤敏感資訊裁切。（SC-005、006）

## Phase 6: US4 — 歷程追溯與永久停止（P2）

**Goal**：建立人看完整補簽歷程，停止仍不可恢復；簽署人看不到內部原因與操作者。

**Independent Test**：已有兩輪補簽的文件，比對建立人與簽署人的歷程後將文件停止；任何補簽皆被拒絕，歷史與證據不變。

- [x] T023 [P] [US4] 在 `server/src/features/esign/services/esign-stoppage.service.spec.ts` 覆蓋 expired 可停止、active／finalizing 原行為保留、舊到期 stopped 不恢復；在新增 `server/src/features/esign/services/esign-document-query.service.spec.ts` 覆蓋兩輪歷程、建立人完整欄位與簽署人省略 reason／actor／actorUserId／previousSignEndAt。（FR-007、008、013、016）
- [x] T024 [US4] 在 `server/src/features/esign/services/esign-document-validation.service.ts`、`server/src/features/esign/services/esign-stoppage.service.ts` 允許 active／expired／finalizing 人工停止，停止成立後清未簽資格並拒絕補簽；在 `server/src/features/esign/services/esign-document-query.service.ts` 與 `server/src/features/esign/repositories/audit-event.repository.ts` 實作依追加順序的完整補簽歷程與逐角色 DTO 裁切，不透傳 metadataJson。（FR-007、008、013、015、016）
- [x] T025 [US4] 在 `server/test/core-esign-flow.e2e-spec.ts` 與 `server/test/security-core-esign-flow.e2e-spec.ts` 驗證停止與補簽競態、舊 stopped、兩輪歷程 hash-chain、建立人與簽署人可見欄位、到期後已簽者仍可下載個人副本及驗證既有簽章。（SC-002、004–006）

## Phase 7: Polish 與交付驗證

- [x] T026 更新 `specs/003-core-esign-flow/spec.md`、`specs/003-core-esign-flow/data-model.md`、`specs/003-core-esign-flow/research.md`、`specs/003-core-esign-flow/quickstart.md` 的到期與補簽新規則；在 `specs/003-core-esign-flow/tasks.md` 保留舊完成紀錄並加 Spec 007 取代註記，不把舊驗收當作新行為。（FR-001、015）
- [x] T027 [P] 同步 `specs/003-core-esign-flow/contracts/openapi.yaml` 與 `specs/007-esign-expiry-reopen/contracts/http-api.md`，核對實作 Swagger 的新狀態、兩個端點、歷程裁切、錯誤及摘要；在後者列明獨立前端 PR 的 `client/src/features/forms/ResignButton.tsx`、`client/src/features/forms/actions.ts`、`client/src/features/my-signature/tasks.ts` 接線需求與未完成限制，不改 mock 為假串接。
- [x] T028 執行 `specs/007-esign-expiry-reopen/quickstart.md` 的 server lint:check／test／build／schema／e2e／security 檢查，逐一記錄結果、未執行原因及 SC-001–006 覆蓋；保留測試 DB fail-closed 防護，不為驗證修改正式資料。
- [x] T029 在 `specs/007-esign-expiry-reopen/quickstart.md` 與 `specs/007-esign-expiry-reopen/plan.md` 記錄部署順序（停止舊 expiry worker、migration、更新 HTTP／worker）、受限回滾、前後端交付狀態與無新增 config／dependency；檢查實際 diff 未含 secret 或任務外檔案，不自動部署。

## Dependencies & Execution Order

```text
Setup T001–T002
  → Foundational T003–T005
  → US1 T006–T011
  → US2 T012–T017
  → US3 T018–T022
  → US4 T023–T025
  → Polish T026–T029
```

- 各故事能用獨立資料驗收，但並非無依賴：US2 依賴 US1 的到期交易與有效狀態；US3 依賴 US2 的輪替；US4 的歷程驗收依賴 US2。
- US4 的停止測試與實作可在 US1 完成後提前，但會修改 US1／US2 共用 validation／query，必須序列整合。
- T015 的外部憑證輪替與 T020 的舊通知防護是一個部署單位，不能中途上線。
- 每故事測試先於對應實作；先紅後綠。T017、T022、T025 為各自故事整合關卡，通過再進下一階段。
- T028 在文件與實作整合完成後執行；T029 記錄實際結果，不預先宣稱驗證或部署完成。

## Parallel Examples

- 基礎：T004 錯誤定義與 T005 稽核白名單處理不同檔案，可並行；都須在 DTO／服務實作前完成。
- US1：T006 validation／mapper 測試與 T007 expiry／maintenance 測試可並行；T008–T011 因共用狀態與服務責任依序整合。
- US2：T012 service 測試與 T013 DTO 測試／實作可並行；T014 → T015 → T016 → T017 依序。
- US3：T018 access 測試與 T019 worker 測試可並行；T020、T021 在各自測試完成後可分開處理，整合後才執行 T022。
- US4：T023 中 stoppage 測試與 query 測試可分檔並行；T024 的實作與 T025 整合驗證依序。
- 文件：T026 與 T027 觸及不同檔案，可並行；不與同一檔案的實作任務同時編輯。

## Implementation Strategy 與範圍判定

先完成 US1 作為可獨立展示的到期狀態增量；它不是完整的補簽 MVP。對內部簽署的核心演示至少完成 US1＋US2；本次完整後端交付須完成 US1–US4 及全部驗證。前端正式串接由獨立 PR 交付，產品端完整驗收待該 PR 完成。

不建立新表、輪次欄位、通用冪等框架、自動通知或新排程。不擴充尚未到期延期、預約開始、管理者代操作或舊 stopped 恢復。新增檔案僅限上述 DTO／service／測試／migration；可復用既有測試時直接擴充。

## Requirement Coverage

| 需求 | 主要任務 |
| --- | --- |
| FR-001、002 | T003、T006–T011 |
| FR-003、004、005 | T004、T012–T017 |
| FR-006 | T008、T011、T015、T017、T025 |
| FR-007、008 | T005、T015、T023–T025 |
| FR-009、010 | T007、T009、T014–T015、T018–T022 |
| FR-011、012 | T014–T017、T019–T020、T022、T025 |
| FR-013、016 | T003、T012、T023–T025 |
| FR-014 | T006、T008、T010、T021、T027 |
| FR-015 | T005、T009、T015、T024–T026 |
| FR-017 | T004、T013、T016–T017、T021–T022 |

29 項任務：Setup 2、Foundational 3、US1 6、US2 6、US3 5、US4 3、Polish 4。勾選代表後端任務完成；驗證結果見 quickstart，前端正式串接仍另行交付。

### Ticket 01 驗證配置

T007 的批次 101 筆、並發到期、重跑與新期限防護採 core-esign-flow 真實 DB/HTTP 測試，取代 mock repository 的 expiry 單元測試。已簽副本與重送有效狀態亦在同套件驗收。T023–025 的到期人工停止部分已交付，補簽與歷程裁切留待 ticket 02。

### Ticket 02 驗證配置

T012／T017／T018／T022／T023／T025 的跨服務行為集中在既有 core-esign-flow 真實 DB/HTTP seam：包含權限、格式、交易失敗回滾、兩輪內外部補簽至 completed、原證據與副本 bytes 不變、公開簽章驗證、新舊邀請與 cookie、歷程裁切、並發補簽／到期／停止及舊 processing 通知回寫。服務單元測試補足狀態及不完整快照；DTO 單元測試覆蓋日期與 Unicode。這取代額外建立 query mock 單元測試或複製 security/queue fixture。API coverage 自動讀正式 OpenAPI，因此兩個端點已納入 session 邊界驗證。舊通知成功／失敗與退休狀態另由 worker 單元測試覆蓋，NULL errorCode scanner 及實際 processing claim 由 DB 測試驗證。測試檔案位置調整不縮減驗收行為。
