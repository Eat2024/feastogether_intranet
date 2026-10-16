---
description: "簽章驗證 QR Code 的可執行實作任務"
---

# Tasks: 簽章驗證 QR Code

**Input**: Design documents from `/specs/004-signature-verification-qr/`

**Prerequisites**: `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/openapi.yaml`、`quickstart.md`；Spec 03 的簽署與結案流程

**Tests**: 本功能涉及公開驗證、Hash、簽章與結案 transaction；依 Constitution V 必須包含對應的單元、整合與 e2e 測試。

**Client**: 簽署畫面的佔位圖與 QR 顯示，以及公開驗證頁，由前端工程師依 `contracts/openapi.yaml` 開發，不在本工項清單內；本清單只含 server 工作。

**Organization**: 任務依 user story 分組；Phase 1–2 為共用前置，Phase 3–5 各自交付可獨立驗收的使用者價值。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可與同階段其他標記任務平行處理，因為修改不同檔案且不依賴尚未完成的任務
- **[Story]**: 對應 `spec.md` 的 user story（US1–US3）
- 每項任務均列出實際或預定的明確檔案路徑

## Path Conventions

- Server：`server/src/`、`server/test/`
- 文件：`specs/004-signature-verification-qr/`、`server/docs/`、`doc/`

---

## Phase 1: Setup（共用套件與設定）

**Purpose**: 加入本規格核准的依賴與環境變數。

- [x] T001 從 repository root 執行 `pnpm --filter feastogether-intranet-server add qrcode` 與 `pnpm --filter feastogether-intranet-server add -D @types/qrcode`，版本對齊 `client/package.json` 的 `qrcode`，只更新 `server/package.json` 與 root `pnpm-lock.yaml`
- [x] T002 [P] 新增 migration `server/src/infrastructure/database/migrations/1792108800000-SignatureVerificationCode.ts`：`esign_signature_records.verification_code` `CHAR(22)` ascii_bin、UNIQUE、可為 NULL；同步 entity、`mysql.options.ts`、`schema.sql` 與 `server/test/schema-migration.e2e-spec.ts`（revert 最新 migration）。本規格不新增環境變數，只在 `server/src/config/app.environment.ts` 回傳去除空白後的 `EXTERNAL_SIGNING_ORIGIN`

---

## Phase 2: Foundational（所有 user story 的阻擋前置）

**Purpose**: 驗證代碼的產生、格式檢查與網址組合，US1 發網址、US2 畫 QR、US3 查驗都依賴它。

**⚠️ CRITICAL**: T004 完成前不得開始任何 user story 的實作。

- [x] T003 [P] 在 `server/src/features/esign/services/esign-token.service.spec.ts` 先寫會失敗的測試：驗證代碼為 16 bytes 隨機值的 22 字 base64url、每次不同；錯誤長度、非 base64url 字元、含路徑與空字串格式不符；網址為 `{EXTERNAL_SIGNING_ORIGIN}/verify/{code}`，沒有代碼時為 null
- [x] T004 在 `server/src/features/esign/services/esign-token.service.ts` 新增驗證代碼產生、格式檢查與網址組合，格式依 `data-model.md` 第 2 節；簽署 transaction 內寫入 `esign_signature_records.verification_code`；確認 `server/src/worker/esign/esign-worker.module.ts` 已提供此 service

**Checkpoint**: T003 通過後，US1–US3 可開始。

---

## Phase 3: User Story 1－簽署後取得簽章驗證網址（Priority: P1）🎯 MVP

**Goal**: 簽署成功後才提供驗證網址，並在既有回應中提供已簽署者的網址。

**Independent Test**: 兩名簽署人的文件中第一人簽署後，其簽署結果與詳情含相同驗證網址；第二人在詳情為 null；以相同 `requestId` 重送，網址不變。

### Tests for User Story 1

> 先寫測試並確認失敗，再實作。

