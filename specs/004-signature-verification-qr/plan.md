# Implementation Plan: 簽章驗證 QR Code

**Branch**: `[004-signature-verification-qr]` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-signature-verification-qr/spec.md`

## Summary

在 Spec 03 的簽署與結案流程上加入單一簽章的公開驗證，不新增 table，只在 `esign_signature_records` 新增 `verification_code` 欄位。簽署成功時，Server 在同一 transaction 產生 16 bytes 隨機驗證代碼並寫入簽署紀錄，回傳 `{EXTERNAL_SIGNING_ORIGIN}/verify/{code}`；重送簽署請求讀回同一筆紀錄，網址相同。Worker 產製個人副本時在本人的每個簽名欄位右下角以向量方式畫出該簽署人的 QR Code，並在提交 transaction 內以 `document.completed` 事件 hash 作為稽核鏈終點，寫入一筆既有 `esign_verification_records` 文件驗證快照。公開驗證由獨立 `@Public()` controller 處理，驗章後只讀 DB 重新比對證據、快照與稽核鏈，回傳 FR-009 白名單欄位，不寫任何資料。Client 端的簽署畫面佔位圖、簽署後顯示 QR 與公開驗證頁，由前端工程師依 contract 另行提供，不在本規格工項內。

## Technical Context

**Language/Version**: TypeScript 5.7（server）、TypeScript 5（client），Node.js >= 20.19.0

**Primary Dependencies**: 沿用 Spec 03 的 NestJS 11、Fastify 5、TypeORM 0.3、`pdf-lib` 1.17、`@nestjs/throttler` 與 Redis throttler storage、Next.js 16、MUI 9、client `qrcode`；server 新增 `qrcode`（與 client 同版本）只用於產生 QR 模組矩陣；驗證代碼以 Node.js 內建 `node:crypto` 產生，不新增密碼學套件

**Storage**: MySQL 既有 `esign_signers`、`esign_signature_records`、`esign_documents`、`esign_file_objects`、`esign_audit_events` 與 `esign_verification_records`；新增 `esign_signature_records.verification_code`（migration `1792108800000-SignatureVerificationCode`）。完成 PDF 仍經 `PrivateFileStorage` 保存，QR 屬於完成 PDF 內容，由其 SHA-256 涵蓋

**Testing**: Server Jest 單元測試、Nest/Fastify e2e、security e2e 與真 Redis queue e2e（沿用 Spec 03 測試基礎）；Client 無 test runner，以 lint、build 與 quickstart 人工驗收補足

**Target Platform**: 與 Spec 03 相同：NestJS HTTP server 與 BullMQ worker；驗證頁為一般手機瀏覽器可開啟的公開頁

**Project Type**: pnpm workspace 內的 Next.js web client + NestJS REST API + 同 package worker

**Performance Goals**: 95% 驗證查詢在 2 秒內回應；QR 繪製不使 Spec 03 的「95% 文件在全員簽署後 2 分鐘內結案」目標退化

**Constraints**: 驗證代碼為 16 bytes 隨機值的 base64url（22 字），不含個資，保存在簽署紀錄且建立後不修改；公開驗證沿用登入端點的 Redis 限流（每個 client IP 每 60 秒 10 次、每 300 秒 50 次），設 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`，不讀寫 cookie、不 lock、不寫 DB；個人副本先提交 ready，驗證快照在全員 ready 後的獨立結案 transaction 成立；只適用於功能上線後結案的文件，不回補；access log 不得記錄完整驗證代碼

**Scale/Scope**: 3 個 user stories、12 項 functional requirements；1 個新 public operation、1 個新欄位、3 個既有回應新增 `verificationUrl`；不含文件層級公開驗證入口、驗證紀錄撤銷、證據包、平台憑證封存或一般匯出（Spec 05）

## Constitution Check

_GATE: Phase 0 前與 Phase 1 後皆已檢查，全數通過。_

