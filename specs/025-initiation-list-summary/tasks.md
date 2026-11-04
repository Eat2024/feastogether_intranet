# Tasks: 發起受理後立即顯示文件列表摘要

**Input**: [spec.md](spec.md)、[plan.md](plan.md)、[data-model.md](data-model.md)、[contracts/list-summary.md](contracts/list-summary.md)、[quickstart.md](quickstart.md)。

**Tests**: 規格與 plan 已要求正常、授權、競態及容量驗證；本清單包含對應測試，不新增 client 測試框架。

**Scope**: 延伸已合併 PR #50；無新資料表、migration、環境變數或背景排程。沿用既有 worker 寫入及異動保護。

## Phase 1: Setup

- [x] T001 核對整合基線已包含 PR #49／#50 與隔離測試連線，將 commit、環境與驗收記錄位置寫入 specs/025-initiation-list-summary/validation.md；不得將實際憑證寫入文件。

## Phase 2: Foundational

- [x] T002 在 server/src/features/esign/dto/esign-common.dto.ts 與 client/src/api/types/esignDocuments.ts 對齊列表 initiation nullable 摘要；保留「totalCount 為正整數，日期為 normalize 後的有效 ISO 值且 start < end」及「原 pendingCount、signedCount、signStartAt、signEndAt 維持原正式／草稿語意」。同步 client/src/api/requests/esignDocuments.ts 的發起回應型別為既有 job 摘要，不新增 endpoint。

## Phase 3: US1 — 受理後立即確認發起內容（P1）

**Goal**: 背景未執行時即可返回列表，看到確認的日期、發起中及 0/N。
**Independent Test**: 暫停本機 worker，提交與舊草稿不同的期間及名單，首次列表即呈現本次摘要。

- [x] T003 [P] [US1] 在 server/src/features/esign/services/esign-document-query.service.spec.ts 新增摘要映射測試，覆蓋受理期間優先於舊草稿、totalCount 與正式計數分離、非發起中摘要為 null；先確認新增案例能揭露現況缺口。
- [x] T004 [US1] 在 server/src/features/esign/repositories/document.repository.ts 增加有效任務 ID／totalCount 的窄欄位投影及依捕捉 job ID 的批次無排序日期抽取；不載入完整 inputJson、不把 JSON_EXTRACT 放進排序查詢、不做逐文件查詢。
- [x] T005 [US1] 在 server/src/features/esign/services/esign-document-query.service.ts 將列表所有讀取放進同一短 REPEATABLE READ 交易並傳遞同一 manager；在 server/src/features/esign/services/esign-view.mapper.ts 僅為 draft＋有效任務輸出 initiation 摘要，不寫回 entity 正式欄位。
- [x] T006 [P] [US1] 在 client/src/features/esign-documents/listQuery.ts 集中摘要期間與顯示計數選擇，在 client/src/features/esign-documents/DocumentsTable.tsx 顯示摘要日期、0/N、0% 及預計人數說明；缺少摘要時保留既有顯示，不捏造數字。另在文件編號與開始時間之間新增「建立時間」，取 createdAt 以台北時間 YYYY/MM/DD HH:mm 顯示，同步表頭、欄數與空／載入狀態 colSpan，不改預設排序。
- [x] T007 [US1] 在 client/src/features/esign-documents/DocumentSignersEditor.tsx 保存本次已提交期間，以 queued／processing 回應的 totalCount 初始化列表快取，再 invalidate 並導回列表；不得等待正式資料建立或建立重複文件列。
- [x] T008 [US1] 在 server/test/esign-initiation-acceptance.e2e-spec.ts 驗證受理提交後即能取得摘要、單人與多人、不同草稿資料、不可靠受理不產生假摘要；依 specs/025-initiation-list-summary/quickstart.md 完成首次列表瀏覽器驗收，並確認 createdAt 在草稿、發起中、完成後顯示相同及窄螢幕可讀，將證據寫入 validation.md。

**Checkpoint**: US1 可端到端示範；不因工作受理而提前開放簽署。

## Phase 4: US2 — 重整與閱讀權限一致（P1）

**Goal**: 重整與原有讀者看見一致摘要；篩選、日期排序及異動限制不產生矛盾。
**Independent Test**: 排隊期間重新開啟頁面，以同部門可讀與不可讀帳號分別驗證。

