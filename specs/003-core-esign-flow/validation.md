# Spec 03 共用欄位／個人副本 CR 驗收紀錄

**交付範圍更新（2026-10-18）**：依使用者要求，本次 PR 僅保留後端、migration、API 契約與規格文件。`client/` 的修改及新增檔案已備份至 repository 外並移出本次差異，原有 mock 修改也另存備份。前端正式串接、公開驗證頁及 script 修正改由獨立 PR 交付；目前 client 回到 HEAD 的原型，不可用它驗收新版後端完整流程。

下方 2026-10-16 的前端實作、瀏覽器與整合驗收為拆分前的歷史證據，不代表目前工作樹仍包含該前端功能。後端原始碼、migration 與已執行的本機 migration 不因本次拆分而撤回。T100、T106、T117、T122、T128、T132 改為待前端 PR 交付；T133 的完整人工驗收仍待整合環境完成。

本次拆分後驗證：server 88 suites／658 tests 通過，server lint:check 為 0 errors／157 warnings，server build 通過；還原後的 client lint／build 通過，`git status --short -- client` 無變更。這些檢查不代表已重新驗收新版後端與原型前端的整合。

**原驗收日期**：2026-10-16。

## 本次交付範圍

- client 正式 `/forms`、`/my-signature`、外部簽署流程已改接 NestJS；上傳 PDF 後只放共用簽名／日期位置，發起才選完整名單。原型簽到表與瀏覽器合成檔不在正式入口使用，保留無關原型檔案與使用者已有的 `mock.ts` 修改。
- 一份 document、N 筆 signer assignment／record、N 份 record-owned `completed_pdf`。先簽的人先產製、ready 即可下載；所有人 signed 且 ready 才固定 manifest v2 並結案。停止保留已簽結果、個人產製與下載，但不再結案。
- 不新增業務表；修改 `esign_document_fields`、`esign_signers`、`esign_documents`、`esign_file_objects`、`esign_verification_records`。完成檔歸屬為 document 或 record 二擇一。未來多人共用簽到表可用 document-owned file 加 manifest 固定參與者，本次未實作簽到表，也未將 file registry 改為多對多 junction table。
- 外部邀請簽完失效，移除 receipt 與 external-completions；完成 PDF 由建立人提供。公開驗證只在 document completed 時回本人的 completed PDF hash，其餘狀態 null，不擴張公開個資。Spec 04 文件目錄未提供；已同步現有 QR service 與 Spec 03 相依契約，不能聲稱已修改不存在的 Spec 04。
- migration `1792195200000-SharedFieldsPersonalCopies.ts` 僅轉換舊單人 owner metadata，不改 bytes/hash/payload；測試驗證舊單人資料及隔離 DB up/down/up、約束和 entity drift。未執行正式或開發資料庫 migration。已有個人證據時拒絕 down，部署順序見 quickstart 第 14 節。

## 自動驗證

| 指令／案例 | 結果 |
| --- | --- |
| `pnpm -C server test --runInBand` | 87 suites，655 tests 通過 |
| `pnpm -C server test:schema` | 2 suites，3 tests 通過；含 owner XOR、每 record 唯一個人檔、不同人共存、source 唯一、舊單人 metadata 不改 hash |
| `pnpm -C server test:e2e` | 10 suites，60 tests 通過（1572.796 秒），設定確實包含 scale 檔；使用真 MySQL／Redis |
| `pnpm -C server test:e2e:security` | 6 suites，20 tests 通過（最終修正後重驗） |
| client lint／build | 通過；沒有 client 自動測試框架，不宣稱 client tests 通過 |
| server lint:check／build、root build／lint | 全部通過；server/root lint 為 0 errors、157 warnings，多為測試 mock 的型別／async 警告 |
| 最後追加回歸 | core／queue／API coverage 3 suites、39 tests 通過；涵蓋欄位快照竄改、邀請密文 SQL NULL、停止寄送競態及失效邀請不再入列 |

scale 使用 6,000 個合成員工、3 共用欄位及真 worker processor 完整完成簽署／產檔／結案，逐檔重讀 PDF、比對摘要和 owner；恰有 6,000 ready／record／file，hash 全部不同、document.completed 只有一次。另以 6,001 人保存及發起，確認數字不是上限。規模測試暫停 queue 消費以穩定量測後逐筆呼叫真 processor；HTTP→真 Redis→獨立 worker 消費與並發／重試另由 queue e2e 驗證，不將兩者混稱。

### 規模量測（補跑通過，1283.864 秒）

