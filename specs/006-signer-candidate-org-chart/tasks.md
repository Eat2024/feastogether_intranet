# Tasks: 簽署人候選組織架構與兩小時快取

使用者後續要求採 KISS：讀快取 → 未命中呼叫上游 → 寫入 7,200 秒快取 → 回傳。允許同時未命中重複呼叫；不再使用鎖、輪詢、二次讀取或發布期限。Redis 使用既有 get/set。

**日期**：2026-10-19
**輸入**：[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[API contract](contracts/api.md)、[quickstart.md](quickstart.md)
**狀態**：18 項任務均已完成；實際驗證結果與限制見 [quickstart.md](quickstart.md)。

僅包含已確認的後端功能；沿用既有服務。沒有前端、Role／Permission、部門授權、資料表、migration、新套件、新環境變數、排程、過期 fallback 或通用快取框架任務。所有測試資料使用合成名冊。

## Phase 1：準備

- [X] T001 閱讀 `AGENTS.md`、`server/AGENTS.md`，確認 `server/test/security-e2e.helper.ts`、`server/test/jest-e2e.json` 與 `server/src/infrastructure/database/test/ensure-test-redis.ts` 的既有啟動／隔離方式；實作時使用 Spec 006 明確 feature 路徑，保留使用者現有變更，不重建測試框架或變更正式設定。

## Phase 2：共用基礎

- [X] T002 在 `server/src/common/errors/app-errors.spec.ts` 先加入組織樹錯誤契約測試，再於 `server/src/common/errors/app-error-code.ts` 與 `server/src/common/errors/app-errors.ts` 定義 `ORG_CHART_UPSTREAM_UNAVAILABLE`（502，「組織架構來源暫時無法使用，請稍後再試」）及 `ORG_CHART_UNAVAILABLE`（503，「組織架構暫時無法使用，請稍後再試」）；沿用 AppException 與既有 envelope，不使用登入失效錯誤碼。（FR-011）

**檢查點**：錯誤契約可供三個故事使用。後續各故事先寫測試，確認因缺少預期行為失敗，再實作。

## Phase 3：US1 查詢組織架構以選擇簽署人（P1）

**目標**：有效員工 session 可取得白名單組織樹，無本機帳號／簽署寫入。
**獨立驗收**：使用合成上游驗證多根、空部門、十層樹與欄位裁切；HTTP 正確包裝回應，未登入不得進入名冊讀取，既有員編搜尋維持不變。

### 測試

- [X] T003 [P] [US1] 新增 `server/src/infrastructure/http-client/feastogether/types/org-chart.dto.spec.ts`，涵蓋多根、十層子部門、來源順序、空陣列、前導零、nullable 姓名／職稱、額外欄位裁切及單筆錯誤整批拒絕；不增加員編八碼或日期正規化規則。（FR-003/010，SC-006）
- [X] T004 [P] [US1] 擴充 `server/src/infrastructure/http-client/feastogether/feastogether.client.spec.ts` 與 `server/src/infrastructure/http-client/feastogether/services/feastogether-department.service.spec.ts`，先驗證固定 `/api/v1/hr/org_chart`、10 秒 timeout、僅既有 API Key、不帶使用者 Bearer；僅接受成功 envelope 與合法 data，`[]` 可成功，原有端點相容性不變。（FR-002/003/010）
- [X] T005 [P] [US1] 在 `server/test/org-chart.e2e-spec.ts` 建立 HTTP 契約測試，並在 `server/test/jest-e2e.json` 收錄；使用既有 session guard／envelope 驗證 200、`Cache-Control: private, no-store`、無 cookie／失效 session 的 401，且不進入組織資料來源。於 `server/test/api-coverage.e2e-spec.ts` 加入正式 AppModule 的路由／DI 驗證；檢查查詢前後帳號／簽署資料未異動。（FR-001/004/012/015，SC-005/006）

### 實作

- [X] T006 [US1] 在 `server/src/infrastructure/http-client/feastogether/types/org-chart.dto.ts` 定義 DTO 與單一遞迴驗證／裁切函式。逐項遵循 data-model：`department_ch_id: string`「非空部門代碼，保留前導零」、`department_name: string`「來源部門名稱」、`department_parent_guid: string 或 null`「上層部門代碼」、`startdate: string 或 null`「保留原始字串，允許空字串」、`stopdate: null`「上游只查 stopdate IS NULL」、`children: OrgDepartment[]`「直屬子部門，可為空陣列」、`employees: OrgEmployee[]`「直屬員工，可為空陣列」；員工欄位為 `person_empid: string`「保留原始字串與前導零，不轉數值或本機 userId」、`person_name: string 或 null`「員工姓名」、`title: string 或 null`「職稱」。落實「所有列出的欄位皆須存在，nullable 不等於可省略」，不另排序、去重或複製子部門員工；一筆必要資料錯誤即整批失敗。（依賴 T003；FR-003/010）
- [X] T007 [US1] 在 `server/src/infrastructure/http-client/feastogether/feastogether.client.ts` 僅為 org_chart 加上解包前 `success === true` 檢查，並將該路徑加入 request／unwrap 兩處 body 省略，不記來源自由文字 code/message；在 `server/src/infrastructure/http-client/feastogether/services/feastogether-department.service.ts` 新增固定路徑、10 秒 timeout 的取得方法並使用 DTO 驗證，所有上游失敗映射本功能 502，不沿用把 401/403 轉成登入錯誤的通用 mapper。（依賴 T004、T006；FR-002/003/009/010/011/014）
- [X] T008 [US1] 在 `server/src/features/esign/services/esign-signer-candidate.service.ts` 新增獨立組織樹讀取方法，不呼叫 `list()`／`importStaff()`；於 `server/src/features/esign/controllers/signer-candidates.controller.ts` 新增 GET org-chart、no-store 與完整成功／錯誤 Swagger envelope，沿用全域員工 session，不加角色或部門檢查。確認 `server/src/features/esign/esign.module.ts` 的既有 provider 注入，並更新 `server/src/features/esign/services/esign-signer-candidate.service.spec.ts` 既有建構方式及唯讀回歸驗證。（依賴 T005、T007；FR-001/004/012/013/015）

**檢查點**：T003–T005 測試通過，可獨立驗證唯讀 API。尚未完成兩小時快取，不視為整個功能交付。

## Phase 4：US2 多人查詢共用兩小時快取（P1）

**目標**：跨使用者、跨實例共用成功名冊；過期按需更新。
**獨立驗收**：至少兩個實例連同一測試 Redis，50 個正常同時未命中只呼叫上游一次；成功後 1,000 次查詢不重打上游、不續期。

### 測試

- [X] T009 [US2] 驗證 candidate service 的空快取、損毀修復、TTL 邊界、命中不續期與 namespace 隔離。
- [X] T010 [US2] 移除組織圖專用 Redis 命令測試，保留既有 get/set 測試。

### 實作與整合

- [X] T011 [US2] 沿用 RedisService.get/set；刪除組織圖專用鎖、發布、解鎖與命令期限方法。
- [X] T012 [US2] candidate service 實作讀快取、未命中查上游、成功快取 7,200 秒及回傳；保留既有模組注入。
- [X] T013 [US2] 擴充 `server/test/org-chart.e2e-spec.ts`，使用 `server/src/infrastructure/database/test/ensure-test-redis.ts` 的隔離守門與唯一 namespace，驗證兩個 HTTP 實例共用真實 Redis 共用快取、成功後 1,000 次讀取、實際 7,200 秒 TTL、不續期、合法空陣列與到期按需更新；以縮短測試 key TTL 驗證到期，不等待兩小時、不清理其他 namespace。補證快取存在／不存在時未登入均不讀組織快取。（依賴 T012；SC-001/002/003/005）

**檢查點**：快取與正常跨實例協調可獨立驗收，開始驗證故障與恢復。

## Phase 5：US3 更新失敗時得到明確結果（P2）

**目標**：上游失敗 502、Redis／協調失敗 503；不假成功、不重試、不洩漏名冊。

### 測試

- [X] T014 [US3] 驗證上游錯誤 502、Redis 讀寫失敗 503、失敗不快取與敏感日誌裁切。
- [X] T015 [US3] HTTP 整合驗證同時未命中各自查上游、上游失敗不快取與後續請求恢復。

### 收斂實作

- [X] T016 [US3] 保留錯誤映射，不自動重試；刪除等待與所有權清理流程。

**檢查點**：三個故事的測試均通過，所有已確認失敗分支具可驗證結果。

## Phase 6：交付檢查

- [X] T017 依 `specs/006-signer-candidate-org-chart/quickstart.md` 執行 `pnpm -C server lint:check`、`pnpm -C server test --runInBand`、`pnpm -C server build` 及 `pnpm -C server test:e2e --testPathPatterns='org-chart|api-coverage'`，確認新測試實際被收錄；檢查 `server/src/features/esign/controllers/signer-candidates.controller.ts` Swagger、正式模組 DI、舊 candidate 搜尋與既有簽署資格檢查未被改變。缺少測試環境時記錄原因與未驗證項目，不宣稱通過。（依賴 T016；FR-001/013，SC-001–007）
- [X] T018 在 `specs/006-signer-candidate-org-chart/quickstart.md` 記錄實際驗證結果，核對 `specs/006-signer-candidate-org-chart/contracts/api.md` 與實作一致，於 `specs/006-signer-candidate-org-chart/tasks.md` 僅勾選確實完成項目；交付前確認只包含任務所需變更與合成樣本，說明後端完成範圍、前端未串接、無 migration／新環境變數與任何驗證限制。既有 `.env.example` 無新設定時不改動。（依賴 T017）

## Dependencies & Execution Order

```text
T001 → T002
  → (T003 + T004 + T005) → T006 → T007 → T008       US1
  → (T009 + T010) → T011 → T012 → T013             US2
  → (T014 + T015) → T016                          US3
  → T017 → T018                                  交付檢查
```

US2 在 US1 的同一個讀取方法上加入快取；US3 依賴 US2 的協調流程。三個故事各有獨立驗收目標，但實作依序進行，不將共用檔案的修改分配為互不相依的工作。

## Parallel Opportunities

`[P]` 僅表示同一階段內不同檔案的任務可並行，並非本文件授權啟動代理或實作；前置階段仍須完成。

- US1：T003 DTO 測試、T004 上游測試、T005 HTTP 測試分屬不同檔案，可並行撰寫；T006–T008 依依賴順序實作。
- US2：T009 業務快取測試與 T010 Redis 原子操作測試可並行撰寫；T011–T013 依序整合。
- US3：T014 單元／日誌測試與 T015 整合測試可並行撰寫；T016 在測試案例明確後收斂實作。

## Implementation Strategy

第一個可驗證增量為 US1 唯讀 API（T001–T008），用來確認契約與無業務寫入。完整功能的最小交付範圍仍包含 US1＋US2＋US3，因共用快取與失敗時不重試屬已確認需求。完成三個故事及交付檢查後才可宣稱本功能完成；依使用者後續授權執行，進度以各任務勾選與 quickstart 驗證紀錄為準。

## Coverage Summary

| 規格 | 任務 |
| --- | --- |
| FR-001／004／012／013／015；SC-005／006 | T005、T008、T013、T017 |
| FR-002／003／010；SC-006 | T003、T004、T006、T007、T014 |
| FR-005／006／007；SC-001／002／003 | T009、T011、T012、T013 |
| FR-008／009；SC-004／007 | T010、T011、T012、T014、T015、T016 |
| FR-011／014；SC-004／005 | T002、T007、T014、T015、T016 |

共 18 項：準備／基礎 2 項、US1 6 項、US2 5 項、US3 3 項、交付檢查 2 項。完成狀態見各項勾選。
