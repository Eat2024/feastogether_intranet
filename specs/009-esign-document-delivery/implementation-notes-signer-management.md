# Ticket 04：管理備註、拒簽結果與歷程身分

> 最終 PR 僅交付後端 API 與資料模型；開發期管理 UI 串接已移除，改由獨立前端 PR 交付。

基線 `afe4b85`；分支 `009/04-notes-history`，工作目錄 `/tmp/esign009-04`。

## 交付

- 建立人 PATCH `/api/esign/documents/:documentId/signers/:signerPublicId/note` 在文件→簽署人鎖交易中保存，DTO 與服務皆驗證 trim 後 0–30 Unicode code points；空字清除、null 非法。停止／完成亦可修改，不修改文件、簽署紀錄、稽核鏈或 PDF。
- 沿用既有 EsignSignerService，沒有新增平行管理服務。note 僅在 creatorDetail 組合管理 DTO；共用本人 mapper 不加入 note。
- 歷程 actor 改為契約的 kind/name/signerPublicId 物件，簽署／拒簽等本人動作使用姓名快照；寄信、OTP寄送、產製副本仍標系統，指派人員為實際員工。只讀取關聯，不回填 audit。
- 正式管理表格保存／清空／取消／錯誤留值、拒簽時間與原因、狀態分頁、Excel 欄位已接正式 API。歷程按 kind/name/publicId 分組，不把同名簽署人合併。
- migration `1792454404000-SignerNote` 在既有表加 utf8mb4 varchar(30) 預設空字串，已同步 entity/schema/註冊。沒有新增 dependency、環境變數或 role/permission。down 會刪除管理備註欄位，回滾前須保存需要的管理資料。
- T047 的通知摘要由 Ticket 06 整合；本 ticket 不偽造通知紀錄或寄送結果。

## 驗證

- TDD：note DTO 缺少檔案紅燈→通過；PATCH note HTTP 404 紅燈→3項保存/授權/不變性綠燈；拒簽 actor 原回「系統」紅燈→物件契約綠燈。
- server 全單元測試：95 suites／829 tests 通過。
- `test:e2e core-esign-flow.e2e-spec.ts esign-signer-management.e2e-spec.ts`：28/28 通過，使用 `feastogether_intranet_test009_04`，無共享資料庫。含停止／完成後保存、30 emoji、清空、非法型別、非建立人、外部/無session、Origin、跨文件；拒簽時間與原因、本人任務裁切；真已簽副本在note修改前後bytes、證據、payload/hash、audit均相同，公開驗證仍有效。
- schema：6/6 通過，無 drift；helper 自加 UUID，以短前綴 `feastogether_intranet_test` 執行並自動清理。
- root `pnpm build` 與 `pnpm lint` 通過（含 server/client build 與 lint）；server lint:check、client lint 通過（server有既有 warnings）；未新增 client 測試框架。

## 真實瀏覽器驗收

2026-10-21 使用既有 Playwright core + Chrome，Next 39042 → Nest 39041 → 隔離 MySQL；合成 session與人名，不用 mock API。

- 備註初始回填→取消恢復原值→儲存 trim+emoji→重新整理仍相同→清空後重整為空。
- 只在故障測項用 route abort 中斷傳輸，畫面顯示連線錯誤、原DB值保留，取消恢復已存值。
- 已拒頁籤顯示原因，歷程顯示本人；實際下載 Excel，以 ExcelJS 開檔確認一位已拒者、拒簽日期與原因，不誤算已簽。
- 臨時腳本 `/tmp/esign009-note-browser.cjs`、合成截圖 `/tmp/esign009-note-rejection.png`；臨時 Jest 注入已撤除，Next已停止，生成 AGENTS 區塊已移除；未提交 session、個資或截圖。
