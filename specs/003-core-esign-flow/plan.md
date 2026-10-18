# Implementation Plan: 核心電子簽端到端流程 — 共用欄位與個人副本

> **本次 PR 範圍（2026-10-18）**：僅交付後端、migration 與契約；下文的前端設計及整合驗收保留為完整需求，前端實作由獨立 PR 交付。目前 client 為原有 mock 原型，不代表新版後端端到端流程已可由 UI 驗收。

**Branch**: `dev`（沿用工作分支） | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: Spec 003 的 2026-10-16 修訂；本文件是修改計畫，尚未執行程式或 migration。

## Summary

一份原始 PDF、一組共用欄位與一筆文件流程，對應多名簽署人及各人的已簽署 PDF。上傳不指定人，發起選擇名單、期間與選項；每人完成簽署後獨立產製副本，只有全員簽署及所有副本就緒才結案。3 個欄位指派 10 人仍為 3 個欄位，形成 10 份個人 PDF。

現有後端已具備文件、簽署交易、BullMQ worker 與 PDF 產製實作，本次調整其多人合簽模型。前端工作目錄仍含 mock store 與瀏覽器個人 PDF 產製，不代表正式串接已完成；其他工程師分支不在本次盤點範圍。

## Technical Context

- **Language/Version**: 沿用 TypeScript、Node.js 與 pnpm workspace。
- **Primary Dependencies**: 沿用 Next.js 16／React 19／MUI 9、NestJS 11／Fastify／TypeORM、pdf-lib、BullMQ；不新增套件。
- **Storage**: MySQL 為業務權威；Redis 只作工作喚醒。沿用 local/test/UAT 共用私有 persistent volume、production 私有 S3，以及現有儲存 adapter。
- **Target Platform / Project Type**: 現有 client/server 與 server 獨立 worker；不新增 package。
- **Testing**: Jest service/processor、MySQL schema/security e2e、真實隔離 Redis queue e2e；client lint/build 與人工驗收，無新增 client 測試框架。
- **Performance Goals**: 沿用簽署交易 2 秒、全員簽完後 95% 一般文件 2 分鐘內結案、到期 60 秒內停止目標；PDF I/O 留在 worker。至少 6,000 人（超過全公司五千多人規模）的個人副本負載須以測試量測；6,000 不是上限，不宣稱已達標。
- **Constraints**: 沿用 20 MiB、100 頁、200 個共用欄位及單張 PNG data URL 400,000 字元；不設每份文件的簽署人數上限；欄位上限不乘人數。簽署視窗 `start <= now < end`，UTC 保存，日期呈現台北時間。不可改寫既有證據。
- **Scale/Scope**: 修改現有流程、個人副本下載及必要 Spec 04 QR 相依；不擴增拒簽、版本、批次下載、一般匯出（Spec 05）、長期封存或新通知功能。

## Constitution Check

Phase 0 與 Phase 1 設計檢查通過；這是設計檢查，不代表實作測試通過。

- **KISS / YAGNI**：沿用現有資料表、三條 queue、30 秒 maintenance scheduler 與 storage/mail adapters，不增加資料表、環境變數、排程或通用抽象。
- **Server 權威**：簽署身分、欄位完整性、每人產物歸屬與下載權限由 server 重驗；前端不得提交別人的簽署證據 ID 作為自己的 owner。
- **證據完整性**：record 維持 append-only；新副本以本人 record + 共用欄位驗證。使用者確認舊資料皆為單人；不以舊資料相容阻擋本次交付，不重算原始證據摘要。
- **最小權限**：建立人可依人下載；內部簽署人只能下載本人。新版 FR-026 不延續 receipt 核發，外部副本由建立人取得；不復活已失效邀請。
- **清楚邊界**：client 只經契約串接；HTTP 只 enqueue，worker 產 PDF，MySQL lease/unique/transaction 作最終仲裁。
- **驗證**：覆蓋跨人存取、欄位污染、並發、重試、停止與 QR 摘要歸屬；驗收範圍見 quickstart。