- [x] T005 [P] [US1] 在 `server/src/features/esign/services/esign-signing.service.spec.ts` 與 `server/src/features/esign/services/esign-view.mapper.spec.ts`（不存在則新增）驗證：簽署結果含 `verificationUrl`、重送回相同網址；`SignerView.verificationUrl`「只有 status = signed 時有值」，pending 為 null；外部完成狀態含本人網址
- [x] T006 [US1] 在 `server/test/core-esign-flow.e2e-spec.ts` 驗證內外部簽署回應、creator 詳情、本人任務與外部完成狀態的 `verificationUrl`；未簽署者為 null；網址不含 Email、姓名或文件資訊

### Implementation for User Story 1

- [x] T007 [US1] 在 `server/src/features/esign/services/esign-signing.service.ts` 的簽署結果（含重送路徑）、`server/src/features/esign/services/esign-view.mapper.ts` 的 signer view 及 `server/src/features/esign/services/esign-completion-access.service.ts` 的 `receiptStatus` 加入 `verificationUrl`，同步更新 `server/src/features/esign/dto/` 下對應 response DTO 與 Swagger 說明，符合 `contracts/openapi.yaml` 的 `SignatureResultExtension`、`SignerViewExtension`、`ExternalCompletionExtension`

**Checkpoint**: US1 可獨立驗收。

---

## Phase 4: User Story 2－完成 PDF 印上驗證 QR 並保存驗證快照（Priority: P2）

**Goal**: 完成 PDF 在各簽名欄位印 QR，結案時在同一 transaction 寫入驗證快照。

**Independent Test**: 兩人完成簽署後，完成 PDF 各簽名欄位有對應 QR；DB 恰好一筆快照且摘要一致；快照寫入失敗時文件不完成且可重試。

### Tests for User Story 2

- [x] T008 [P] [US2] 在 `server/src/features/esign/services/completed-pdf.service.spec.ts` 驗證：每個 signature 欄位以該簽署人的驗證網址產生 QR；QR「邊長為欄位高度的 72%，貼齊欄位右下角並先畫白底」；簽名「在左側剩餘寬度（扣除欄位高度 8% 的間距）內等比縮放置中」且不與 QR 重疊；date 欄位不受影響
- [x] T009 [P] [US2] 在 `server/src/features/esign/services/esign-verification.service.spec.ts` 驗證 manifest：`schemaVersion` 為 `esign-verification-manifest-v1`；以 `canonicalJson` 序列化後計算 SHA-256；`signers`「依 signer `sort_order`、`id` 排序」；不含姓名、Email、員編、IP、User-Agent 或簽名圖
- [x] T010 [US2] 在 `server/test/core-esign-flow-queue.e2e-spec.ts` 驗證：結案後恰好一筆 `esign_verification_records`，`final_pdf_sha256` 等於 `completed_pdf` file object `sha256`、`audit_root_hash` 等於 `document.completed` 的 `event_hash`、`manifest_sha256` 可重算；快照寫入失敗時整筆 rollback、文件維持可重試、重試後只有一筆；stale lease 的舊 worker 不能寫入快照

### Implementation for User Story 2

- [x] T011 [US2] 在 `server/src/features/esign/repositories/verification-record.repository.ts` 新增依 `document_id` 查詢；新增 `server/src/features/esign/services/esign-verification.service.ts`，依 `data-model.md` 第 1 節建立 canonical manifest 與 `manifest_sha256`；註冊於 `server/src/features/esign/esign.module.ts` 與 `server/src/worker/esign/esign-worker.module.ts`
- [x] T012 [US2] 更新 `server/src/features/esign/services/completed-pdf.service.ts`：依 `research.md` 第 4 節版面，在每個 signature 欄位畫簽名與向量 QR（以 `qrcode` 取得模組矩陣，`pdf-lib` 畫方塊；錯誤修正等級 M、無留白；不嵌入點陣圖）
- [x] T013 [US2] 更新 `server/src/worker/esign/document-finalization.processor.ts`：第二個 transaction 命中 lease token 後，在 append `document.completed` 之後以回傳的 `event_hash` 作 `audit_root_hash`，insert 驗證快照，欄位規則依 `data-model.md` 第 1 節：「`public_id` 為 Server 產生的 UUID v4」、「`status` 只寫 `valid`」、「`issued_at` 等於 document `completed_at`」、「`revoked_at` 永遠為 NULL」、「`final_pdf_sha256` 等於同 transaction 寫入的 `completed_pdf` file object `sha256`」；與 completed file metadata、signers、document status 同一 transaction

