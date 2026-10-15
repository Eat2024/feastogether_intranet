# Implementation Plan: 核心電子簽端到端流程

**Branch**: `[003-core-esign-flow]` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-core-esign-flow/spec.md`

## Summary

將現有 Client server-memory 電子簽原型收旂為以 NestJS/MySQL 為唯一權威的正式主流程：員工以 Spec 2 session 建立 PDF 草稿、設定內部或 Email 簽署人與欄位，發起時以 MySQL transaction 驗證並固定簽署 payload/hash。內部簽署人沿用員工 session；外部簽署人從 Email 開啟可重複使用到終止條件的 opaque invitation URL，由同源 bridge POST 換成 HttpOnly 受限 cookie。簽署時後端重新驗證身分、狀態、期限與文件摘要，並在單一 transaction 寫入簽署人狀態、不可變證據、簽名圖檔 metadata 與 audit event。

私有檔案統一經 `PrivateFileStorage` contract 存取：local、test 與 UAT 使用 HTTP server/worker 共用的私有 persistent volume，production 使用啟用 Block Public Access 的私有 S3；MySQL `esign_file_objects` 保存 object key、版本、大小、MIME 與 SHA-256，所有下載仍經授權 API stream。外部邀請信也統一經窄化 mail sender contract：local 以 SMTP 投遞 Mailpit、test 使用 in-memory fake、UAT 使用 AWS SES sandbox、production 使用已移出 sandbox 的 AWS SES。背景工作沿用驗收系統已驗證的 NestJS BullMQ 模式：HTTP transaction 先把業務狀態／invitation outbox 寫入 MySQL，commit 後 best-effort 入列；獨立 worker 才載入 invitation、finalization 與 maintenance processors。BullMQ 負責喚醒、重試與排程，但不作業務權威；processor 每次仍以 MySQL lock、unique constraint、conditional update 與 finalization lease fencing 仲裁。固定的 30 秒 maintenance scheduler 會掃描並補入未成功 enqueue 的 invitation/finalization、回收 stale lease、停止逾期文件，封住 MySQL commit 與 Redis enqueue 無法原子的缺口。

## Technical Context

**Language/Version**: TypeScript 5.7（server）、TypeScript 5（client），Node.js >= 20.19.0

**Primary Dependencies**: NestJS 11、Fastify 5、`@fastify/multipart` 10、TypeORM 0.3、MySQL 8.4、Redis 7、React 19、Next.js 16、MUI 9、`pdf-lib` 1.17、`signature_pad` 5；server 新增 `pdf-lib`、Nodemailer、`@aws-sdk/client-sesv2`、`@aws-sdk/client-s3`、`@nestjs/bullmq` 11 與 `bullmq` 5

**Storage**: 既有 MySQL 電子簽 schema 加上窄化 migration；原始 PDF、簽名 PNG 與完成 PDF 在 local/test/UAT 存入 server/worker 共用且不對外公開的 persistent volume，production 存入 Block Public Access 的私有 S3，DB 只存 provider-neutral object key、版本、大小、MIME 與 SHA-256。各環境 driver 必須明確設定且啟動時 fail fast，production 不可 fallback 到本機檔案。Redis 承載 BullMQ job/scheduler，但不是簽署交易權威；MySQL outbox/reconciliation 處理 commit 後 enqueue 失敗，不能以 Redis 狀態取代或回滾 MySQL 業務結果。

**Testing**: Server Jest 30 單元測試、repository/service/processor integration tests、使用真實 Redis worker context 的 HTTP → BullMQ → worker → DB e2e、Nest/Fastify e2e 與 security e2e；Client 目前無 test runner，以 ESLint、Next build 與 quickstart 人工驗收補足

**Target Platform**: Linux 容器的 NestJS HTTP server 與獨立 BullMQ worker，共用 MySQL、Redis；local/test/UAT 共用私有 persistent volume，production 共用私有 S3；瀏覽器為公司 WebView 或一般現代瀏覽器

**Project Type**: pnpm workspace 內的 Next.js web client + NestJS REST API + 同 package worker

**Performance Goals**: 一般文件上傳／儲存在 5 秒內回應；簽署交易在 2 秒內完成不可變證據寫入；95% 一般文件在全員簽署後 2 分鐘內產生完成 PDF 並結案；worker 在截止時間後 60 秒內停止過期文件

**Constraints**: 僅接受未加密 PDF，單檔上限 20 MiB、100 頁、50 名簽署人、200 個欄位，單張 Canvas PNG data URL 上限 400,000 字元；簽署視窗是 `start <= now < end`；DB 與檔案寫入使用 UTC；發起後不可修改；同一簽署人最多一筆成功證據；不保存邀請 token 明文，僅保存 SHA-256 與待寄送期間所需的 AES-256-GCM 密文；外部簽署後以 path-scoped receipt 在文件終止後 30 日內取得結果；所有 cookie 寫入必須通過 OriginGuard；不將 PDF、簽名、cookie、token、完整 Email 或 provider response 寫入 log/error/URL 之外的非必要 payload；BullMQ job data 只放非敏感 local ID，不放 token/Email/PDF/PNG；不以固定業務 `jobId` 取代 DB 冪等；UAT volume 必須跨 HTTP/worker 與重啟共享；S3 bucket 不公開且不回傳 bucket URL；AWS 使用執行環境 IAM/default credential chain，不以 `.env` 保存 access key

**Scale/Scope**: 單一內部電子簽服務，第一版平行簽署主流程；4 個 user stories、36 項 functional requirements；不含拒簽、補簽、催簽、版本關聯、QR 公開驗證、一般匯出或長期封存

## Constitution Check

_GATE: Phase 0 前與 Phase 1 後皆已檢查，全數通過。_

- **KISS / YAGNI**: PASS。沿用 Spec 1 的電子簽 tables、Spec 2 session、現有 worker entrypoint、Redis 設定與 Client 編輯／Canvas UI。不建新 workspace package、不加版本系統、公開驗證、拒簽或催簽框架。環境已確認需要 local/S3 與 SMTP/fake/SES 差異，因此各自只建立一個窄化 port 與必要 adapter，不建立通用 provider framework。BullMQ 直接採用驗收系統的既有團隊模式，只建立 invitation/finalization/maintenance 三個明確責任，不建立通用 workflow framework。
- **Server 權威**: PASS。身分來自 Spec 2 session 或外部 invitation/receipt digest；PDF 格式、頁數、hash、欄位、期限、同意文案、文件狀態與所有寫入均由 Server 重新驗證。發起、簽署、停止與結案均以 transaction、DB constraint 與 finalization lease fencing 作最終仲裁。
- **最小權限與資料最小化**: PASS。內部 API 只回建立人或本人指派所需資料；外部 cookie 只能存取單一 signer/document。邀請原值僅存於 HttpOnly cookie 與寄信前的加密 outbox，成功寄送後清除密文。本地檔案不經 static hosting；S3 bucket 啟用公開存取封鎖，只授權應用程式角色讀寫必要 prefix。
- **清楚邊界**: PASS。Client 僅依 OpenAPI REST contract 存取 Server；controller 處理 multipart/cookie/HTTP，service 執行授權、交易與裁切，repository 封裝 TypeORM。HTTP process 只註冊 BullMQ producer，不載入 processor/scheduler；獨立 worker 才消費 invitation/finalization/maintenance queue 且不對外暴露 API。
- **與風險相稱的驗證**: PASS。規劃覆蓋 PDF 偽裝，跨文件授權，invitation 過期，發起／簽署／停止競態，簽署重放，hash 竄改，最後兩人並發，PDF 產製失敗，Redis/enqueue failure、重複 job、worker retry、stale lease 與敏感 log 裁切；真實 queue e2e 驗證 HTTP → BullMQ → worker → DB 鏈路。
- **技術與 workflow 約束**: PASS。維持 pnpm workspace 與現有 Next/Nest/TypeORM/MySQL/Redis 邊界；BullMQ 沿用驗收系統的 NestJS 11 團隊實作模式與既有 Redis 環境變數，只新增已核准流程所必需的 server PDF、Nodemailer、AWS SDK v3 S3/SES、private storage 及 queue dependencies。AWS 認證使用 default credential chain／workload IAM，不新增 access-key 環境變數；同步 `.env.example`、migration 與 `schema.sql`。

### Post-design re-check

Phase 1 設計仍無 constitution violation。資料模型只在既有 `esign_documents`、`esign_signers`、`esign_document_fields`、`esign_file_objects` 及通知表補上本流程不可缺少的欄位，沒有建立 queue job table、版本、提醒、匯出或公開驗證新模組。OpenAPI 將內部 session 與外部受限 cookie 分開，所有檔案回應都必須先通過 resource-level authorization。BullMQ 只傳遞 local ID 並驅動既有 service；MySQL outbox、row lock、unique constraint 與 lease fencing仍是唯一業務仲裁，maintenance reconciliation 使 Redis 短暫失敗不會永久遺失已 commit 工作。

## Project Structure

### Documentation (this feature)

```text
specs/003-core-esign-flow/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   └── external-invitation.md
└── tasks.md              # 由 speckit-tasks 後續產生
```

### Source Code (repository root)

```text
client/
├── src/app/(main)/forms/
├── src/app/(main)/my-signature/
├── src/app/external-signatures/
├── src/features/forms/
│   ├── editor/
│   └── api.ts
├── src/features/my-signature/
│   ├── sign/
│   └── api.ts
└── src/lib/api/

