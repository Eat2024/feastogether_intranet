# Implementation Plan: 自訂當次匯出檔名

**Branch**: `dev` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: `specs/020-custom-export-filename/spec.md`

## Summary

新增一支供 Excel／ZIP 共用的「準備匯出下載」API，驗證名稱與權限後回傳當次下載資訊，不保存檔名。Excel 沿用既有記錄、產檔流程；ZIP 沿用既有 GET 串流下載，以固定旗標省略伺服器檔名，讓同源下載連結的 `download` 屬性採用後端驗證過的名稱。留白、歷史下載與共用 ZIP 均保留原行為。

實作只有一支新 API、既有 ZIP GET 的一個標頭選項，以及現有輸入框串接。不新增 table、migration、Redis 暫存、token、環境變數、排程或依賴。

## Technical Context

**Language/Version**: TypeScript；沿用 workspace 版本。

**Primary Dependencies**: 既有 Next.js 16、React 19、MUI 9、NestJS 11、Fastify、class-validator；不新增套件。

**Storage**: 僅讀取既有文件／匯出成果；此 API 不寫入 DB、Redis 或檔案。

**Testing**: 後端 Jest、Nest/Fastify HTTP 整合測試，既有匯出 e2e；前端 lint/build 與實際瀏覽器下載驗收。

**Target Platform**: 同源 `/api` proxy 的桌面瀏覽器及現有入口網嵌入頁。

**Project Type**: pnpm workspace 的 client/server Web application。

**Performance Goals**: 不重新打包 ZIP，不在前端整包讀成 Blob，不新增背景工作；原 GET 串流與 Range 保留。

**Constraints**: 檔名只在 POST body、必要回應與目前頁面記憶體中存在；URL 僅使用固定旗標，不含使用者檔名。不得聲稱已觀測原生下載完成。

**Scale/Scope**: 一個匯出頁、兩種格式、一支新 API；不改歷史列表與單人 PDF。

## Constitution Check

| 原則 | 設計前／後結果 |
| --- | --- |
| KISS／YAGNI | 通過：沿用 controller/service、下載路由與輸入框；一個 feature 內命名 helper 足夠。 |
| Server 權威 | 通過：名稱與同部門權限由後端驗證；實際 GET 再次檢查授權及成果狀態。 |
| 最小揭露 | 通過：POST 不接受身分、object key 或任意下載網址；名稱不進 URL，既有電子簽 body 日誌排除保持有效。 |
| REST 與邊界 | 通過：以文件的 `export-downloads` 子資源表達準備下載；POST 不持久保存，GET 無業務寫入，契約明確說明。 |
| 驗證 | 通過：規劃名稱規則、HTTP/auth、Range 與真瀏覽器驗收；本次只完成設計，未宣稱功能通過。 |
| 流程 | 通過：本次停在 plan，不建立 tasks 或修改程式。 |

瀏覽器能否在入口網嵌入環境採用下載名稱是實作交付的必要驗收門檻；標準依據已查明，不能用單元測試代替實際驗證。無 constitution 例外。

## Project Structure

### Documentation (this feature)

```text
specs/020-custom-export-filename/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/export-downloads-http-api.md
└── checklists/requirements.md
```

### Source Code (repository root)

