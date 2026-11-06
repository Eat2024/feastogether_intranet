# Implementation Plan: 已簽署 ZIP 按需更新與舊版清除

**Branch**: `dev`（實際 Git 分支；setup-plan 回報的 `030-refresh-signed-zip` 是 feature 識別，未切分支） | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

**Input**: `specs/030-refresh-signed-zip/spec.md`

## Summary

沿用現有匯出申請、工作佇列與串流 ZIP。新簽署只產生讀取時推導的過時狀態；明確申請才固定全部已簽紀錄。以文件鎖串行化申請、重試與版本發布，一份文件最多一個進行中工作。新版發布後將舊工作標成 superseded，實體 ZIP 標成 delete_pending，提交後刪檔，既有 maintenance 補償失敗。歷史保留但舊版停止下載。

## Technical Context

**Language/Version**: TypeScript；既有 Node.js >=24.22.1、pnpm workspace。

**Primary Dependencies**: 現有 Next.js 16／React 19／MUI 9／TanStack Query、NestJS 11／Fastify／TypeORM／BullMQ／archiver，不加套件。

**Storage**: MySQL 既有 esign_export_jobs／esign_file_objects，Redis 既有 queue，PrivateFileStorage 的 local／S3 實作。

**Testing**: Jest service/helper 測試、既有 MySQL/Redis e2e、storage 測試與瀏覽器操作；client 無測試框架，不新增框架。

**Target Platform**: 現有瀏覽器、HTTP server 與獨立 worker。

**Project Type**: 前後端 workspace。

**Performance Goals**: 新簽署及純讀取新增工作數為 0；同文件 10 個並行申請最多 1 個進行中工作；沿用 6,000 份容量驗證。串流處理不讀整包 ZIP 到記憶體。

**Constraints**: 不改簽署證據、不新增 table／欄位／環境變數／排程；打包與 storage I/O 不持有長交易；新版成功才刪舊版。

**Scale/Scope**: ZIP 匯出、預覽、歷史、下載及背景清理；Excel、個人 PDF 產製與下載規則不變。

## Constitution Check

| 原則 | 研究前 | 設計後 |
| --- | --- | --- |
| KISS／YAGNI | 限既有 ZIP 流程 | 通過：既有 varchar 狀態足夠，不新增 schema 或通用版本管理層 |
| Server 權威、證據完整性 | 後端判斷新增紀錄 | 通過：固定 record ID 名單、來源驗證及租約保留；不改個人副本 |
| 最小權限 | 沿用部門及 session | 通過：摘要只揭露狀態及數量，舊連結再次驗權與版本資格 |
| 邊界與 REST | 重用既有申請／查詢／下載 | 通過：GET 不打包；更新 POST 與指定成果下載分離 |
| 驗證 | 需要並發及故障驗證 | 通過：quickstart 列出真實 ZIP 內容、清理中斷、授權及容量測試 |

無未解決 gate；本輪只生成設計，不代表實作或測試通過。

## Project Structure

### Documentation (this feature)

```text
specs/030-refresh-signed-zip/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/zip-exports.md
└── checklists/requirements.md
```

tasks.md 留待 speckit-tasks，不在本輪生成。

### Source Code (repository root)

```text
client/src/features/esign-documents/{DocumentExportView,ZipExportPanel}.tsx
client/src/features/export-history/ExportHistoryView.tsx
client/src/api/{types,requests,queries}/esignExports.ts
client/src/api/types/esignDocuments.ts
client/src/api/errorCodes.ts
server/src/features/esign/
  controllers/exports.controller.ts
  dto/{export,esign-common,export-history}.dto.ts
  services/{esign-export,esign-export-history,esign-document-query}.service.ts
  repositories/{export-job,file-object}.repository.ts
  entities/{esign-export-job,esign-file-object}.entity.ts
server/src/worker/esign/document-export.processor.ts
server/src/common/errors/{app-error-code,app-errors}.ts
server/test/{esign-export,esign-export-history,export-retention,s3-export}.e2e-spec.ts
```

**Structure Decision**: 修改原 feature，不建立平行匯出系統。業務決策放 service，持久查詢與鎖放 repository，產製／發布／補清理在原 processor；新增 helper 只限有獨立業務判斷責任的 ID 集合比較。

## 實作設計

1. **讀取摘要**：匯出預覽增加 exportState，分開 current（最新未取代成功版）與 work（進行中或最新可重試失敗工作）。舊 exportSummary 保持窄摘要相容，詳見契約。只載 ID 集合計算新增數，避免輪詢或歷史列表重載 6,000 份 PDF metadata。
2. **申請**：文件鎖 → 驗權 → 找進行中工作 → 處理最新失敗工作 → 讀目前成功版及目前簽署 ID → 有新增才建立快照與工作。進行中直接沿用；失敗工作回傳失敗供明確重試，不能透過重新申請繞過。無新增且成功版缺檔，回不可用，不無聲重建。
3. **重試**：文件鎖 → 最新待處理工作鎖；已有其他進行中工作回該工作。只允許重試尚未被更新工作超越的失敗工作，保持原名單；較舊失敗、superseded、完整性失敗拒絕。舊 completed 不得搶走新 failed 的重試。
4. **產製**：保留來源等待、hash 校驗、租約及唯一 generation 物件。接收後的新簽署不參與本次 worker，不自動排下一版。
5. **發布**：完成儲存並確認新成果大小後，先鎖文件再鎖工作，重驗租約與文件存在，建立新 active file、completed job；同交易將較舊成功／曾成功工作的 ZIP 標 superseded／delete_pending。租約失效或提交失敗只處理本次暫存檔，不清舊成果。
6. **清理**：發布成功後退出產製失敗處理區塊，再以獨立 best-effort 清理。既有 maintain 掃描到期 superseded 且有 delete_pending ZIP 的工作補清理；刪檔成功後條件式標 deleted，失敗保存待清理狀態並延後重試。不可讓清理例外落回 worker 的 failed catch。
7. **前端**：顯示目前 ZIP 與更新進度；requestedId 固定本次工作。完成後刷新 preview／document／history cache，仍保留「下載本次成果」按鈕。尚有新增者另列「更新並下載 ZIP」，不在下載 handler 內呼叫申請。superseded 清掉舊下載操作並重新讀摘要，不自動更新。

## 發布、相容與回復

- 無 schema migration；status/archiveStatus 為既有 varchar(20)，無值列舉 CHECK。新增狀態須同步 entity 註解、DTO／client union、查詢與測試；schema.sql 結構無需變動。
- 不回填、不批次刪既有檔案。舊資料以最新曾成功且未 superseded 的工作作 current；即使該版缺檔也不退回較舊版假稱最新。首次明確更新成功才清該文件較舊成功成果。
- 既有 API、worker、client 必須同版發布；停止舊 worker 消費並完成／退出舊工作，待新版本接管後才開放更新。不能混跑舊 reusable 語意。
- 不把直接回退舊 binary 當作安全回復：舊程式會因 completedAt 選回 superseded，且不認新狀態。採含新狀態相容邏輯的修正版；已刪 ZIP 不可復原，個人 PDF 保留。
- 清理不新增排程；沿用既有 maintenance。local 與 S3 都要驗證，不能只以 mock 刪除成功宣稱已釋放空間。

## Complexity Tracking

無 constitution 例外。兩個新 file 狀態與一個 job 狀態是跨資料庫／儲存刪除補償所需；不用單純刪檔或覆寫原工作，因為無法安全恢復中斷且會破壞歷史。