server/
├── .env.example
├── package.json
├── src/features/esign/
│   ├── esign.module.ts
│   ├── esign-queue.module.ts
│   ├── esign-queue.constants.ts
│   ├── controllers/
│   ├── dto/
│   ├── entities/
│   ├── repositories/
│   └── services/
├── src/infrastructure/
│   ├── bullmq/bull-root.module.ts
│   ├── database/migrations/<timestamp>-core-esign-flow.ts
│   ├── database/schema.sql
│   ├── file-storage/
│   │   ├── private-file-storage.port.ts
│   │   ├── local-private-file-storage.service.ts
│   │   ├── s3-private-file-storage.service.ts
│   │   └── file-storage.module.ts
│   └── mail/
│       ├── invitation-mail-sender.port.ts
│       ├── smtp-invitation-mail-sender.service.ts
│       ├── ses-invitation-mail-sender.service.ts
│       └── mail.module.ts
├── src/worker/
│   └── esign/
│       ├── esign-worker.module.ts
│       ├── external-invitation.processor.ts
│       ├── document-finalization.processor.ts
│       ├── esign-maintenance.processor.ts
│       └── esign-maintenance.scheduler.ts
└── test/
    ├── core-esign-flow.e2e-spec.ts
    ├── core-esign-flow-queue.e2e-spec.ts
    └── security-core-esign-flow.e2e-spec.ts
