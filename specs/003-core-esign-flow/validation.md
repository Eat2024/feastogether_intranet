# Spec 03 驗收紀錄

**日期**：2026-10-13
**分支**：`003-core-esign-flow`

## 2026-10-14：提交前現況（優先於下方歷史紀錄）

- 前端已還原為 `dev` 版本，只保留 `/forms/new` 標題在 iframe 隱藏的修正。下方 spec03 前端串接、共用 PDF 元件及瀏覽器驗證為歷史紀錄，不代表本次提交內容。
- 目前前端 PDF 上傳使用 Next.js `/files/upload` 與記憶體 mock store，尚未串接 NestJS 電子簽 API。
- `pnpm build` 通過；`pnpm lint` 通過（0 errors、106 warnings）。
- `pnpm -C server test --runInBand`：78 suites 中 77 通過、1 失敗；501 tests 中 500 通過、1 失敗。`document-upload.interceptor.spec.ts` 的缺少 PDF 案例預期 400，實際 mock HTTP 回應 201；必填檔案檢查待修復。
- 本次提交前未重跑 DB/Redis e2e 與部署環境驗收，不沿用歷史結果作為本次通過證明。
- 後端發起簽署支援於同一交易儲存簽署人、欄位及期間；前端新流程的共用欄位樣板模式仍待對齊。討論中的 `field-template` endpoint 尚未實作。
- 實際上傳的 PDF、簽名圖檔與本機環境機密不納入提交。

## 自動化驗證

| 項目 | 結果 | 備註 |
| --- | --- | --- |
| Server unit tests | PASS | 76 suites、470 tests |
| Schema migration/constraint tests | PASS | 2 suites、2 tests；含 run/revert/run 與 test DB fail-closed |
| Server e2e | PASS | 7 suites、45 tests；含 US1–US4、26 個 OpenAPI operations 與真 Redis queue e2e |
| Server security e2e | PASS | 5 suites、17 tests |
| Server lint:check | PASS | 0 errors；既有測試程式仍有 warnings，未提高 error 數 |
| Server build | PASS | Nest build 完成 |
| Client lint | PASS | 0 errors |
| Client build | PASS | Next.js production build 完成，含內部與外部簽署 routes |

真 queue e2e 使用 `feastogether_intranet_test*` MySQL、隔離的 `REDIS_DB=1`、local temp storage 與 fake mailer，實際跑過 HTTP commit → BullMQ → worker → DB/file：

- invitation/finalization job data 只包含 local ID。
- 重複 invitation dispatch 不會產生第二筆 delivered audit。
- `esign-maintenance:30s` scheduler 已註冊。
- 最後一名簽署人完成後由 worker 產生完成 PDF。
- 重複 finalization dispatch 仍只有一份 completed object 與一筆 completed audit。
- 模擬 finalization enqueue 遺失後，maintenance 會從 MySQL 權威狀態重新入列並完成結案。
- processor unit tests另覆蓋 enqueue failure、stale lease fencing、lost-lease orphan cleanup 與 deadline reconciliation。
- 建立、指派、同意、提交與完成事件依序寫入線性 audit chain，且事件資料不含 Email、token、IP、User-Agent 或 PNG。
- 同一 request 的兩個並發簽署只建立一筆 evidence 與一份 PNG；簽署／停止競態最後維持單一停止事件及一致狀態。
- 完成 PDF 逐筆重驗 source/payload/consent/PNG hash 與 immutable 簽署時間；MySQL 或 private storage 不可用時 fail closed。
- 文件清單 `role/status`、unknown JSON/multipart/query 拒絕，以及 creator／signer／outsider 歷程裁切均有真 MySQL e2e。

## 本機主流程覆蓋

- [x] US1：建立 PDF 草稿、外部簽署人/欄位、發起、固定 payload 與 active 後不可修改。
- [x] US2：external invitation bridge/session、本人欄位、Canvas PNG、唯一證據、冪等重送與 receipt。
- [x] US3：worker 完成 PDF、creator/external receipt 下載、未參與員工 404。
- [x] US4：已有證據時停止、pending invitation 失效、證據保留、修正只能建立全新 draft。
- [x] 安全邊界：OriginGuard、通用 external 401、creator IDOR 404、private/no-store PDF、token path redaction 與 job payload 最小化。

