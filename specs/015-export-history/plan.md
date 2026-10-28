# Implementation Plan: 歷史匯出紀錄 API

**Branch**: 未建立（設計基線為 `dev`）| **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

**Status**: 待使用者審查；本 spec 只做後端

## Summary

把歷史匯出紀錄統一放在 `esign_export_jobs`，以 `GET /api/esign/history/export?type=excel|pdf|zip` 提供頁碼分頁查詢，並取代 `GET /api/esign/exports`。

- **Excel**：清單在瀏覽器產生，由前端以 `POST /api/esign/history/export` 回報紀錄。
- **單人 PDF**：建立人下載、簽署人本人下載與從紀錄重新下載，都改為 POST 子資源，在回傳 PDF 的同一請求寫入紀錄，並移除原本的 GET 下載路由。
- **ZIP**：沿用 Spec 009，不變。

Migration 只擴充既有表：`created_by_user_id` 改為可 NULL，新增 `signer_id`、`conditions_json`、一個索引與一個 CHECK。

本 spec 只做後端；前端改動在後端完成後交給前端工程師，交接內容見 contract。

## Technical Context

| 項目 | 設計 |
|---|---|
| Language/Version | TypeScript；server NestJS 11／Fastify |
| Primary Dependencies | 既有 TypeORM 0.3、MySQL 8.4、class-validator；不新增 dependency |
| Storage | MySQL `esign_export_jobs` 擴充；PDF 讀取沿用既有私有檔案儲存與完整性驗證 |
| Testing | server Jest unit、MySQL e2e、schema migration／constraints e2e、api-coverage |
| Target Platform | 既有 HTTP server；同源 Next.js proxy |
| Project Type | pnpm workspace Web 應用 |
| Performance Goals | 歷史查詢單次兩條 SQL（列表＋分組計數），走 `(export_type, created_at, id)` 索引；ZIP 頁每筆仍查一次檔案，與現行 `/exports` 相同 |
| Constraints | GET 不寫入；下載有檔案就有紀錄；不動 ZIP 流程；不新增 table、環境變數或角色機制 |
| Scale/Scope | 4 個 user story、FR-001–014；6 條新路由、3 條移除 |

## Constitution Check

| Gate | Phase 0 | Phase 1 設計檢查 |
|---|---|---|
| I KISS/YAGNI | 通過：沿用既有表與 PDF 讀取／驗證服務 | 只加兩欄、一個索引、一個 CHECK；API↔DB 類型對應只有一處；不改 ZIP 的 DB 值 |
| II Server 權威 | 通過：匯出人一律取自 session 或存取 cookie，不接受前端傳入 | Excel 的範圍與筆數由前端回報，後端只能驗證身分與文件；已在 spec Assumptions 記錄 |
| III 最小權限 | 通過：開放範圍由 Portal 決定，本專案不判斷角色（同 Spec 009） | Excel 重新下載資料用窄回應，不回管理備註與通知紀錄；電子簽加上 role／permission 後再限制 |
| IV 邊界／REST | 通過：寫入紀錄的下載改用 POST 子資源，GET 只讀 | `history/export` 為資源集合；`…/downloads` 子資源表達「取得一次並記錄」；Controller 薄層，寫入在 service |
| V 驗證 | 通過 | migration up／down、CHECK、授權失敗、舊 GET 回 404、紀錄寫入失敗不回檔、分頁與總數、ZIP 不受影響，都有自動化測試 |

沒有違反項目，Complexity Tracking 不需填寫。

## Project Structure

```text
specs/015-export-history/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/export-history-http-api.md
```

```text
server/src/infrastructure/database/
├── migrations/1792454406000-ExportHistory.ts    # 新增
└── schema.sql                                    # schema:dump 更新
doc/esign-db-schema.sql                           # 同步

server/src/features/esign/
├── entities/esign-export-job.entity.ts           # createdByUserId 可 NULL、signer、conditionsJson、索引、CHECK
├── dto/export-history.dto.ts                     # 新增：查詢參數、Excel 紀錄 body
├── repositories/export-job.repository.ts         # 新增 history 列表／分組計數；移除舊 history()
├── services/esign-export-history.service.ts      # 新增：查詢、Excel 記錄、PDF 記錄、重新下載、Excel 資料
├── services/esign-export.service.ts              # 移除 history()；view() 供 ZIP 項目沿用
├── services/esign-view.mapper.ts                 # 沿用簽署人 view，另出 Excel 用的窄 view
├── controllers/export-history.controller.ts      # 新增：esign/history/export 四條路由
├── controllers/exports.controller.ts             # 移除 GET exports
├── controllers/documents.controller.ts           # GET …/completed-file → POST …/completed-file/downloads
├── controllers/external-signature.controller.ts  # GET external-signing-task/completed-file → POST …/downloads
└── esign.module.ts                               # 註冊 controller／service

server/test/
├── esign-export-history.e2e-spec.ts              # 新增
├── api-coverage.e2e-spec.ts                      # 新路由；舊 GET 回 404
├── core-esign-flow.e2e-spec.ts                   # 下載改 POST
├── esign-document-delivery-security.e2e-spec.ts  # 下載改 POST
├── esign-export.e2e-spec.ts                      # /exports 改用新路由
├── schema-migration.e2e-spec.ts                  # up／down 與回退保護
└── schema-constraints.e2e-spec.ts                # CHECK
```

**Structure Decision**：
- 新功能放在既有 `server/src/features/esign`。歷史查詢與記錄獨立成 `EsignExportHistoryService`，ZIP 工作邏輯仍留在 `EsignExportService`。
- PDF 讀取與完整性驗證沿用 `EsignCompletionAccessService.personalCopy` 與 `ExternalAccessService.completedFile`，只在 controller 回應前呼叫 history service 寫入紀錄。
- 不改 `client/`。後端完成後，把 contract 交給前端工程師。

## 實作順序

1. **Schema**：migration、entity、schema dump、schema e2e。
2. **查詢**：`GET history/export`（三類型、`documentId`、`typeTotals`），移除 `GET exports`；同步調整 `esign-export.e2e-spec`。
3. **Excel**：`POST history/export` 與 `GET history/export/{id}/document`。
4. **PDF**：三條 `…/downloads` POST、移除兩條 GET；同步調整相關 e2e。
5. **驗收**：依 quickstart 執行 server lint:check／test／test:e2e。
6. **交接**：把 contract「前端交接」交給前端工程師。

每一步都能獨立驗收。

## 風險與限制

- **前後端要一起部署**：後端移除舊 GET 下載與 `/exports` 後，現有前端的 PDF 下載（檢視頁、外部簽署完成頁）與 ZIP 面板會失效，直到前端工程師改完。後端合併到 `dev` 後、前端改完前，這三處在 `dev` 上無法使用；部署到 UAT／正式環境時必須連同前端改動一起上。
- **Excel 紀錄由前端回報**：無法證明使用者真的下載了檔案，也無法驗證筆數。
- **資料開放範圍**：由 Portal 決定；能進入電子簽的員工都能取得任一文件的簽署人清單與單人副本，電子簽加上 role／permission 後再限制。
- **歷史頁尚未改串接**：串接完成前，`/export-history` 仍是 mock，不得描述為已完成。