```

**Structure Decision**: 保留現有兩個 workspace packages 與獨立 worker entrypoint。Client 沿用 `forms` 與 `my-signature` UI，但移除 server-memory store 的權威角色，改由 feature-local API client 消費 Server contract；外部簽署用獨立公開頁，不接觸內部 layout/session。Server 將文件、簽署 task、外部 invitation/session 與三條窄化 BullMQ queue 收斂在單一 `esign` feature；共用 BullMQ Redis root、私有檔案與 invitation mail adapters 屬 infrastructure。Storage port 由環境綁定 local 或 S3，mail sender port 由環境綁定 fake、SMTP 或 SES；HTTP feature 可注入 queue producer，只有 `WorkerModule` 載入 processors 與 scheduler，避免 Web process 重複消費或註冊排程。

## Complexity Tracking

無 constitution violation。BullMQ 是本次明確核准、且有既有驗收系統實作可循的基礎設施增加：外部邀請、完成 PDF 與 60 秒內到期停止是三種不同負載／重試語意，單靠手寫 polling 會重造排程、喚醒與 retry；三條窄化 queue 是隔離寄信、PDF 與 maintenance latency 的最小切分。Storage 與 mail 各一個 port 是已確認部署矩陣所必需：前者只含 local/S3，後者只含 test fake/local SMTP/SES，避免業務 service 分散環境判斷。移除成本限於各窄化 adapter、Bull root、queue module、producer/processor/scheduler 與真 queue e2e；MySQL outbox、狀態條件與 lease fencing 均保持 transport-neutral，因此必要時可更換基礎設施而不改寫簽署證據模型。