## 尚需部署環境人工驗收

以下項目需要實際 UAT/production 基礎設施、收件人或瀏覽器，不能以本機 fake/mock 結果宣稱完成：

- [ ] local Mailpit 實際收信、點擊 invitation URL 與重新開啟流程。
- [ ] UAT SES sandbox 已驗證 sender/recipient 的實際投遞。
- [ ] UAT shared persistent volume 在 HTTP/worker 不同 process/pod 與重啟後仍可讀取。
- [ ] production private S3 Block Public Access、runtime IAM 最小權限與 API stream；確認 bucket/object URL 無法直接下載。
- [ ] 真實內外部瀏覽器的 PDF 視覺位置、兩分鐘 finalization、截止後 60 秒停止。
- [ ] BullMQ dashboard/queue、browser Network/props、application/reverse-proxy log 與 storage 的人工敏感資料檢查。
- [ ] 窄螢幕、keyboard、focus 與 Canvas 手寫操作驗收。

完成上述項目後，才可將 `tasks.md` 的 T080 標記完成並宣稱 Spec 03 已完成部署環境驗收。

## 2026-10-14：PDF 拖曳欄位回歸修復

- 恢復真實 PDF 預覽上的簽名／日期欄位新增、拖曳、尺寸調整、刪除與多頁切換；欄位依穩定簽署人身分綁定，重新開啟還原後端已存位置。
- 新增 `pdfjs-dist` 5.4.624 與同源 worker／字型資產路由，使用相容 Node 20.19 的版本；production standalone 已確認包含 worker 資產。
- `pnpm build`、`pnpm lint` 通過（server 仍有既有 warnings）；後續 client 調整再跑 client lint/build 通過。
- `node --experimental-strip-types --test client/tests/field-placement.test.mjs`：4 項通過，涵蓋邊界／精度、身分還原、無法對應的簽署人與無效欄位拒絕。
- Headless Chrome 使用隔離 Next.js 與記憶體 API fixture、兩頁非機密 PDF 實測通過：canvas 顯示、從工具列拖入日期欄位、滑鼠／觸控移動、方向鍵微調、旋轉且裁切的第二頁、Server Action 儲存並重新開啟、移除簽署人保留其他欄位、外部簽署人綁定、窄螢幕嵌入版面，以及 PDF 503 後重試。無瀏覽器未捕捉例外。
- 上述瀏覽器測試不使用真 SSO/MySQL，也沒有寫入使用者的文件 2；不取代 T080 的 Portal、正式資料與最終 PDF 全流程人工驗收。

## 2026-10-14：簽署位置預覽與 PDF 共用功能

- 將私有 PDF 載入、worker、canvas 繪製、響應式尺寸與旋轉／裁切座標換算抽至 `client/src/components/pdf/`，建立人編輯器與簽署頁共同使用。
- 內部及外部簽署沿用 `SignFlow`，在 PDF 顯示 API 提供的本人欄位；清單可跨頁定位、點欄位開啟簽名板、原位置預覽與重簽。日期不可編輯，仍由 server 在提交時填入。
- client lint/build 通過；`node --experimental-strip-types --test client/tests/*.test.mjs` 共 6 項通過。
- 隔離 Headless Chrome/API fixture：內外部簽署、重簽、日期鎖定、跨頁定位、旋轉預覽、全部簽名及閱讀同意後才啟用確認、窄螢幕、PDF 503 重試通過，沒有未捕捉例外。原建立人拖曳、觸控、儲存還原與身分綁定回歸測試亦通過。
- 未變更後端、migration、環境設定或新增依賴；未寫入實際文件。尚未以真 Portal／MySQL 完整送出及比對 worker 產出的完成 PDF，不取代部署環境驗收。