| 位置 | 預計變更 |
| --- | --- |
| `server/src/features/esign/controllers/exports.controller.ts` | 新 POST、ZIP GET 固定命名旗標與 OpenAPI。 |
| `server/src/features/esign/services/esign-export.service.ts` | 準備下載：文件授權、ZIP 成果確認，回傳必要資訊。 |
| `server/src/features/esign/dto/export.dto.ts` | discriminated request 的驗證及 response DTO。 |
| `server/src/features/esign/helpers/export-file-name.ts` | 單一正規化／拒絕規則，無狀態。 |
| `server/src/common/errors/app-errors.ts` | 集中繁體中文檔名錯誤，沿用 INVALID_REQUEST。 |
| `client/src/api/{endpoints.ts,types/esignExports.ts,requests/esignExports.ts}` | 登記 POST 與型別、同源 ZIP 下載路徑；index 匯出依既有方式。 |
| `client/src/features/esign-documents/DocumentExportView.tsx` | 傳遞現有輸入值、更新提示、提交狀態。 |
| `client/src/features/esign-documents/buildExportXlsx.ts` | 準備名稱成功後才記錄及產檔，套用名稱。 |
| `client/src/features/esign-documents/ZipExportPanel.tsx` | 點擊時準備下載，以原生同源連結開始 ZIP 下載。 |
| 後端相鄰 helper/HTTP tests、既有 export e2e | 驗證改動涉及的規則與權限。 |
```

**Structure Decision**: 留在現有 esign feature，不建立新 module、共用下載框架或 repository。

## Implementation Design

1. **命名規則**：依 spec 檢查原輸入控制字元、trim、100 字輸入限制、移除結尾 `.xlsx`／`.zip`、檢查主檔名、補正確副檔名、檢查最終 255 bytes。空白回 `null`。非字串（含 null）拒絕；錯誤不回顯原名稱。
2. **新增 POST**：`/api/esign/documents/:documentId/export-downloads`。`type=excel` 驗證已發起文件可匯出；`type=zip` 另收 `exportId`／`fileId`，沿用現有 download service 確認成果可用。不產生檔案、不新增歷史、不回傳儲存位置。
3. **ZIP 原 GET**：僅新增 `downloadName=client` 固定選項；成功回應使用 `Content-Disposition: attachment`（完全不附 filename／filename*），其餘內容與 Range 邏輯不變。未帶旗標保留原檔名標頭。旗標不代表權限，也不改變查詢範圍。
4. **Excel**：點擊時擷取名稱與篩選條件；POST 成功後才執行既有記錄及產檔，`fileName=null` 沿用 buildExportXlsx 的原預設。命名 API 失敗不得記錄或下載。
5. **ZIP**：點擊時 POST 檔名與現有成果 ID；成功後使用回傳的同源 `downloadPath`，設定 `a.download` 為正規化名稱；空白則使用原網址與原檔名。不使用 axios Blob 載入 ZIP。下載連結保留原頁（使用獨立 target、noopener），避免 GET 晚期錯誤把原輸入頁導走。
6. **錯誤與忙碌**：準備 API 透過既有 mutation／錯誤處理呈現繁體中文，保留輸入。busy 只涵蓋準備與交付瀏覽器，不是檔案傳輸進度；不顯示「下載完成」。準備成功不保證後續 GET 成功；GET 仍重新驗證，傳輸中斷由瀏覽器下載介面處理。此限制不藉新增 token、輪詢或 iframe 機制解決。
7. **隱私與相容性**：只回傳服務自身組合的相對 `/api/...` 路徑；前端不接受任意 origin。檢查既有 access log 不記電子簽 body／回應名稱。不能改成在 query 放名稱。支援範圍為現行同源 proxy，不擴張為跨源 API 下載。

## Validation Strategy

- helper：空白、中文、長度邊界、控制字元、保留名稱、兩種副檔名互換。
- HTTP/service：員工 session、Origin、草稿／刪除／跨部門、非法 body、ZIP 歸屬與可用性、沒有寫入與錯誤無名稱回顯。
- ZIP：兩種標頭模式、200／206／416、If-Range、原 GET 相容性，兩人不同名稱不改成果或歷史。
- 真瀏覽器：Chrome／Edge（入口網主流程）及 Safari／Firefox 各確認同源下載建議名稱；包含入口網實際 iframe、準備 API 失敗與原生下載中斷。若目標環境不支援，不得默默以預設名稱宣稱完成，先回到 plan 調整。
- 範圍對應驗證：server test、server lint:check/build、client lint/build，最後 root lint/build；DB e2e 需安全測試資料庫。詳見 quickstart。

## Complexity Tracking

無違反 constitution 的複雜度例外。固定下載旗標是為同時保留大檔串流、當次命名、無狀態與名稱不入 URL 的最小調整；移除功能時刪除新 POST、旗標及頁面串接即可，無資料遷移。
