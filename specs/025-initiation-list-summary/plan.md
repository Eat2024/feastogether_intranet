# Implementation Plan: 發起受理後立即顯示文件列表摘要

**Branch**: 文件工作目前位於 `fix/esign-initiating-status`；尚未建立 025 實作分支。setup-plan 回傳的 `025-initiation-list-summary` 為 feature 推導值，並非實際 Git checkout。

**Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

## Summary

沿用已存在的草稿文件與 Spec 022 的可靠受理交易。發起受理先保存本次 inputJson、totalCount，提交後才 enqueue；不新增文件列、不預建正式簽署人，也不提前改 active。列表從有效任務取得輕量 initiation 摘要，顯示發起中、確認期間與 0/N，成功後使用正式文件資料。

2026-11-04 已確認 PR #50 已合併（2026-11-04T03:23:49Z）。沿用其狀態、篩選、每 2 秒更新與操作停用；本次補上日期與預計人數。詳見 [research.md](research.md)。

## Technical Context

**Language/Version**: TypeScript；Node.js 依 workspace engines（>=24.22.1）。
**Primary Dependencies**: NestJS 11、TypeORM、MySQL 8.4、BullMQ／Redis；Next.js 16、React 19、TanStack Query、MUI。
**Storage**: 既有 esign_documents、esign_initiation_jobs；使用 total_count 與 input_json 中的 signStartAt/signEndAt，不新增 schema。
**Testing**: Jest service 測試、MySQL 隔離資料庫整合測試、既有 HTTP e2e、前端瀏覽器驗收；client 無測試框架，不新增框架。
**Target Platform**: Docker server／worker 與瀏覽器，UAT 作整合驗收。
**Project Type**: pnpm workspace web application。
**Performance Goals**: 前置名單解析完成後至列表可見摘要 P95 <=3 秒；終態更新 <=5 秒；1、100、5213 人各 20 次。
**Constraints**: 不排序或回傳完整任務 JSON；無逐文件 N+1；不改既有簽署、白名單、worker 原子性、防重、保留與異動鎖。
**Scale/Scope**: 部門／建立人文件列表與發起受理後導航；正式簽署流程及大量寫入仍交由既有 worker。

## Constitution Check

| Gate | 規劃前／設計後結論 |
|---|---|
| KISS／YAGNI | 通過：沿用已存資料與既有輪詢，不新增 table、欄位、env、排程或 dependency。 |
| Server 權威 | 通過：正式狀態仍由 worker 全部成功提交；受理摘要不授予簽署權限。 |
| 最小權限 | 通過：僅對原可讀文件回傳日期與人數，沒有名單、token、租約或任務完整輸入。 |
| 系統邊界 | 通過：repository 投影、service 協調、mapper 裁切，client 經既有 API 層。 |
| 驗證 | 通過：計畫涵蓋 MySQL filesort、並發狀態、角色、失敗與容量測試。尚未執行本功能測試。 |

無須 Constitution 例外；沒有未解決的 NEEDS CLARIFICATION。

## Project Structure

### Documentation (this feature)

```text
specs/025-initiation-list-summary/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/list-summary.md
├── quickstart.md
└── checklists/requirements.md
```

### Source Code (repository root)

| 檔案 | 預計變更 |
|---|---|
| server/src/features/esign/repositories/document.repository.ts | 窄欄位查詢取得有效任務 ID／totalCount；無排序批次投影確認日期；型別化 initiation 摘要。 |
| server/src/features/esign/services/esign-document-query.service.ts | 列表所有讀取使用同一 REPEATABLE READ 交易快照，確保文件、任務、名單統計一致；無悲觀鎖。 |
| server/src/features/esign/services/esign-view.mapper.ts | 列表映射 initiation 摘要；有效任務時狀態為 initiating；其他正式欄位語意保留。 |
| server/src/features/esign/dto/esign-common.dto.ts | 僅列表 DTO 新增 initiation 可空摘要，不擴充文件詳情權限。 |
| client/src/api/types/esignDocuments.ts | 新增列表摘要型別；補正 initiateDocument 回傳為既有 job 摘要，而非文件詳情。 |
| client/src/api/requests/esignDocuments.ts | 修正 initiation 回傳型別與註解，不改路由及伺服器受理語意。 |
| client/src/features/esign-documents/DocumentSignersEditor.tsx | 保存此次提交的確認日期，使用受理 job.totalCount 建立即時快取摘要；不引用提交後可能變動的表單狀態。 |
| client/src/features/esign-documents/listQuery.ts | 集中決定列表顯示期間與計數，日期篩選／排序也採同一顯示來源。 |
| client/src/features/esign-documents/DocumentsTable.tsx | 發起中顯示摘要日期與 0/N，提供預計人數說明；正式狀態沿用既有統計。 |
| server/src/features/esign/services/esign-document-query.service.spec.ts | 覆蓋摘要、終態移除、權限範圍及既有狀態。 |
| server/test/esign-document-list-scale.e2e-spec.ts | 256 KiB 排序緩衝區、大型任務 JSON、摘要投影及固定查詢數回歸。 |
| server/test/esign-initiation-query.e2e-spec.ts／esign-initiation-acceptance.e2e-spec.ts | 延伸受理即見、重整、並發成功／失敗、授權與防重驗證。 |

