# Tasks：022 全量背景發起簽署

**Input**：[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[API 契約](contracts/background-initiation.md)、[驗收指南](quickstart.md)。

**狀態**：T001–T030 已完成後端整合；T031–T034 在 `impl/022-08` 驗收中。使用整合分支 `impl/022-integration`。測試來自 spec 的驗收需求及憲章的交易／身分／migration 驗證要求。新增檔案為預定位置，其他既有檔案先讀相鄰實作。

**執行約定**：先寫相應風險測試確認能捕捉缺陷，再完成實作並驗證；同 ticket 內測試與實作形成一個可審查增量。新表只限計畫的一張，維持全部人數 worker、無同步產品分支。`[P]` 只表示前置完成後可與同階段不同檔案工作並行，不授權啟動代理。

## Phase 1：Setup

確認既有能力與隔離驗證前提；不新增套件、環境變數或排程。

- [x] T001 核對 Spec 023 已整合的本機主檔／Email 與批次寫入能力，於 `specs/022-background-signature-initiation/quickstart.md` 記錄基準 commit、測試 DB／Redis 隔離方式及缺漏；前置不成立時不得改回即時 HR 查詢。

## Phase 2：Foundational

先完成無行為變更的交易核心重構；以現有發起測試驗證，完成後才進入 US1。

- [x] T002 將 `server/src/features/esign/services/esign-initiation.service.ts` 正式核心拆成接受 EntityManager 與明確 creatorUserId 的入口；保留 users ID 升冪 → document 鎖序、buildFields 在交易內、完整快照／audit 與 commit 後通知；本票保留既有 HTTP 行為，待 T009 一起切換。
- [x] T003 在 `server/src/features/esign/services/esign-initiation.service.spec.ts` 與 `server/test/core-esign-flow.e2e-spec.ts` 驗證核心失敗全回滾、actor 正確、通知只於 commit 後派送；重構不能改變既有簽署證據與授權。

## Phase 3：US1 — 全部名單背景受理（P1）

獨立驗收：1／100／101／5,001／6,001 人均先受理再正式發起，關頁不影響工作；0 人拒絕，無部分指派。T004–T011 為窄幅完整流程，T012–T015 擴至完整名單情境。

- [x] T004 [US1] 新增 `server/src/features/esign/entities/esign-initiation-job.entity.ts` 與 `server/src/infrastructure/database/migrations/1793750401000-BackgroundSignatureInitiation.ts`，同步 `server/src/infrastructure/database/schema.sql`、`server/src/infrastructure/database/mysql/mysql.options.ts`；完整遵守下方模型約束原文，含唯一 active_document_id、FK RESTRICT、JSON 預設不 select；若時間戳已占用只調整 migration 檔名。
- [x] T005 [US1] 新增 `server/src/features/esign/repositories/initiation-job.repository.ts` 並於 `server/src/infrastructure/database/mysql/mysql.module.ts` 註冊；實作 create／key replay／latest／active 查詢與 lease CAS，Service 傳 EntityManager，摘要投影不載入 JSON；原子 CAS 同步必要稽核欄位，不能為遵循一般 save 慣例失去 fencing。
- [x] T006 [US1] 在 `server/src/features/esign/dto/initiation.dto.ts` 新增發起專用 signer 表示與 `server/src/features/esign/dto/initiation-job.dto.ts` 摘要 DTO：employeeNo「完整英數字串 1–20 字」、保留前導零／大小寫，同請求內部 employee/user 不混用；欄位 1–200、0 人拒絕、key 選填但有值須 UUID，沿用 bytes 限制，不改共用草稿 DTO；同步 `server/src/common/errors/app-errors.ts` 與 `server/src/common/errors/app-error-code.ts`。
- [x] T007 [US1] 新增 `server/src/features/esign/services/esign-initiation-job.service.ts` 可靠受理：目前授權＋shape/hash → 原 key 重播 → 新受理動態檢核；建立人 → document 短交易保存 input/version、同 key 同 hash 回原工作，不同 key 忙碌 409。於 `server/src/features/esign/services/esign-access-policy.service.ts` 及同 feature 草稿寫入服務落實鎖內 busy guard，涵蓋標題／PDF／fields／draftSave／draft-settings／signer note／delete，不留旁路。
- [x] T008 [US1] 新增 `server/src/worker/esign/document-initiation.processor.ts`，接入 `server/src/features/esign/esign-queue.constants.ts`、`server/src/features/esign/esign-queue.module.ts`、`server/src/features/esign/services/esign-job-producer.service.ts` 與 `server/src/worker/esign/esign-worker.module.ts`：payload 只含 jobId，全域 concurrency=1；短 claim 釋放 job 鎖，正式 users→document→job 原子提交業務與 succeeded，重播成功直接結束。
- [x] T009 [US1] 修改 `server/src/features/esign/controllers/documents.controller.ts` 發起為首次 202／合法重播 200／Location，不再載入 detail；新增 `server/src/features/esign/controllers/initiation-jobs.controller.ts` 的最小 GET job 摘要並註冊 `server/src/features/esign/esign.module.ts`，只允許建立人，沿用 session／OriginGuard／envelope；同步 Swagger。
- [x] T010 [US1] 在 `server/test/esign-initiation-acceptance.e2e-spec.ts` 驗證未修改 client 的既有 userId/email body、未帶 key 也可受理，server 生成 request key；進行中無 key 重送 409，已成功不可再發起，有 key 保留安全重播。禁止修改 client。
- [x] T011 [US1] 新增 `server/test/esign-initiation-acceptance.e2e-spec.ts` 與 `server/test/esign-initiation-schema.e2e-spec.ts`，登記 `server/test/jest-e2e.json`／`server/test/jest-schema.json`；驗證 1 人端到端、schema 唯一性、非空 down 拒絕、所有草稿 busy guard、授權、同／不同 key 競態與已過期原 key 重播；在 `specs/022-background-signature-initiation/quickstart.md` 記錄前端受理驗收。
- [x] T012 [US1] 修改 `server/src/features/esign/services/esign-employee-email.service.ts` 與 `server/src/features/esign/services/esign-signer.service.ts`，本機 500 人一批解析，移除 6,000 總數拒絕，正式鎖內重新核對員編映射、有效帳號與建立人；缺帳號整份失敗、缺信箱保留資格，不建帳。
- [x] T013 [US1] 在 `server/src/features/esign/services/esign-initiation.service.ts` 與 `server/src/worker/esign/document-initiation.processor.ts` 整合完整混合名單、250 筆批次寫入但不分批 commit；鎖內核對微秒版本與 source file，stage=committing 於交易前有效 lease CAS 提交，禁止提前宣告成功或重送初邀。
- [x] T014 [US1] 新增 `server/test/esign-initiation-capacity.e2e-spec.ts`，登記 `server/test/jest-e2e.json`：1／100／101／5,001／6,001、混合與全外部、缺信箱／白名單、無效身分與中途失敗全回滾；比對完整指派、快照順序、audit／通知批次唯一性。
- [x] T015 [US1] 在 `server/test/esign-initiation-acceptance.e2e-spec.ts` 與 `specs/022-background-signature-initiation/quickstart.md` 驗證既有混合名單提交與前端呼叫相容；記錄前置 resolutions 及 flash=published 限制，不宣稱 UI 已改為背景進度。

## Phase 4：US2 — 重整後追蹤進度（P1）

獨立驗收：queued／processing／終態時關頁及重登入皆能查回同工作；其他部門讀者看不到工作資料；以固定 fixture 狀態驗證 UI，不依賴故障重試實作。

- [x] T016 [US2] 擴充 `server/src/features/esign/controllers/initiation-jobs.controller.ts` 與 `server/src/features/esign/services/esign-initiation-job.service.ts` 的 GET latest（無工作 null）／job 摘要：只讀、非建立人與不存在統一 404、未登入 401、no-store；暴露 attempt／deadline／nextAttempt／issueCount，不暴露 lease 或 JSON。
- [x] T017 [US2] 在 `server/test/esign-initiation-query.e2e-spec.ts` 驗證原文件列表行為不變、queued／processing 仍 draft、worker 成功才 active；不新增列表 initiationSummary，不選取工作 JSON 參與列表排序。
- [x] T018 [US2] 在 `server/test/esign-initiation-query.e2e-spec.ts` 驗證 job/latest 輕量摘要的授權、終態與失聯回應語意；僅 API 驗收，不新增 client hooks 或輪詢。
- [x] T019 [US2] 在 `server/test/esign-initiation-acceptance.e2e-spec.ts` 完整驗證 queued／processing 對文件資料與簽署人增刪替換、註記、期間、設定、PDF、刪除皆回 409 與固定 worker 執行中訊息；驗證競態、failed 解鎖與 succeeded 既有規則。
- [x] T020 [US2] 新增 `server/test/esign-initiation-query.e2e-spec.ts` 並登記 `server/test/jest-e2e.json`，驗證摘要授權／只讀／無 JSON／無 N+1、22 份大 input 在 256KiB sort buffer 下列表成功；於 `specs/022-background-signature-initiation/quickstart.md` 記錄重整、關頁、失聯與 10 秒可見驗收。

## Phase 5：US3 — 失敗修正與安全恢復（P1）

獨立驗收：故障注入後工作有限恢復，不重複發起；failed 可取回確認輸入，修正或人工 retry；成功、過期及清理後原 key 均可安全重播。

- [x] T021 [P] [US3] 新增 `server/test/esign-initiation-recovery.e2e-spec.ts` 並登記 `server/test/jest-e2e.json`，涵蓋 claim／解析／正式交易／commit 後 ack 前中斷、舊 lease、DB 成功 Redis 失敗、3 次耗盡與 deadline；測試不能靠刪資料重跑。
- [x] T022 [US3] 擴充 `server/src/worker/esign/document-initiation.processor.ts` 與 `server/src/features/esign/repositories/initiation-job.repository.ts`：最多 3 claim、30／120 秒 backoff、5 分鐘 lease／30 秒獨立 heartbeat、每批與 5 秒進度節流；deadline=min(accepted+120min,signEndAt)，交易持 job 鎖後停獨立 heartbeat，鎖內與 commit 前查期限；所有寫入 CAS，失租停止，不以 Promise.race 遺留提交。
- [x] T023 [US3] 擴充 `server/src/worker/esign/esign-maintenance.processor.ts` 與 `server/src/features/esign/services/esign-job-producer.service.ts`，於既有 30 秒週期補列／回收可鎖定過期 lease，遵守 nextAttemptAt／deadline、跳過正式交易持鎖列；設計 delivery ID／終態移除使 DB retry 不被 Redis 舊 failed/completed job 去重永久擋住，delivery attempts=1。
- [x] T024 [US3] 在 `server/src/features/esign/services/esign-initiation-job.service.ts` 與 `server/src/worker/esign/document-initiation.processor.ts` 落實穩定錯誤分類、恢復一致性檢查與結構化 job/document/request 關聯；全面 DB 中斷不假造終態，成功後通知失敗不回寫 failed，不記錄完整名單或任意 DB message。
- [x] T025 [US3] 在 `server/src/features/esign/controllers/initiation-jobs.controller.ts`、`server/src/features/esign/dto/initiation-job.dto.ts` 與 service 實作建立人限定 input／issues：input 還原原確認設定，issues 只在 failed 可讀，offset≥0、limit 1–100 預設 100，外部只回 inputIndex；非終態 409、清理後 410。
- [x] T026 [US3] 於 `server/src/features/esign/services/esign-initiation-job.service.ts` 及 `server/src/features/esign/controllers/initiation-jobs.controller.ts` 實作 retries：新 key／新 job／parent hash，先查重播再驗最新 failed、retryable、input 保留、版本、授權與期限；同 key 回原 child，改內容走新 initiation，不允許覆寫 retry body。
- [x] T027 [US3] 在 `server/test/esign-initiation-retry.e2e-spec.ts` 驗證原確認名單及問題 API、重試後 busy 保護重新生效、異動 API 沿用既有錯誤 envelope；不修改 client 或新增失敗修正畫面。
- [x] T028 [US3] 新增 `server/test/esign-initiation-retry.e2e-spec.ts` 並登記 `server/test/jest-e2e.json`；驗證 retry 回應遺失、child succeeded／parent 不再 latest 後重播、越權、版本變更、期限、輸入修正與 issues 分頁；於 `specs/022-background-signature-initiation/quickstart.md` 記錄失敗重整還原及 UI 錯誤分流。
- [x] T029 [US3] 在 `server/src/worker/esign/esign-maintenance.processor.ts` 與 `server/src/features/esign/repositories/initiation-job.repository.ts` 實作終態滿 30 天分批清空 input/version/issues，保留摘要、key/hash、計數與稽核；非終態永不清除，清理與已受理 retry 交易串行化，摘要 detailsExpired 與 410 一致。
- [x] T030 [US3] 新增 `server/test/esign-initiation-retention.e2e-spec.ts` 並登記 `server/test/jest-e2e.json`；驗證保留期邊界、清理/retry 競態、原 initiation 與 retry key 在 parent 明細清理後仍回原摘要，無憑空空名單、無刪正式證據；於 `specs/022-background-signature-initiation/quickstart.md` 記錄過期重新設定的畫面驗收。

## Phase 6：整合驗證與交付

所有故事完成後才能協調發布；本階段不默認授權 UAT 部署、寄真信或建立 PR。

- [x] T031 新增測試專用 `server/test/helpers/await-initiation.ts`，遷移 `server/test/core-esign-flow.e2e-spec.ts`、`server/test/core-esign-flow-queue.e2e-spec.ts`、`server/test/core-esign-flow-scale.e2e-spec.ts` 與其他引用 POST initiations 的 e2e／benchmark：先 202、驅動 worker／等終態後簽署；於 `server/test/api-coverage.e2e-spec.ts` 驗證新端點，禁止 production 同步 fallback。
- [ ] T032 [P] 新增 `server/test/performance/esign-initiation-benchmark.e2e-spec.ts`，執行 1／100／101／5,001 各 20 次 P95≤3秒、5,001→5 混合排隊與大型終態後 60 秒取得權限，以及 SC-006 每人首次延遲 1 秒／120 分鐘驗收；隔離合成資料，結果寫 `specs/022-background-signature-initiation/validation.md`，未執行不能標通過。
- [ ] T033 於 `specs/022-background-signature-initiation/validation.md` 記錄 server lint:check／test／test:schema／test:e2e 與 root build／lint 結果、Swagger 與 contract 對照、三故事 API 驗收與未修改 client 相容性 smoke test及未驗證限制；相依服務不足時保留阻礙，不勾選未通過項。
- [x] T034 更新 `specs/022-background-signature-initiation/quickstart.md` 發布／回退演練紀錄：先 migration、協調 worker/server，client 不部署，回退前停新受理並結清非終態，保留工作表且非空 down 拒絕；不新增 env／排程，不在本票自行部署或寄真信。

## T004 模型約束原文

以下直接引用資料模型，T004 必須完整實作；如需修改先同步 data-model 與契約，不由實作者自行放寬。

| 欄位 | 型別／限制 | 用途 |
| --- | --- | --- |
| id | bigint PK | 內部游標與最新工作排序 |
| public_id | UUID，unique | API jobId；識別不代表授權 |
| document_id | bigint FK esign_documents，RESTRICT | 原草稿／最終文件 |
| created_by_user_id | bigint FK users，RESTRICT | 原發起者，所有寫入的明確 actor |
| request_key | UUID | 對應 Idempotency-Key，與 document_id 組合唯一 |
| request_hash | SHA-256 | server 正規化請求後計算；保留名單順序與欄位 sortOrder |
| parent_job_id | nullable bigint self FK，RESTRICT | 人工重試來源；新工作不復活舊列 |
| input_json | nullable JSON，預設不 select | 受理名單、共用欄位、期間、選項；非終態不可為 null |
| document_version_json | nullable JSON，預設不 select | 文件 ID、原 updated_at 微秒原值、source file ID/hash/object version；不是 client 提供的可信值 |
| status | queued／processing／succeeded／failed | 業務工作狀態 |
| stage | queued／resolving／validating／committing／completed／failed | UI 階段 |
| total_count / processed_count | 非負整數；0 ≤ processed ≤ total | 本輪已查核筆數，不等於已建立指派 |
| attempt_count | 整數 0..3 | 每次取得有效 claim 才 +1，重播不加 |
| next_attempt_at | nullable UTC datetime(6) | DB 管理 backoff |
| lease_token / lease_expires_at | nullable UUID／UTC datetime(6) | claim fencing；processing 才有值，token 不回 API |
| accepted_at / deadline_at | UTC datetime(6) | deadline=min(accepted+120min, signEndAt)，同一 job 不延長 |
| last_progress_at / started_at / completed_at | UTC datetime(6)，適用欄位可空 | 最新進度、首次執行與終態時間 |
| error_code / retryable | nullable 穩定代碼／boolean | 系統級失敗分類；不存任意 exception message |
| issue_count / issues_json | 非負整數／nullable JSON，預設不 select | 按輸入 index 記錄 employeeNo 或外部項目 index 與分類，不含 HR raw payload |
| input_purged_at | nullable UTC datetime(6) | 終態敏感明細已清理，摘要仍可讀 |
| created_at / updated_at / deleted_at | 既有稽核欄位 | 不以 soft delete 釋放非終態工作或繞過唯一約束 |
| active_document_id | generated stored bigint | status 為 queued／processing 時等於 document_id，其他為 NULL；unique |

索引：unique(public_id)、unique(document_id, request_key)、unique(active_document_id)、(document_id,id)、(status,next_attempt_at,id)、(status,lease_expires_at,id)、(status,completed_at,id)。FK 索引由 schema 一併確認，不以新欄位覆寫任何 users 主檔。

約束：total_count>0；非終態 input/version 不空、completed_at 空；processing 必須有 lease，其他狀態沒有有效 lease；succeeded stage=completed 且 error_code 空；failed stage=failed 且有分類錯誤；processed_count 不大於 total_count。清理不刪摘要列，也不更新既有正式簽署證據。

## 最新範圍與驗收覆寫

[後端範圍決策](backend-only-scope.md) 優先於下文舊畫面情境。本輪無 client 修改；US2 改以 API 追蹤驗收，US3 還原與重試只驗後端。T007 必須回固定 409 訊息並保護全部簽署人異動；T006／T007 相容缺 key 的既有呼叫。原 3 秒指標僅計 POST，不含前置解析。未修改 client 的 smoke test 不等於新增 UI 功能。

## 依賴與平行機會

```text
T001 → T002 → T003 → US1(T004–T015)
US1 → US2 查詢(T016–T020，票04) ─┐
US1 → US3 恢復(T021–T024，票05) ─┴→ US3 修正／保留(T025–T030，票06–07)
US3 修正／保留 → 整合(T031–T034)
```

- 後端範圍修訂：US2 查詢不是 US3 恢復前置；03 完成後票 04／05 可在獨立 worktree、隔離 Redis DB 平行。共用 service 的衝突在整合時解決並重驗，並非共享工作樹同時寫入。
- US1：T006 的 DTO／錯誤碼可在 T004–T005 契約確定後與 Repository 單獨開發，整合 T007 前都必須完成；主線依序執行，不標無條件 [P]。
- US2：T016–T020 只做後端摘要／查詢與既有 client 相容驗收，不改前端，可與恢復 T021–T024 平行。
- US3：恢復 T021–T024 只依 US1；T021 故障測試與 T022 processor 可並行，測試先確認失敗後再驗通過。修正／保留 T025–T030 需 US2 與恢復皆完成，T023、T029 同改 maintenance 仍依序進行。
- 整合：T031 測試遷移與 T032 benchmark 可並行；T033 等兩者通過後才開始。

## 增量策略與完成定義

先完成 T001–T011 的單人背景流程作內部示範，再補 T012–T015 的完整名單驗收，形成 US1 MVP。這不是可直接部署的產品版本：US2 追蹤、US3 復原／修正與整合關卡都完成後，才符合已核准規格。

T009 切換契約後，舊 201 測試至 T031 遷移前可能失敗；各票必須通過自己的範圍驗證並記錄既有測試契約落差，不承諾每個中間 commit 全套綠燈，也不以同步 fallback 掩蓋。最終整合必須通過完整相應驗證。

所有票單使用同一整合分支，前置 resolved 才可開始；本輪僅拆解，不建立遠端 issue／PR、不實作、不部署。票單索引見 [本機 tickets](../../.scratch/022-background-signature-initiation/README.md)。