- [ ] T009 [P] [US2] 在 server/test/esign-initiation-query.e2e-spec.ts 覆蓋建立人、原可讀同部門與不可讀者的列表摘要／initiating 篩選，確認不回傳 inputJson、名單、信箱、租約或憑證；重讀仍顯示相同期間與人數。
- [ ] T010 [P] [US2] 在 client/src/features/esign-documents/listQuery.ts 將日期篩選及排序改用 US1 的顯示期間 helper，並在 validation.md 記錄重整、多分頁、窄螢幕與日期時區人工驗收。
- [ ] T011 [US2] 在 server/test/esign-initiation-locks.e2e-spec.ts 與 client/src/features/esign-documents/DocumentRowActions.tsx 核對既有發起中保護；對排隊、執行及重試等待驗證文件／簽署人異動、刪除、重複發起及提前簽署仍被阻擋；僅在回歸失敗時修正本功能造成的缺口。

**Checkpoint**: 不依賴發起者暫存畫面，且未擴大讀寫權限。

## Phase 5: US3 — 終態切換與競態（P2）

**Goal**: 成功改正式結果、失敗恢復草稿，暫時重試保留摘要，舊回應不得覆蓋新結果。
**Independent Test**: 使用合成工作依次驗證成功、最終失敗、自動重試及快速完成。

- [ ] T012 [P] [US3] 在 server/test/esign-initiation-query.e2e-spec.ts 增加兩連線協調的讀取／worker 提交競態案例：同一列表回應不混用任務與正式統計，下一次讀取收斂；覆蓋 succeeded／failed 移除摘要與 queued 重試保留摘要。
- [ ] T013 [US3] 在 client/src/features/esign-documents/DocumentSignersEditor.tsx 防止較晚回來的受理回應將正式狀態降回 initiating；終態回應只刷新，未收到成功回應不合成摘要。
- [ ] T014 [US3] 在 client/src/api/queries/esignDocuments.ts 核對既有輪詢於終態停止且離頁不持續更新；依 specs/025-initiation-list-summary/quickstart.md 驗證成功／失敗 5 秒內切換、網路錯誤不冒充終態與寄信略過不影響文件狀態，將結果記入 validation.md；不新增失敗詳情或重試 UI。

**Checkpoint**: 任務與正式文件狀態一致，操作限制依終態正確恢復。

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T015 在 server/test/esign-document-list-scale.e2e-spec.ts 增加 5213 人 inputJson、256 KiB sort buffer 與多文件案例，驗證只投影小欄位、無排序 JSON 查詢、無 N+1，並確認讀取快照不阻塞 worker 寫入。
- [ ] T016 依 specs/025-initiation-list-summary/quickstart.md 執行 1／100／5213 人各 20 次效能驗收，分開記錄前置解析、受理、列表可見、worker 終態與寄信時間；在 validation.md 判定 SC-001 至 SC-006，不把背景耗時當受理耗時。
- [ ] T017 執行 server 受影響單元／整合／異動保護測試及 root pnpm build、pnpm lint；在 specs/025-initiation-list-summary/validation.md 記錄實際指令、結果、環境與任何未完成項目。
- [ ] T018 核對 specs/025-initiation-list-summary/contracts/list-summary.md、plan.md、quickstart.md 與最終實作一致，將前後端部署順序、回滾無 migration、無個資洩漏與已知限制記入 validation.md。

## Dependencies & Execution Order

- T001 → T002 → US1。US1 內 T003 → T004 → T005；T006 可在 T002 後與 server 路徑並行，T007 依 T005／T006 完成，T008 驗收整條路徑。
- US2、US3 均依 US1；不互相依賴。US2：T009／T010 可並行，T011 完成保護回歸。US3：T012／T013 可並行，T014 驗收。
- T015～T018 在三個故事完成後執行；T016 的效能證據建立於 T015 回歸通過後。
- 同一 test 檔的 T009 與 T012 不可同時修改；整合順序應協調。共同 validation.md 採順序追加，不覆蓋他人結果。

## Parallel Examples

- US1：T003 的 server 測試與 T006 的 UI 顯示（兩者 T002 完成後）可並行；資料投影仍依 server 測試順序進行。
- US2：T009 的權限測試與 T010 的日期篩選可並行。
- US3：T012 的資料一致性測試與 T013 的快取競態保護可並行；與 US2 測試修改需錯開。

## Implementation Strategy

先交付 T001～T008 作為 MVP：受理後同一列立即顯示期間與人數。再補齊 US2／US3 的重整、權限與終態行為，最後驗證大名單與部署。所有階段沿用既有 worker，不移動正式大量寫入。每張 ticket 驗收並合併整合分支後才可標 resolved；T001～T008 已完成並附驗證，其他任務依各 ticket 進度更新。