## Project Structure 與修改範圍

路徑以下以 repository root 為基準；同名 service/processor 的既有 `.spec.ts` 隨行為同步。

| 範圍 | 主要檔案 | 必要修改 |
| --- | --- | --- |
| 上傳與發起 | `server/src/features/esign/dto/field.dto.ts`、`initiation.dto.ts`；`services/esign-field.service.ts`、`esign-initiation.service.ts`、`esign-signer.service.ts` | 刪除欄位 signer 指派輸入與 mapFieldsToSigners；名單變更不清除共用欄位；發起保存共用欄位及新 payload 形狀 |
| 簽署與任務 | `services/esign-signing.service.ts`、`esign-document-validation.service.ts`、`esign-signing-task.service.ts`、`esign-view.mapper.ts` 及相關 DTO | 移除依 field.signerId 過濾，改驗證 field.documentId；簽名以 record + field 隔離；每次成功簽署設個人產製 pending 並入列 |
| 資料模型 | `entities/esign-document-field.entity.ts`、`esign-signer.entity.ts`、`esign-file-object.entity.ts`、`esign-document.entity.ts` 及 repositories | 移除欄位 owner；新增 signer 個人產製狀態／lease；個人完成檔綁 signatureRecordId，保留 document 完成檔歸屬；退役 document lease |
| PDF | `services/completed-pdf.service.ts` | `create(documentId, signerId)` 只讀本人 record/PNG；從原始 PDF 合成本人日期與既有 QR，不讀其他人的簽名 |
| 背景作業 | `services/esign-job-producer.service.ts`、`esign-queue.constants.ts`、`worker/esign/document-finalization.processor.ts`、`esign-maintenance.processor.ts` | 工作粒度改 signer；復用現有 queue/scheduler；個人 lease fencing、失敗重試及整體結案判斷 |
| 下載與狀態 | `controllers/documents.controller.ts`、`signing-tasks.controller.ts`；`services/esign-access-policy.service.ts`、`esign-completion-access.service.ts`、`esign-document-query.service.ts` | 以 signer 定位副本；active/stopped 也可下載 ready 副本；creator 與本人權限分開；DTO 提供產製狀態 |
| 外部簽署 | `controllers/external-signature.controller.ts`、`services/esign-token.service.ts`、`esign-signing.service.ts`、`esign-completion-access.service.ts`、`helpers/external-signature-cookie.ts` | 依 FR-026 停止 receipt 核發及移除 external-completions 存取，簽完清除 access cookie；更新相關測試與文件 |
| QR（Spec 04 相依） | `services/esign-verification.service.ts`、`entities/esign-verification-record.entity.ts`、相關 repository/controller DTO/tests | 保留單一文件結案 snapshot，manifest v2 保存每人副本摘要；公開查詢依驗證碼找本人摘要，不再查唯一 document completed file |
| 前端 | `client/src/features/forms/editor/UploadEditor.tsx`、`SignersEditor.tsx`、`forms/actions.ts`、`types.ts`、`detail/SignerTable.tsx`、`detail/ExportSignerCopyButton.tsx`；`my-signature/actions.ts`、`sign/SignFlow.tsx`、`DownloadSignedCopyButton.tsx`、`signedPdf.ts` | 上傳位置共用；移除外部分支若有的欄位複製／人數換算；顯示個人產製狀態；正式下載走 server，原瀏覽器產物不得冒充正式副本 |
| Migration／文件 | 新 incremental migration、`server/src/infrastructure/database/schema.sql`、`doc/esign-db-schema.sql`、`server/docs/internal-electronic-signature-*`、Spec 04 相依文件 | 同步欄位、索引、check、API 與證據摘要語意；不修改已套用 migration |
| 驗證 | `server/test/core-esign-flow*.e2e-spec.ts`、`security-core-esign-flow.e2e-spec.ts`、`security-signature-verification.e2e-spec.ts`、schema tests | 將「唯一合併檔」斷言改為每人唯一副本，加入共用 field ID 與跨人隔離 |

