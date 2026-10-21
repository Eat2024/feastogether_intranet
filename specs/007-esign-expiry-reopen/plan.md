# Implementation Plan: 文件已到期狀態與補簽

**Branch**: `007-esign-expiry-reopen` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

**Input**: `specs/007-esign-expiry-reopen/spec.md`

**Status**: 後端實作與驗證完成，前端正式串接另行交付。功能分支自更新後的 `dev`（`b9ae324`）建立。

## Summary

到期改為 `expired`，建立人以新截止時間及原因重新開放。沿用 `sign_end_at` 作為目前有效期限，原始期限保留在不可變簽署快照；補簽歷程追加到既有 audit_events。不新增資料表、欄位、依賴、環境變數或排程，migration 僅擴充文件狀態 CHECK。

補簽採文件鎖及 `expectedSignEndAt` 比對，避免同輪與跨輪重送，不建立額外冪等性基礎設施。新增補簽子資源及建立人取得補簽邀請的唯讀端點。既有背景到期工作、個人副本與外部邀請流程作必要調整。

## Technical Context

**Language/Version**: TypeScript 5.7（server package 宣告）；Node >=20.19。

**Primary Dependencies**: 沿用 NestJS 11、Fastify、TypeORM 0.3、BullMQ；client 為 Next.js 16、React 19、MUI 9。無新增套件。

**Storage**: MySQL 8.4 保存文件、簽署人及 hash-chain 稽核；Redis 7 沿用既有 worker queue；簽署檔案沿用受控儲存。

**Testing**: server Jest、既有真實 MySQL/Redis e2e 與 schema 測試；client 無自動測試框架，正式串接另做 lint/build 與人工驗收。

**Target Platform**: 既有 HTTP server、獨立 worker 與內部 Web 系統。

**Project Type**: pnpm workspace Web application。

**Performance Goals**: 沿用既有每批 100 筆到期掃描；每次補簽只處理單一文件及其未簽署者，不新增全表歷程掃描或逐文件排程。不額外宣稱未量測的吞吐量。

**Constraints**: 不重寫已簽證據；同一文件寫入沿用一致鎖順序；GET 不寫業務資料；有限截止時間，UTC 儲存；邀請不得進入一般 DTO、log 或歷程。

**Scale/Scope**: 單一 esign feature 的狀態與期限擴充；本計畫先交付後端與串接契約，前端依 repository 分工另行交付。完整產品驗收仍需前端正式串接。

## Constitution Check

Phase 0 前檢查與 Phase 1 後複查均通過：

| 原則 | 設計依據 |
| --- | --- |
| KISS / YAGNI | 復用期限欄位與稽核表；不引入新表、輪次欄位、排程或通用狀態機 |
| Server 權威／證據 | 鎖內重驗資格與時間，原 payload/hash、簽章及副本不變；期限異動另存稽核 |
| 資料最小化 | 補簽原因／操作者僅建立人可讀；邀請限定專用 creator-only 入口 |
| 系統邊界 | REST 子資源；Controller → Service → Repository；前端只依契約串接 |
| 風險相稱驗證 | 覆蓋截止、重送、競態、邀請、證據及 migration；未完成前端不宣稱完成產品 |

後端 lint/test/build、HTTP/DB、security 與 schema 檢查結果已記錄於 quickstart。本功能無 extension hooks 設定。

## Project Structure

### Documentation (this feature)

```text
specs/007-esign-expiry-reopen/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── tasks.md
├── contracts/http-api.md
└── checklists/requirements.md
```

`tasks.md` 已依本計畫產生，後端任務已完成；實際測試配置與交接限制見 tasks.md 及 quickstart。

### Source Code (repository root)

```text
server/src/features/esign/
├── controllers/documents.controller.ts
├── dto/                         # 補簽輸入、狀態與摘要 DTO
├── entities/esign-document.entity.ts
├── repositories/                # 現有文件、通知與稽核 repository
└── services/                    # 新增 esign-reopening.service.ts；調整既有到期、查詢、驗證與 mapper
server/src/worker/esign/          # 到期維護、舊通知防護、個人副本
server/src/common/errors/app-errors.ts
server/src/infrastructure/database/
├── migrations/                 # 新增 expired CHECK migration
└── schema.sql
server/test/                    # 延用 core-esign-flow / schema / security 套件
client/src/features/forms/      # 獨立前端 PR 對接入口
client/src/features/my-signature/
```

**Structure Decision**: 補簽放在 esign 業務服務；有效狀態計算放現有 validation/mapper 責任範圍，不建立新 framework。既有 token service 負責新憑證，audit service 負責歷程。

## 實作順序與交付邊界

1. 更新文件狀態 CHECK、entity、DTO、schema 與對應測試；定義有效狀態及期限語意。
2. 將 expiry 從 stoppage 分離：同樣的 worker 轉 expired、清除未簽邀請並追加到期事件；延遲排程時查詢仍正確。
3. 新增補簽交易與專用邀請讀取；使用既有 audit metadata 白名單，補齊歷程裁切；處理舊寄信工作失效。
4. 個人副本、已簽者來源讀取及簽署回傳納入 expired；保留 finalizing → completed 與原有停止規則。
5. 更新 Swagger／正式 OpenAPI、Spec 03 相關文件與測試預期，交付後端驗證；前端 PR 依本契約修改補簽對話框及清單。

實作同步文件清單：Spec 03 spec 的 FR-036／到期決策／排除補簽條目、data-model、contracts/openapi.yaml、research 到期決策與 quickstart 到期案例；舊 tasks 保留歷史完成紀錄，加上 Spec 007 取代註記，不改寫為新功能已完成。Spec 007 契約為新增行為的設計依據，規劃文件不宣稱現行 API 已改變。

## Complexity Tracking

無需原則例外。唯一 schema 變更是已授權新狀態所需的 CHECK；邀請讀取端點是原規格要求建立人轉交連結所必需，現有程式沒有此入口。完整設計取捨見 research.md。

## 實作交付

補簽 POST 與建立人邀請 GET、完整性／重送保護、舊通知退休及 worker 世代防護、角色歷程裁切已完成。沿用現有表與欄位；signer 邀請送達時間的 TypeScript 型別補齊既有 nullable schema，不新增 migration。無新增 dependency、環境變數、排程，.env.example 不需變更。

部署順序：先停止舊 expiry worker，套用 ticket 01 的 expired CHECK migration，再協調更新 HTTP／worker 並恢復 worker；不能混跑舊版到期永久停止邏輯。已有 expired 或 reopened 歷史時 migration down 拒絕，應向前修正。本次未部署、未修改正式資料；client 仍為 mock 原型。