首輪量測發現等待工作重複累積至 40,326 筆，已修正為僅合併等待中的同一人工作，開始執行便釋放 dedup key；DB lease/CAS/unique constraints 仍為權威。第二次完整 e2e 通過 queueBacklog=6,000 斷言；因 console metrics 被測試環境吞掉，另補跑並以 stdout 記錄下列數據，結果再次通過。

| 量測 | 結果 |
| --- | --- |
| 6,001 人 request bytes | 198,497 bytes |
| 6,001 人發起 | 4,615.36 ms |
| 6,000 人發起 | 9,874.43 ms |
| 6,000 人簽署 | 386,125.06 ms |
| 6,000 人逐筆產檔至結案 | 875,266.40 ms（約 14 分 35 秒） |
| 抽樣最高 process RSS | 495,550,464 bytes（約 472.6 MiB） |
| 產檔前等待 queue 工作 | 6,000 筆 |
| MySQL global row-lock wait time 差值 | 0 ms；此串行樣本不代表正式並發保證 |
| manifest | 3,588,438 bytes |
| 6,000 份完成 PDF | 35,042,968 bytes |

量測採串行簽署與逐筆 processor，不能外推一般文件的 95% SLO 或正式環境吞吐。此輪已包含等待工作去重；期間後續 PDF 旋轉／裁切及日期縮放修正另外由四組 PDF 單元案例、真 PDF.js 視覺檢查及最終 core／queue 回歸驗證，未重新執行第三輪全公司壓測。

部署反向代理、真 Portal/SSO、正式信件及 production storage 未執行本次驗收。6,001 人請求約 192 KB，在本機 Fastify／Next.js body limit 內；不代表任意規模無資源限制，也不把傳輸限制換成人數上限。

## 瀏覽器與產物驗收

使用隔離 Next.js、真 NestJS/MySQL schema、Headless Chrome 與合成人員，未使用使用者實際文件／簽名。Browser harness 不寄信、不消費正式 queue，個人檔由真 CompletedPdfService／processor 產製；臨時 harness 已移除。

- 1280 px 桌面：上傳一頁橫式 842×595 PDF，拖入兩個簽名欄與一個日期欄；上傳階段無選人，畫面比例與原檔一致。
- 完整候選 6,001 人全選並發起成功；後端保持 3 個共用欄位、6,001 筆 assignment，未以顯示 chips 上限截斷提交名單。
- 實際手寫兩個欄位、同意告知、提交後顯示已簽／產製中且下載停用；個人檔 ready 後可下載，不必等其他人。
- 另以兩人文件驗證進度 1/2、建立人看到各人產製狀態，停止原因保存並顯示。stopped 後 creator 與本人完成檔 endpoint 均回 200。
- 390 px 窄螢幕：側欄改上方導航，文字、狀態與下載按鈕可閱讀操作；保留原生按鈕／輸入的鍵盤語意。沒有將大量完整清單逐一展開成 chips。
- 將實際下載 PDF 渲染檢查：兩個簽名、各自 QR 與日期出現在指定位置。另以 PDF.js 實際渲染 90 度／CropBox 合成完成檔確認位置；旋轉 90/180/270 度及 CropBox 回歸測試驗證可視座標轉換、PNG／QR 邊界、伺服器台北日期與原 PDF 不變。
- 開發模式重送簽署後檢查 log，未再出現 PNG data URL；關閉 Next Server Action 引數紀錄與邀請 token 路徑紀錄，後端電子簽 body 也不記錄原檔／簽名／名單。

第一次臨時 browser harness 等待逾時，不算成功驗收；後續重新建立隔離 schema 完成流程並正常退出。先前誤留於測試 DB 的單一合成草稿與 UI000000 使用者已以精確 ID/docNumber/empid 條件清除，逾時 harness 留下的單一合成 schema 也已驗明資料後移除；沒有刪除其他測試或開發資料。

## Deep review 修正

1. 發起固定欄位快照；簽署與產製時重驗 source/hash/field placement，阻擋事後直接改欄位座標。
2. audit 最新事件依插入 ID 取鏈頭，避免 occurredAt 早於鎖取得時間造成分叉。
3. DB 鎖統一 document→signer/log；邀請寄送、外部開啟、停止與產製重驗狀態。nullable 清值使用 null，避免 TypeORM 忽略 undefined。
4. 邀請分批入列、maintenance 使用 cursor 完整掃描；同一人等待工作去重、過期 lease 可重取，停止／過期／已投遞邀請不再重複排工作。
5. 個人檔與整體 snapshot 分交易，結案失敗不刪 ready 產物；失去 lease 的 worker 清自身孤檔，不覆蓋新 worker 結果。
6. 正式前端不再使用 mock 身分、合併 PDF 或假 QR；修正列表 role 參數、PDF 實際比例、窄螢幕、錯誤／pending 狀態與敏感 log。