- **KISS / YAGNI**: PASS。沿用既有 `esign_verification_records` 作文件快照；驗證代碼只在既有簽署紀錄加一個欄位，不建新 table、排程或抽象層。只新增 `qrcode` 套件，為本 spec 明確需要（見 Complexity Tracking）。代碼產生與網址組合放在既有 `EsignTokenService`，只新增一個 public controller 與一個驗證 service。
- **Server 權威與證據完整性**: PASS。驗證網址只由 Server 在簽署證據成立後發出，Client 不產生識別碼；快照在全員個人 PDF ready 後的獨立結案 transaction 成立；manifest 以 canonical JSON 計算 SHA-256，公開查詢時重算 manifest、比對完成 PDF file object 與 audit chain。
- **最小權限與資料最小化**: PASS。依 Constitution 1.3.0 Principle III 的公開簽章驗證例外：URL 只含 Server 簽發、不含個資的驗證識別，不授予登入、寫入或檔案存取；回應只含完整姓名、文件標題與驗證所需狀態、時間及摘要，不含 Email、員編、部門、職稱、IP、User-Agent 或簽名圖。Manifest 不存姓名或聯絡資料。
- **清楚邊界**: PASS。`GET /signature-verifications/{code}` 以資源名詞表達只讀查詢，GET 不寫 audit 或任何資料；公開 controller 與 `/api/esign/*` 員工 session 端點分開。QR 產生與快照寫入在 Server/worker；Client 只呈現 Server 回傳的驗證網址與驗證結果。
- **與風險相稱的驗證**: PASS。覆蓋代碼偽造／錯誤長度／結構錯誤／查無、統一 404、快照與稽核鏈不一致、結案 rollback 與 stale lease、限流、回應欄位白名單、不寫資料與 log 不含驗證代碼。
- **技術與 workflow 約束**: PASS。維持 pnpm workspace 與既有技術邊界；新 dependency 從 root 以 `pnpm --filter` 加入並更新唯一 lockfile；`.env.example` 只放 placeholder。

### Post-design re-check

Phase 1 設計仍無 constitution violation。公開驗證揭露完整姓名原與 Principle III 衝突，已由專案負責人核准修訂 Constitution 至 1.3.0，並同步 Spec 01 FR-016 與 server/docs。OpenAPI 只新增一個 public operation，既有回應以可為 null 的欄位擴充，不改變既有語意。

## Project Structure

### Documentation (this feature)

```text
specs/004-signature-verification-qr/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── openapi.yaml       # 只列本規格新增或擴充的 operation 與 schema
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
client/
├── src/app/verify/[code]/page.tsx                  # 公開驗證頁；前端工程師負責，不在本規格工項
├── src/lib/signatureQr.ts                          # 移除 Client 產生識別碼；前端工程師負責
└── src/features/my-signature/sign/                # 前端工程師負責
    ├── SignatureQr.tsx                             # 改為示意佔位圖／顯示 Server 網址的 QR
    ├── SignFlow.tsx
    └── SheetSignFlow.tsx

server/
├── .env.example
├── package.json
├── src/config/app.environment.ts
├── src/features/esign/
│   ├── controllers/signature-verification.controller.ts
│   ├── repositories/verification-record.repository.ts
│   └── services/
│       ├── esign-token.service.ts                  # 新增驗證代碼產生與網址組合
│       ├── esign-verification.service.ts           # manifest 建立與公開驗證查詢
│       ├── completed-pdf.service.ts                # 簽名欄位內畫 QR
│       ├── esign-signing.service.ts                # 簽署結果加 verificationUrl
│       ├── esign-view.mapper.ts                    # signer view 加 verificationUrl
│       └── esign-completion-access.service.ts      # 外部完成狀態加 verificationUrl
├── src/worker/esign/document-finalization.processor.ts
└── test/
    ├── core-esign-flow.e2e-spec.ts
    ├── core-esign-flow-queue.e2e-spec.ts
    ├── security-core-esign-flow.e2e-spec.ts
    └── api-coverage.e2e-spec.ts
```

**Structure Decision**: 沿用 Spec 03 的 `esign` feature 與 worker 結構，不建立新 module。公開驗證 controller 與外部簽署 controllers 一樣是獨立 `@Public()` 入口；驗證代碼產生與網址組合集中在既有 token service，HTTP 與 worker 共用。Client 公開驗證頁由前端工程師提供，須放在 `(main)` layout 之外，與外部簽署頁一樣不接觸內部 session；本規格只負責其呼叫的 API contract。

## Complexity Tracking

| 新增項目 | 當前需求 | 較簡單方案不足之處 | 移除成本 |
| --- | --- | --- | --- |
| `esign_signature_records.verification_code` | 簽署當下就要發出不可預測、可對應單一簽章的短驗證網址（FR-001、FR-005） | Ed25519 簽章 token 不落 DB，但網址 139 字、QR 49×49，在小簽名欄位過密；放在 `esign_verification_records` 則要結案才建立 | revert migration 並移除代碼產生；已印出的 QR 將無法驗證 |
| server `qrcode` | 完成 PDF 需在 Server 端畫 QR（FR-005） | 由 Client 畫 QR 不會進入 Server 保存並計算摘要的完成 PDF；自行實作 QR 編碼成本與風險過高 | 移除 QR 繪製與依賴 |
| 公開驗證 controller／service | 不需登入的查驗入口（FR-008） | 放在員工 session 端點無法讓外部或未登入者查驗 | 移除 controller 與 service（前端驗證頁另由前端移除）；已寫入的驗證快照屬證據資料，保留不刪 |

驗證代碼不依賴金鑰，資料庫存在即可驗證，日後換網域只需調整 `EXTERNAL_SIGNING_ORIGIN`。