## Phase 0：研究決策

詳見 [research.md](./research.md) 的 2026-10-16 修訂。核心決策：共用欄位、record 擁有個人產物、signer 保存產製狀態與 lease、文件只聚合進度。無需新資料表、套件或排程。

## Phase 1：設計與契約

- [data-model.md](./data-model.md)：欄位、檔案唯一性、個人狀態機、交易與遷移門檻。
- [contracts/openapi.yaml](./contracts/openapi.yaml)：欄位輸入不含 signerIndex/signerPublicId，個人下載資源與 completion 狀態。
- [contracts/external-invitation.md](./contracts/external-invitation.md)：簽後失效，無 receipt 下載。
- [quickstart.md](./quickstart.md)：10 人／3 欄位、並發重試、停止及授權驗收。

### 完成檔歸屬與未來簽到表

`esign_file_objects` 保存檔案 metadata，不作 document/signature 多對多關聯表。completed_pdf 恰有一種 owner：個人副本使用 signature_record_id，文件層級產物使用 document_id；兩者不可同時填或同時為 NULL，其他 owner/field 欄位為 NULL。保留 document-purpose unique，另加 record 完成檔 generated unique，分別保證每文件與每筆簽署證據最多一份完成 PDF。

本次 worker、下載、QR 與結案仍只走個人副本；不得因 DB 允許 document owner 而在個人下載缺檔時回退到整份完成檔。未來簽到表可在同一 document 下保存多人獨立證據及一份文件層級 PDF，簽署證據集合由結案 manifest 固定；其列排序、排版、產製與結案規則留待後續 spec，不在本次新增表或實作。

### Worker 與結案

每人簽署交易一併寫 `completion_status=pending`，commit 後 enqueue `{documentId, signerId}`。Claim lock 順序統一 document → signer；產檔在交易外；提交必須命中 signer lease token，再驗 source/payload/record，寫本人檔案與 `signer.copy_completed` audit。Ready 副本不可覆寫。

只要尚有人待簽，document 保持 active；最後一人簽完設 finalizing。所有人 signed 且副本 ready 後，同一短交易保存文件結案 snapshot、document.completed event 與 completed 狀態。後續個人產製失敗不回退已成立簽署。Stopped 文件仍可處理先前已簽者的副本，但永不由此自動結案。Finalizing 仍未完成，建立人可停止，需與結案同鎖仲裁。

Maintenance 掃描 signed 且 pending/failed、lease 過期的 signer（文件可為 active/finalizing/stopped），並補掃全員 ready 但未結案的 finalizing 文件。沿用既有 30 秒 scheduler；新舊 job payload 不混跑，部署時停止舊 worker 並清理／排空舊 finalization 工作。

### QR 與公開驗證

既有 verification code 與簽名版面沿用。結案 snapshot 仍為一文件一筆，manifest v2 的 signer 項目包含 record ID、本人 completed file ID/hash、個人完成事件 hash；`final_pdf_sha256` 改 nullable，新 manifest 不填單一整份文件摘要。公開回應 `completedPdfSha256` 在文件 completed 時回驗證碼所屬人的摘要；active/finalizing/stopped 維持 Spec 04 原有 null 語意。個人 PDF 已 ready 但流程未結案時，以檔案摘要／record／個人 audit 完成內部完整性驗證，不假稱整份流程已結案。Spec 04 文件與測試必須在同批實作同步。

### 遷移範圍

依使用者確認，舊資料只有單一簽署人且不要求本次處理舊流程相容；移除「只要有非草稿資料便中止」的部署門檻，不建立舊多人合簽與新模型雙軌服務。維持 incremental migration，不修改已套用 migration，也不以本次規劃自動刪除資料或重算歷史 payload／簽署證據。舊資料完整回放、舊 QR／receipt 相容不列入本次驗收。

