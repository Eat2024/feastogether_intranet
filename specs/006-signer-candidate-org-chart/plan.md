# Implementation Plan: 簽署人候選組織架構與兩小時快取

使用者後續要求採 KISS：讀快取 → 未命中呼叫上游 → 寫入 7,200 秒快取 → 回傳。允許同時未命中重複呼叫；不再使用鎖、輪詢、二次讀取或發布期限。Redis 使用既有 get/set。

**Feature**: `006-signer-candidate-org-chart` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

**狀態**：[tasks.md](tasks.md) 已完成實作與本機驗證；結果見 [quickstart.md](quickstart.md)。

## Summary

新增 `GET /api/esign/signer-candidates/org-chart`，提供上游正式員工組織樹。沿用員工 session，暫不加入 Role／Permission／部門授權。成功名冊經欄位裁切後共用 Redis 快取 7,200 秒，過期由下一次查詢更新。

## Technical Context

| 項目 | 規劃 |
| --- | --- |
| 語言／平台 | TypeScript、現有 Node.js server runtime |
| 框架 | NestJS 11、Fastify、既有 Swagger／session guard／response interceptor |
| 上游 | FeastogetherClient（Axios）與 FeastogetherDepartmentService；API Key 認證 |
| 儲存 | 現有 Redis 7 / ioredis；不新增 MySQL 寫入或資料表 |
| 測試 | Jest 單元測試、既有 e2e harness、隔離測試 Redis |
| 效能目標 | 快取期間 1,000 次查詢不額外呼叫上游；跨實例共用已建立的快取 |
| 範圍 | 一個唯讀後端 API；前端串接、Role／Permission、migration、dependency、環境變數與排程皆不新增 |

## Constitution Check

設計前與設計後均檢查 Constitution 1.3.0：

| 原則 | 結果與依據 |
| --- | --- |
| KISS / YAGNI | 通過；既有服務內增加方法，不做通用快取、權限系統或背景工作 |
| Server 權威 | 通過；每次經 session guard，名冊不代替既有簽署資格與資料存取檢查 |
| 資料最小化 | 通過；只回傳 spec 欄位，禁止名冊與上游錯誤 body 進入日誌；回應 no-store |
| 系統邊界 | 通過；GET 不匯入帳號、不寫 MySQL，controller 只處理 HTTP，Redis 僅保存暫存資料 |
| 驗證與交付 | 通過；驗證計畫涵蓋格式、session、併發、期限及失敗，尚未宣稱功能完成 |

本期授權範圍明確為「所有有效內部員工 session」。Portal 頁面入口限制不視為 API 權限；不擴充本期範圍。既有 candidate GET 的帳號匯入問題仍另案處理。

## Project Structure

### 本次產出的規劃文件

- [research.md](research.md)：現有程式證據、設計選擇與取捨。
- [data-model.md](data-model.md)：回應 DTO 與 Redis 暫存狀態，無 DB entity。
- [contracts/api.md](contracts/api.md)：路由、驗證、成功／失敗回應。
- [quickstart.md](quickstart.md)：驗證步驟、本次結果與限制。

### 實作位置

| 檔案 | 責任 |
| --- | --- |
| `server/src/features/esign/controllers/signer-candidates.controller.ts` | 新增 org-chart GET、no-store、Swagger envelope 與錯誤說明 |
| `server/src/features/esign/services/esign-signer-candidate.service.ts` | 新增獨立的組織樹讀取方法與快取協調；不呼叫既有 list/importStaff 寫入路徑 |
| `server/src/features/esign/esign.module.ts` | 視注入需求明確匯入既有 RedisModule |
| `server/src/infrastructure/http-client/feastogether/services/feastogether-department.service.ts` | 固定上游路徑、10 秒逾時、DTO 驗證與裁切、統一映射上游失敗為 502 |
| `server/src/infrastructure/http-client/feastogether/types/org-chart.dto.ts` | 規劃新增的組織樹 DTO 與必要結構驗證 |
| `server/src/infrastructure/http-client/feastogether/feastogether.client.ts` | org_chart 成功 envelope 驗證，以及兩處錯誤 body 省略 |
| `server/src/infrastructure/http-client/feastogether/feastogether.module.ts` | 如 candidate service 注入 FeastogetherConfig 取得來源命名空間，匯出既有 config provider |
| `server/src/infrastructure/database/redis/redis.service.ts` | 沿用既有 get/set，不增加專用方法 |
| `server/src/common/errors/app-error-code.ts`、`app-errors.ts` | 集中定義組織樹 502／503 錯誤碼與繁體中文訊息 |
| 對應 `.spec.ts`、`server/test/org-chart.e2e-spec.ts` | 單元、真實 Redis 與 HTTP 契約驗證；必要時更新既有 e2e 收錄規則 |

## Request Flow

1. 既有 session guard 驗證身分；失敗不讀組織快取。
2. 以環境、來源隔離的 key 讀快取。合法資料（包含空陣列）直接回傳；不續期。
3. 快取未命中時呼叫上游一次。驗證成功 envelope 與整棵樹，重建白名單 DTO；任何必要資料格式錯誤整批回 502。

4. 寫入成功資料並設定 7,200 秒 TTL，再回傳；Redis 讀寫失敗回 503。

## Redis Design

- Namespace 使用既有 `NODE_ENV` 與 `FEASTOGETHER_BASE_URL` 的穩定雜湊，加上本功能與 schema 版本前綴；API Key 不納入 key 或 payload。搭配既有 Redis host／DB 部署隔離，無新設定。

## Validation Strategy

| 範圍 | 對應 spec | 驗證 |
| --- | --- | --- |
| DTO／唯讀 | US1、FR-003/012、SC-006 | 多根、空部門、十層、nullable、前導零、額外欄位；單筆錯誤整批拒絕；不觸發帳號或簽署寫入 |
| 快取 | US2、SC-001/002/003 | 兩個實例共用真實測試 Redis、50 個未命中、1,000 次命中、不續期、空陣列、過期按需更新 |
| HTTP／隱私 | FR-001/004/011/014/015、SC-005 | 正式模組路由與 DI、無效 session 的 401、200 envelope/no-store、502/503 契約、日誌無名冊與憑證 |

測試 Redis 必須使用既有 `assertTestRedisDb` 保護，唯一測試 namespace 與清理範圍，不操作正式資料。測試內容全部合成。完成實作後執行 server lint、test、build 與相關 e2e；步驟見 quickstart。

## Complexity Tracking

沿用既有 get/set，接受同時未命中的重複上游請求。