**Structure Decision**: 不建平行列表或新 endpoint；狀態選項、輪詢與按鈕停用直接沿用 PR #50。

## 追加範圍：建立時間欄

既有列表 DTO、client 型別與 mapper 已包含 createdAt，repository 已選取 document.createdAt，因此不需新增 API 欄位或 schema。DocumentsTable.tsx 在文件編號後新增「建立時間」欄，將 createdAt 明確以 Asia/Taipei 顯示 YYYY/MM/DD HH:mm；同步表頭、COLUMN_COUNT／colSpan 及窄螢幕版面。listQuery.ts 可沿用日期工具，但不得依使用者瀏覽器時區造成非台北結果；不改動其他頁面既有日期格式或列表預設排序。驗收確認它不是 signStartAt、acceptedAt、updatedAt，且發起前後不變。

## Phase 0 — Research

完成受理順序、資料來源、列表效能、狀態競態與前端呈現調查；決策見 research.md。無需引入外部服務或查詢新技術。

## Phase 1 — Design

### 受理與執行順序

```text
上傳／建立草稿：已有 esign_documents 一列
使用者確認名單與期間
  → 既有受理檢查
  → 同一交易保存 job.inputJson、totalCount、queued
  → commit（此時列表已能讀到摘要）
  → enqueue 既有 worker；回傳受理摘要
  → client 導回列表，立即顯示發起中＋期間＋0/N
worker 建立正式簽署人／欄位／通知等資料
  → 同一正式交易成功後，列表改用正式狀態與統計
```

worker 可能在導頁前完成，不要求人為延遲；列表以最新可靠資料為準。enqueue 失敗的既有恢復機制不改；若受理已提交但回應遺失，重整仍可取得摘要。

### 列表讀取一致性及效能

1. 在既有 list service 內以同一 EntityManager、REPEATABLE READ 交易執行列表讀取，保留原有權限查詢；不使用 FOR UPDATE，不鎖 worker。
2. DocumentRepository 排序查詢僅讀文件小欄位，透過既有 active_document_id 唯一索引連結任務 ID／totalCount；不選取 input_json，也不在排序查詢執行 JSON_EXTRACT。
3. 對已捕捉的 job ID 做一次批次、無排序日期投影，只抽取 signStartAt/signEndAt。沿用既有原始截止時間的獨立無排序投影，不把大型 JSON 回傳應用程式。
4. DTO 僅加入 initiation: { signStartAt, signEndAt, totalCount } | null；pendingCount／signedCount 不塞入預計值。使用相同快照讀正式簽署統計，避免 worker 提交介於兩次查詢之間產生混合狀態。
5. 發起中摘要只存在於 draft＋有效任務。失敗後為 null，顯示原草稿；成功後為 null，顯示正式文件。短暫舊快照可在下一次輪詢收斂，禁止永久卡住。

### 即時畫面與快取

- 修正目前把 POST 回應誤標為 EsignDocumentDetail 的 client 型別，使用既有 InitiationJobDto 對應型別。
- 成功受理且回傳 queued／processing 時，以此次已提交的期間及 job.totalCount 初始化列表快取；維持 cache cancel → set → invalidate，導頁不等大量寫入。
- 若快取已是正式狀態，不以受理時的舊 job 回應把它降回 initiating。非進行中回應只重新查詢，不合成發起中資料。
- 未快取的列表由正常讀取取得完整摘要，不虛構缺少文件名稱／建立人的列表列。
- 顯示與日期篩選／排序共用 helper；發起中分子固定 0，分母摘要 totalCount，進度條為 0%，附「預計簽署人數」說明。
- 延用每 2 秒輪詢；終態不再使用摘要。失敗詳情／重試介面不在範圍。

### 驗證與發布

見 quickstart.md。先部署相容的 server，再部署 client；列表新增可空摘要為擴充欄位，舊 client 可忽略。新 client 缺少 initiation 時依舊欄位呈現，不能捏造摘要。回滾僅需程式碼，不需清理資料。受理／worker 寫入與通知行為無需修改。

## Complexity Tracking

無違規例外。新增的短讀取交易用於同一列表回應的一致性，並非額外背景工作或鎖定；驗收需觀察列表耗時與 worker 是否被阻塞。
