# 07: 一般匯出、歷史與下載的部門授權

**What to build:** 所有一般 Excel／PDF／ZIP 與歷史查詢依文件快照授權，堵住直接 ID、舊網址與歷史計數旁路。

**Blocked by:** [04](./04-department-read-api.md)、[06](./06-creation-snapshot.md)

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；US4；FR-010/011；SC-003。

**Tasks:** T027、T028、T029、T030、T031、T032；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [x] T027／T028 先紅後綠；exportable documents、historyPage／Counts 與單筆查詢先限文件部門再分頁計數，外部或已調職匯出者不改歸屬。
- [x] ZIP 建立／重用／狀態／重試／Range 下載全傳 userId；授權及 document/job/file 關係檢查早於 snapshot、DB 寫入、enqueue、metadata、ETag 或 stream。
- [x] Excel 紀錄與重下載、PDF 歷史與一般 completed-file/downloads 皆限同部門；跨部門 filter 空 items／0 counts，指定資源拒絕且無新增紀錄／工作／檔案 bytes。
- [x] 原建立人調職亦不得一般匯出舊文件；本人任務、內外部本人副本及邀請驗證保持原獨立資格，不放寬也不被部門封鎖。

## 原始任務範圍

- [x] T027 [P] [US4] 在 `server/test/esign-export.e2e-spec.ts` 補同部門可建立／重用／查詢／重試／Range 下載 ZIP、跨部門全部拒絕、錯置 document/job/file ID、調職後舊 URL 失效測試；原全員成功測試改成同部門 fixture，不刪除負向斷言。
- [x] T028 [P] [US4] 在 `server/test/esign-export-history.e2e-spec.ts` 補 Excel／PDF 紀錄與重下載、total／typeTotals 同部門過濾、跨部門 documentId filter 空資料、外部匯出人按文件部門歸屬及拒絕無紀錄 side effect 測試。
- [x] T029 [US4] 修改 `server/src/features/esign/repositories/export-job.repository.ts` 的 exportable documents／historyPage／historyCounts／單筆讀取介面，透過文件快照加同部門條件；列表先限部門再分頁與計數，不以 exporter 部門判斷、不新增匯出部門欄位。
- [x] T030 [US4] 在 `server/src/features/esign/controllers/exports.controller.ts` 所有列表／request／detail／retry／download 傳入 userId；`server/src/features/esign/services/esign-export.service.ts` 於讀 snapshot、重用 job、寫入／enqueue、檔案 metadata／Range／stream 前驗證同部門與 ID 關係，不能給建立人跨部門例外。
- [x] T031 [US4] 在 `server/src/features/esign/controllers/export-history.controller.ts` 及 `server/src/features/esign/services/esign-export-history.service.ts` 對列表、Excel 記錄／重下載、PDF 歷史重下載套用同部門政策；未授權 404 或契約定義的空列表，檔案未就緒等錯誤必須在授權後判斷。
- [x] T032 [US4] 釐清並調整 `server/src/features/esign/services/esign-export-history.service.ts`、`esign-completion-access.service.ts` 及 `server/src/features/esign/controllers/documents.controller.ts` 的一般 completed-file/downloads 路徑為同部門；不能放寬 `server/src/features/esign/controllers/signing-tasks.controller.ts`／`external-signature.controller.ts` 的本人副本或邀請驗證。

## 實作驗證紀錄（待整合）

- T027／T028 有效紅燈：跨部門 ZIP 列表洩漏、Excel 寫入預期 404 實得 201；2 suites／2 tests 失敗。
- T029～T032：exportable／history page/count／record 在 SQL 限文件部門；ZIP 所有入口傳 userId，授權早於 snapshot／重用／寫入／enqueue／metadata／Range；一般 PDF 改 departmentFile／downloadDepartmentCopy，保留本人與外部副本獨立資格。PDF 歷史下載驗證 record.documentId 與 signer.documentId。
- 隔離 DB feastogether_intranet_test017、Redis 0；`pnpm -C server test:e2e --testPathPatterns=esign-export`：2 suites／84 tests 通過，含同部門成功、跨部門全入口拒絕、查詢前過濾／計數、外部匯出人、調職舊 session、PDF 錯置紀錄、跨部門本人副本保留與 ZIP worker 固定快照。
- `pnpm -C server test --runInBand esign-completion-access.service.spec.ts`：17 tests 通過；server build 通過。指定修改檔 lint：0 errors、17 個原測試既有 warnings；git diff --check 通過。
- 原全員成功案例改成明確同部門 fixtures；原非建立人拒絕改成跨部門拒絕，另驗同部門非建立人成功，未刪負向條件。
- 未改 worker、未操作 UAT；shared tasks／validation 由 root 整合。

整合commit：`git log --grep="feat(spec017): restrict exports and history by department"`。
