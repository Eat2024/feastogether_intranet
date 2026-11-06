# Implementation Plan: 電子簽 UAT 操作調整

**Branch**: 文件預定分支 `docs/spec-019-uat-refinements`；規劃時工作分支為 `dev`，未自行切換或覆寫其提交。
**Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)
**Input**: `specs/019-esign-uat-refinements/spec.md`

## Summary

本計畫涵蓋六項已確認需求：歷史重下載不新增紀錄、ZIP 永久沿用、兩個列表搜尋與分頁、組織圖 30 分鐘快取、移除 Email 預檢、後端提供歷程中文標籤。沿用現有 feature 與 API，不新增 DB 表／欄位、環境變數、套件或排程。本計畫已完成實作；驗證見 quickstart.md。尚未部署或變更 UAT 資料，Spec017 部門整合驗收已完成。

## Technical Context

- **Language/Version**：TypeScript、Node >=24.22.1。
- **Primary Dependencies**：Next.js 16、React 19、MUI 9、TanStack Query 5；NestJS 11、Fastify、TypeORM 0.3、BullMQ。
- **Storage**：MySQL 8.4、Redis 7、既有 PrivateFileStorage（local/S3）。
- **Testing**：server Jest unit／HTTP與真實 MySQL/Redis e2e；client 現無 test script，使用 lint/build 與瀏覽器驗收，不新增測試框架。
- **Target Platform / Project Type**：pnpm workspace Web 應用、HTTP server 與獨立 worker。
- **Performance Goals**：歷史每頁 10 筆；查詢在 DB 分頁前完成篩選，計數不載入快照；重複 ZIP 申請不重新打包。沿用 UI 搜尋 300ms debounce、匯出進度 3 秒輪詢。
- **Constraints**：不可改寫簽署證據；不可自動重建缺失 ZIP；資料來源失敗不當成查無信箱；授權最後由 server 驗證。
- **Scale/Scope**：6 個 user stories、28 項 FR、17 項 SC；沿用最多 6,000 位簽署人的既有批次限制。不設定尚無量測依據的延遲 SLA。

## Constitution Check

| 原則 | Phase 0 | Phase 1 設計後 |
| --- | --- | --- |
| KISS/YAGNI | 通過 | 沿用資料模型及端點，僅新增顯示欄位與查詢參數 |
| Server 權威與證據 | 通過 | 權限在 server，audit 原值及 hash 不改 |
| 最小權限 | 通過 | 搜尋、計數、單筆與下載沿用同部門政策；本人簽署例外保留 |
| 邊界與 REST | 通過 | GET 無業務寫入；既有 POST 下載明列不記錄且重複可安全呼叫 |
| 驗證 | 通過 | 檔案存取、授權、搜尋與資料轉換規劃自動測試及瀏覽器驗收 |

Spec 017 是一般匯出／歷程同部門存取的交付前整合依賴，已由 dev 的 PR41 合入並完成驗證，一般匯出及歷程目前採同部門授權。Spec 018 與本項不互相實作，但整合後不得刪掉其所需 HR service 或繞過寄信白名單。無憲章例外。

## Project Structure

```text
specs/019-esign-uat-refinements/
  spec.md / plan.md / research.md / data-model.md / quickstart.md
  impact-analysis.md / history-event-inventory.md
  contracts/uat-refinements.md
  checklists/requirements.md
client/src/
  api/{types,requests,queries}/
  features/{export-history,esign-documents,signing-tasks}/
  components/{SearchField,LinkPagination}.tsx
server/src/
  features/esign/{controllers,services,repositories,dto}/
  worker/esign/document-export.processor.ts
server/test/
```

**Structure Decision**：所有業務修改留在 esign；共用 HR infrastructure 僅保留既有查詢能力。實作階段新增一次性 `server/scripts/normalize-export-retention.ts` 用於既有 ZIP 盤點／受控資料轉換，不作為啟動 migration 或背景工作。`tasks.md` 已產生，列出六項故事的待實作任務。

## 六項實作設計

| US | 改動與責任 | 驗收 |
| --- | --- | --- |
| 1 | Excel 歷史入口只 build/download；PDF redownloadPdf 不再 recordPdf，保留檔案就緒及授權；正常匯出仍記錄 | 重複／並發／失敗都零新增紀錄，新匯出仍記錄 |
| 2 | repository reuse、service view/download、worker expiry 分支與前端提示一併調整；保留輪詢與失敗重試 | 第8/365天仍可下載；新增簽署不改 ZIP；缺檔不重建 |
| 3 | 我的電子簽保留前端全量篩選分頁，補齊穩定排序／合法頁碼；歷史加入 q、creator join、共用條件 counts/items | 23筆為10/10/3，特殊字元、跨頁與權限皆正確 |
| 4 | TTL 1800，key namespace v2；更新前端舊兩小時註解及規格 | 1799/1800邊界、不續期、舊key不命中 |
| 5 | 刪除預檢端點與專用 DTO/method，移轉仍有價值的容量測試 | 舊端點不可用；無信箱保留指派；來源故障保持草稿 |
| 6 | 後端單一 label 對照，統一補簽 actor shape，前端直接顯示 label | 27種＋未知事件、補簽分支與稽核不變 |

詳細 API、資料轉換與測試見 contracts、data-model、quickstart。所有實作檔案以 impact-analysis 為索引，避免順手重構。

## 實作順序與交付

1. 先鎖定 contracts 及同部門權限整合點，建立有價值的失敗案例。
2. US1／US2 共同處理匯出服務與歷史 UI，完成 ZIP 受控轉換工具；US3／US6 的歷程 API 與型別同步。
3. US4／US5 修改快取與預檢，保留發起流程回歸測試。
4. client/server 整合後執行 quickstart 的驗證；文件契約、Spec006/010/015 過時描述同步。既有驗證證據保持原日期與原結果。
5. 部署採後端先支援 label/q 與下載語意，再發布前端；ZIP 政策切換需停止舊 worker 清理並轉換，不允許新舊清理政策同時運作。

## Complexity Tracking

無需例外。一次性資料工具是現存檔案與 DB 狀態必須共同核對的最小作法；不新增持續運行的框架、表或排程。

> 2026-11-06 退役註記：上述 normalize-export-retention 一次性工具已於 Spec 030 後續清理移除，舊紀錄僅供追溯，不再作為操作入口。有效 ZIP 不依期限失效；新版取代與清理由 Spec 030 管理。
