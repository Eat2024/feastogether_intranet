# 08: 前端匯出串接與下載安全回歸

**What to build:** 前端串接同部門完整匯出資料與下載能力，驗證每一入口及本人副本的獨立資格。

**Blocked by:** [05](./05-department-read-ui.md)、[07](./07-department-export-api.md)

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；US4；FR-010/011；SC-003。

**Tasks:** T033、T034、T035、T036；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [x] 同部門非建立人可使用 server 授權的完整 Excel 資料，不能拿已裁切唯讀 DTO 產生缺欄 Excel；沿用既有 API 與記錄流程。
- [x] 列表／詳情／簽署人表格／ZIP 面板／歷史頁依部門匯出能力呈現，不以 isCreator 代替匯出資格；保留非建立人不可修改與既有 409／404 錯誤處理。
- [x] 安全 E2E 涵蓋直接 URL、ID 錯置、無效 cookie、缺部門、調職舊 session、軟刪除及敏感欄位；拒絕時無 DB／queue／bytes 副作用。
- [x] T027／T028／T035 與內部 Portal、內部 Email、外部副本原測試通過；確認 worker 固定快照不變、領取時重新授權，validation.md 記錄逐入口與 Excel 內容比對結果。

## 原始任務範圍

- [x] T033 [US4] 修改 `client/src/features/esign-documents/DocumentExportView.tsx`、`buildExportXlsx.ts` 及 `client/src/api/types/esignExports.ts`／既有 request，確保同部門非建立人匯出使用 server 授權的完整 Excel 匯出資料，不拿 US1 已裁切詳情產生缺欄 Excel；沿用既有 API 路徑與授權後記錄流程。
- [x] T034 [US4] 在 `client/src/features/esign-documents/DocumentRowActions.tsx`、`DocumentDetailView.tsx`、`DocumentSignerTable.tsx`、`ZipExportPanel.tsx` 與 `client/src/features/export-history/ExportHistoryView.tsx` 接同部門匯出／下載能力，不能以 isCreator 作匯出資格；保持非建立人不可修改文件，409／404 走既有錯誤處理，無法取得資格時不 fallback 全公司資料。
- [x] T035 [US4] 在 `server/test/security-esign-department.e2e-spec.ts` 擴充所有匯出直接 URL、ID 關係、cookie 無效、缺代碼、調職舊 session、文件軟刪除與欄位洩漏案例；同時跑 `server/test/internal-portal-completion.e2e-spec.ts`、`server/test/internal-email-copy.e2e-spec.ts` 及外部副本原測試，證明本人留存資格未被部門規則封鎖。
- [x] T036 [US4] 執行 T027／T028／T035，驗證 worker 固定快照未改且檔案領取重新授權；在 `specs/017-department-document-visibility/validation.md` 記錄每一匯出入口、筆數、拒絕無 DB／queue／bytes side effect 的結果與前端 Excel 內容比對。

## Ticket 08（T033–T036）

- Client部分隨05整合；07完成後重啟真實合成API，Chrome三session重驗26個API請求，實際點擊匯出下載.xlsx並以既有ExcelJS解析：姓名與Email正確、note未洩漏，歷史count=1，跨部門以紀錄ID重下載404。
- 部門security 10/10（原4案+新增6案）通過：所有匯出URL、跨部門／大小寫異碼、NULL、invalid cookie、調職舊session、軟刪除、document/job/file與history/signer錯置；拒絕後DB／檔案metadata／queue不變且沒有stat／stream／enqueue。
- 本人副本：internal-portal-completion + internal-email-copy共15 tests通過；原外部與交付安全：security-core-esign-flow + esign-document-delivery-security共16 tests通過。
- Worker固定快照與領取時重新授權已有07 ZIP回歸證據；檔案lint 0 errors/warnings及diff check通過。
- 尚未執行UAT回填或部署。

整合commit：`git log --grep="test(spec017): verify export authorization boundaries"`；client實作見e5f1de2。