## SC-001～SC-014 與限制

| 條件 | 本次證據／限制 |
| --- | --- |
| SC-001、SC-003 | 已走通建立／簽署 UI；未招募首次使用者做 90%／5 分鐘或 3 分鐘的可用性統計，不宣稱達成比例 |
| SC-002 | core e2e 的發起後修改、未知輸入、失敗 rollback 均阻擋 |
| SC-004、SC-013 | security/core e2e 的跨文件／跨人／外部失效拒絕；creator／本人 ready 下載成功 |
| SC-005 | 一般 10 人案例自動結案通過，未做 95% 統計 SLO；6,000 人是另外的全公司負載，不能把串行規模時間當一般文件 SLO |
| SC-006 | source/payload/field/PNG/hash/manifest 竄改拒絕測試 |
| SC-007 | 同 request／並發／重複 job／stale lease：單一 record、ready 不重製、一次結案 |
| SC-008 | 停止後不沿用證據；正式重新發起需新建文件，無舊成功結果複製入口 |
| SC-009 | 內外部主流程 HTTP e2e；外部無 users 帳號，瀏覽器手寫驗收為內部流程，真 Email／SSO 未測 |
| SC-010 | 截止／停止競態單元與 e2e；finalizing 不被 deadline 停止 |
| SC-011、SC-012 | 10 人 3 共用欄位→10 個獨立 PDF；先簽先產檔、失敗重試、停止後產製／下載 |
| SC-014 | 6,000 人全流程及 6,001 人保存／發起通過，量測如上 |

浮水印與拒簽選項仍可在既有 API 保存快照，但本次沒有對應繪製／拒簽流程；正式 UI 固定傳 false，不顯示未實作選項。未新增 dependency、環境變數、業務 table 或 scheduler。requirements checklist 按 [implement skill](../../.agents/skills/speckit-implement/SKILL.md) 的「do NOT modify checklist files or markers」保持唯讀，14/16 的品質審查狀態未冒充功能驗收進度。

T089–T132 已完成。T133 本機人工部分已完成，正式 Portal／代理／信件／storage 環境驗收與使用者可用性統計仍未執行，因此保留未勾選；本次開發與 deep review 結果不等同正式部署環境已驗收。

---

## 2026-10-16：依使用者指示執行本機 migration

- 目標：`127.0.0.1:3306 / feastogether_intranet`（`server/.env`），非測試 DB；本段更新前述「未執行開發資料庫 migration」狀態，正式環境仍未執行。
- 停止既有開發 HTTP／worker／client，完成資料庫 SQL 與 local 私有檔案備份後，執行 `pnpm -C server migration:run`。
- 成功套用 `SharedFieldsPersonalCopies1792195200000`；待執行 migration 為 0，TypeORM schema drift queries 為 0，field 的 signer_id 已移除，completed file owner 違規筆數為 0。
- 舊 document-only finalization queue 工作為 0，沒有刪除任何 queue 工作。
- 重新啟動 `pnpm dev`；HTTP `/api/health` 回 200、worker 啟動成功、client ready 且首頁回 307 導向。
- 備份位置：`/Users/user/.local/state/feastogether-intranet/backups/2026-10-16T13-19-48-724Z`，在 repository 外以私有權限保存，未納入提交。

# 歷史紀錄（以下不作本次交付證據）

## 2026-10-14：歷史提交前現況（已由本次 CR 取代）

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


## 2026-10-16 CR 實作基線

- 工作樹已有 spec/plan/tasks 修訂與 client mock 變更；保留使用者既有修改。
- 目前後端仍採 field.signerId、50 人驗證、document lease 及合併 PDF；將依 T089–T133 替換。
- client 仍有 memory store 與瀏覽器合成 PDF，不視為正式 API 已完成。
- Spec 04 目錄目前不存在，現有 QR service 存在；不擴張公開個資，個人副本的摘要依本次 manifest v2 設計同步。
- requirements checklist 14/16；兩項未勾選僅為既有 Canvas/SSO 技術文字限制，依使用者明確開發指示繼續，不更動審查標記。
- 契約：個人下載分 creator document/signers 與本人 signing-tasks 兩條資源；completion 為 nullable pending/processing/ready/failed 及 readyAt，欄位不含 signer owner。completed_pdf owner 為 document/record 恰選一種，本次只產製 record 個人副本。
- 環境檢查與測試結果持續追加，尚未宣稱完成。