欄位移除 signer owner 後保留位置。既有單人 completed_pdf 若需調整所有權，僅將 metadata 由 document 關聯到唯一簽署 record，保留 PDF bytes 與 hash；有既有檔的 signer 可回填 ready。舊 payload／snapshot 原值保留，不重新宣稱為新格式。停止舊 worker 並排空舊工作後部署新 worker；只在獨立測試 DB 驗證 schema 回滾，不透過回滾丟棄新副本。

### 全公司簽署規模

- 移除 `dto/signer.dto.ts`、`dto/initiation.dto.ts` 的 signer `ArrayMaxSize(50)`，以及 `esign-signer.service.ts`／`esign-initiation.service.ts` 的 50 人判斷；OpenAPI 不設 signers.maxItems。保留至少一人、資格及重複身分檢查。
- 前端名單與進度採分頁／虛擬呈現；全選與部門選取必須涵蓋完整結果，不能只選當前可見頁。檢查候選 API 分頁與名單傳遞，不能靜默少人；本次不新增另一套組織同步。
- Initiation 仍原子保存完整名單及固定 payload；批次查詢員工、分批寫入 signer/outbox，但同一次發起只能全成功或全失敗。避免逐人查詢與不受控 Promise.all；驗證實際 request bytes、代理／Fastify／Next body limit 與 transaction timeout，調整必要限制以通過 6,000 人名單，不以人數裁切規避。暫不新增名單匯入工作或設定變數。
- 簽署及個人 worker 只載入本人 record/PNG；全員完成判斷用 DB 聚合或 EXISTS，不在每次簽署載入／鎖定整份名單。維持 document → signer 鎖序，量測同文件並發的 document lock 等待時間。
- Maintenance 使用穩定游標分批掃描至處理完整批次集合，避免反覆只掃前 100 筆；queue 生產與消費設有界批次／併發，不一次把所有 PDF／PNG 載入記憶體。分批大小只是處理策略，不能成為文件簽署人數上限。
- Manifest v2 保留完整名單與每人摘要，但結案批次讀取 metadata，不把全公司 PDF bytes 放入同一交易／記憶體；ready 時逐檔驗證，結案驗證記錄與摘要關聯。量測 manifest 大小、JSON／DB packet、結案交易及個人 PDF 儲存量。
- 驗收使用 6,000 名合成員工，另測 6,001 名可儲存／發起以避免把測試基準寫成上限；全流程無遺漏、無重複且恰有每人一份副本。記錄發起耗時、峰值記憶體、queue 積壓、DB lock 等待及結案時間，不宣稱尚未測得的效能。現有一般文件時效目標保留，全公司壓測另列實測數據。

### 實作順序

1. 契約與 schema／migration／constraint tests，移除各層人數上限。
2. 共用欄位、發起 payload、簽署與本人任務裁切。
3. 個人 PDF、queue／lease／reconciliation 與結案 snapshot。
4. 個人下載授權、Spec 04 摘要對應、外部 receipt 移除。
5. 前端串接及完整 e2e／security／queue 驗收，包含全公司 6,000 人規模與 6,001 人無硬上限檢查。

舊 tasks.md 的完成勾選只代表舊模型，下一步須用 speckit-tasks 產生本次增量任務，不得直接宣稱新模型完成。

## Complexity Tracking

新增 signer 狀態/lease 是獨立產製及跨 worker 冪等的必要資料；復用 record 擁有完成檔，避免新副本表。文件 snapshot 改 manifest v2 避免每人新增驗證資料表。既有 storage/mail 環境矩陣、外部 invitation outbox、session 與來源 PDF 預覽防護保持既有設計；本次不新增基礎設施。個人副本增加儲存量與 PDF 工作數，效能驗收須量測，而非由原單檔測試推定。