**Checkpoint**: US2 可獨立驗收。

---

## Phase 5: User Story 3－任何人掃描查驗簽章（Priority: P3）

**Goal**: 不需登入的公開驗證查詢 API。驗證頁 `client/src/app/verify/[code]/page.tsx` 由前端工程師依 `contracts/openapi.yaml` 提供，不在本規格工項內。

**Independent Test**: 未登入開啟有效網址顯示正確資料；竄改驗證代碼得到與不存在相同的 404；查詢前後資料無寫入。

### Tests for User Story 3

- [x] T014 [P] [US3] 在 `server/src/features/esign/services/esign-verification.service.spec.ts` 驗證查詢：signer 為 pending、無 signature record、文件為 draft 或已刪除時回 not found；completed 但缺快照、manifest hash、final PDF hash、本人快照項目或 audit chain 不一致時回 integrity failure；已停止文件回簽章有效且 `completedPdfSha256` 為 null；回應只含 spec FR-009 白名單欄位
- [x] T015 [US3] 在 `server/test/core-esign-flow.e2e-spec.ts` 驗證公開查詢不帶 cookie 即可取得 `SignatureVerification` 欄位，進行中、完成與已停止文件的回應差異符合 `contracts/openapi.yaml`
- [x] T016 [P] [US3] 在 `server/test/security-core-esign-flow.e2e-spec.ts` 驗證：偽造、錯誤長度、結構錯誤、查無的驗證代碼 404 回應完全相同；同一 IP 超過「每 60 秒 10 次、每 300 秒 50 次」回 429；回應不含 `Set-Cookie`，`Cache-Control: no-store`、`Referrer-Policy: no-referrer`；查詢前後 `esign_audit_events` 與業務資料筆數不變；access log 不含完整驗證代碼；回應不含簽名、Email、員編、部門、職稱、IP、User-Agent

### Implementation for User Story 3

- [x] T017 [US3] 新增 `server/src/features/esign/controllers/signature-verification.controller.ts`：`@Public()` 的 `GET /signature-verifications/{code}`，套用既有 `AuthThrottlerGuard` 與 Redis throttler（必要時在 `server/src/features/esign/esign.module.ts` 匯入既有設定，不新增限流參數），設定 `Cache-Control: no-store` 與 `Referrer-Policy: no-referrer`，不讀寫 cookie；`EsignVerificationService` 依 `research.md` 第 2 節檢查代碼格式（不符時不查 DB）、只讀查詢、比對快照與 audit chain，統一 404「查無此簽章或驗證碼無效」與 409 `ESIGN_INTEGRITY_FAILED`；在 `server/src/framework/http/request.context.ts` 與 `server/src/framework/interceptors/http-access-log.interceptor.ts` 比照 invitation token，將路徑正規化為 `/signature-verifications/:token`
- [x] T018 [US3] 將 `getSignatureVerification` 納入 `server/test/api-coverage.e2e-spec.ts`，確認公開邊界、status 與 envelope 符合 `contracts/openapi.yaml`

**Checkpoint**: US3 的 API 可獨立驗收；掃描後的畫面需等前端驗證頁完成後，於 T021 一併驗收。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 文件同步、品質檢查與人工驗收。

- [x] T019 [P] 更新 `server/docs/internal-electronic-signature-platform.md` 的 Spec 04 實作說明、`server/docs/internal-electronic-signature-data-dictionary.md` 與 `doc/esign-evidence-legal-mapping.md`，把「規劃」改為已實作的實際行為與限制
- [x] T020 依 `specs/004-signature-verification-qr/quickstart.md` 第 3 節執行 server `lint:check`、`test`、`build`、`test:e2e`、`test:e2e:security`，以及 root `pnpm build` 與 `pnpm lint`（因 root lockfile 變更）；記錄未能執行的項目與風險
- [ ] T021 依 `specs/004-signature-verification-qr/quickstart.md` 第 4–6 節完成人工驗收（掃描畫面依賴前端驗證頁），結果記錄於 `specs/004-signature-verification-qr/validation.md`；列印掃描須包含一份同一頁有十位以上簽署人的文件，記錄 iOS／Android 可穩定掃描的最小簽名欄位高度；若掃描不穩定，回報是否需要欄位高度下限或縮短驗證路徑

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 無相依；T001 單獨執行以避免 lockfile 衝突。
- **Phase 2 Foundational**: 依賴 T002；完成前阻擋所有 user story。
- **US1（Phase 3）**: 依賴 Foundational。
- **US2（Phase 4）**: 依賴 Foundational 與 T001；可與 US1 平行開發，但端到端驗收需要 US1 的簽署結果。
- **US3（Phase 5）**: 進行中文件的查詢只依賴 Foundational；完成文件的比對依賴 US2 的快照（T011、T013）。前端驗證頁由前端工程師依 contract 開發，T017 落地後即可串接。
- **Phase 6 Polish**: 依賴 US1–US3 完成。

### User Story Dependency Graph

```text
Setup → Foundational → US1 ─┐
                     └→ US2 ─┴→ US3 → Polish
```

### Within Each User Story

- 先建立會失敗的測試，再實作 service、controller 與 worker。
- Repository 先於 service；service 先於 controller 與 worker。
- 公開查詢只讀，不得為了測試方便加入寫入或 lock。

### Parallel Opportunities

- T002 與 T001 修改不同檔案，但 T001 會動 lockfile，建議先完成 T001。
- Foundational 完成後，US1 與 US2 的 server 工作修改不同檔案，可平行進行。
- 各 story 內標記 `[P]` 的測試可平行撰寫。
- 前端工程師的簽署畫面與驗證頁工作可在 `contracts/openapi.yaml` 固定後與本清單平行進行。

---

## Parallel Examples

### User Story 1

```text
Task T005: signing service 與 view mapper 單元測試
Task T006: 簽署回應與 signer view 的 e2e
```

### User Story 2

```text
Task T008: completed PDF 的 QR 版面測試
Task T009: manifest canonical 與 hash 測試
```

### User Story 3

```text
Task T014: 驗證查詢 service 測試
Task T016: 公開驗證 security e2e
```

---

## Implementation Strategy

### MVP First（US1）

1. 完成 Phase 1 Setup 與 Phase 2 Foundational。
2. 完成 US1：簽署後取得驗證網址。
3. 依 US1 independent test 驗收後再往下；此時驗證網址尚無法查詢，不得對外宣稱公開驗證已完成。

### Incremental Delivery

1. **US1**: 簽署人與建立人取得驗證網址。
2. **US2**: 完成 PDF 印上 QR，結案保存驗證快照。
3. **US3**: 任何人可掃描查驗。
4. **Polish**: 文件同步、全套品質檢查與列印掃描驗收。

### Scope Guardrails

- 不實作文件層級公開驗證入口、驗證紀錄撤銷或取代、證據包、稽核報告、公司憑證封存、可信時間戳記或一般匯出（Spec 05）。
- 不新增 table、欄位、migration、排程或抽象層；不為上線前已結案的文件回補快照或 QR。
- 不實作任何 client 程式：簽署畫面佔位圖、簽署後顯示 QR、移除 Client 產生的 `signatureIds`，以及驗證頁 `client/src/app/verify/[code]/page.tsx`，均由前端工程師依 contract 提供。
- 不在發起時強制簽名欄位最小高度；以 T021 實測結果再決定。

## Notes

- `[P]` 只表示檔案與直接相依允許平行，不代表可跳過 Phase 或 Story 的相依。
- 所有程式、註解、UI 與可預期錯誤使用繁體中文。
- 不提交 `.env`、實際 PDF/PNG、驗證簽章私鑰、session、coverage、dist、`.next` 或 `node_modules`。
- 每完成一個 task 或合理小群組即可 commit；不得覆寫本來就存在的使用者變更。
- 2026-10-16 設計變更：原以 Ed25519 簽章 token（139 字網址）作驗證網址，實際印出後 QR 過密，改為簽署紀錄的 22 字隨機驗證代碼；移除 `ESIGN_VERIFICATION_SIGNING_KEY_B64`，新增 `esign_signature_records.verification_code` 與 migration。
