# Quickstart: 核心電子簽端到端流程驗收

## 1. 前置條件

- Node.js >= 20.19.0，pnpm 11
- MySQL 8.4 測試 DB，名稱以 `feastogether_intranet_test` 開頭
- Redis 7 測試 DB，`REDIS_DB` 必須與 dev/UAT 隔離，供 employee session 與 BullMQ queue/e2e 使用
- Spec 2 WebView SSO/session 可建立至少 3 名 active 員工測試帳號
- HTTP server 與 worker 可同時讀寫的私有暫存/volume 目錄；UAT 必須是跨 process/pod 與重啟保留的共享 volume
- local 使用 Mailpit SMTP；UAT 使用 AWS SES sandbox，測試寄件身分與收件人已在目標 region 驗證
- 僅用於驗收的非機密 PDF，不使用正式文件、個資或真實簽名

```bash
pnpm install
pnpm -C server db:test:create
```

## 2. 測試環境設定

產生本次驗收用邀請加密金鑰與私有目錄：

```bash
openssl rand -base64 32
mktemp -d
```

將輸出填入本機人工驗收使用、且不提交的 `server/.env.local`：

```dotenv
ESIGN_STORAGE_DRIVER=local
ESIGN_STORAGE_ROOT=<absolute-private-test-directory>
EXTERNAL_SIGNING_ORIGIN=http://localhost:3000
ESIGN_INVITATION_ENCRYPTION_KEY_B64=<base64-32-random-bytes>
ESIGN_MAIL_DRIVER=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=no-reply@example.test
```

MySQL、Redis、Spec 2 auth 與 Client proxy 仍使用現有 `.env.test` / `.env.local` 命名；BullMQ 沿用 `REDIS_HOST/PORT/PASSWORD/DB`，不新增另一組 Redis 設定。驗收時應啟動 HTTP server、BullMQ worker 與 Client；worker 未啟動時外部信件、到期停止與完成 PDF 不會自動處理。

環境綁定固定為：local=`smtp + local`、automated test=`fake + local temp directory`、UAT=`ses + local shared persistent volume`、production=`ses + private S3`。自動化測試由 test bootstrap 明確覆寫成 fake mailer 與每次測試獨立的 temp directory，不沿用上述人工驗收 SMTP。UAT 另設定 `AWS_REGION`、`SES_FROM`；production 另設定 `AWS_REGION`、`SES_FROM`、`ESIGN_S3_BUCKET`，AWS 認證一律由 runtime IAM role/default credential chain 提供，不在 `.env` 放 access key。driver 與環境不符、必要值缺漏或 provider 無權限時必須 fail fast，不可降級至其他 adapter。

## 3. Migration 與靜態驗證

```bash
pnpm -C server migration:run
pnpm -C server test:schema
pnpm -C server lint:check
pnpm -C server test
pnpm -C server build
pnpm -C client lint
pnpm -C client build
```

Migration 回滾需在獨立空白測試 DB 驗證：

```bash
pnpm -C server migration:revert
pnpm -C server migration:run
```

不可對共用 UAT 或正式 DB 執行驗收回滾。

## 4. API 與安全自動化驗證

```bash
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm build
pnpm lint
```

自動化至少覆蓋：

- 只有 creator 可讀寫 draft，知道 document ID 的其他員工得到同等 404。
- PDF extension/MIME 正確但內容偽裝、空檔、損壞、加密、超過 20 MiB 或 100 頁均被拒絕。
- 重複內部 user、大小寫差異 external Email、此文件不存在的 signer/field 以及越界欄位均無法發起。
- 發起與 draft mutation 並發只有一個一致結果；active 後 title/PDF/signer/field/period/options 修改全部被拒絕。
- 未被指定員工、伪造 user ID、交換 signer public ID 或跨文件 field ID 都無法讀取/簽署。
- External invitation token 無效、過期、綁錯 signer/document，或文件已 stopped/completed 時均使用不揭露資訊的通用失敗。
- Invitation GET 不查 DB/不寫入，POST 才設 HttpOnly cookie；簽署前可重複開啟，終止後立即失效。
- 簽署缺欄位、非 PNG、過大 PNG、未同意、同意版本不符、source/payload hash 竄改、截止時間後均不寫成功證據。
- 同 signer 序列/並發重放最多一筆 signature record，且 signer/evidence/files/audits 無局部成功。
- 最後兩名 signer 並發只會使一個 worker 取得 finalizing，只有一份 completed PDF 與一次 completed audit。
- Worker A lease 過期、Worker B 取得新 token 後，A 即使晚到也無法提交 B 的 finalizing 狀態，A 的 orphan output 會被清理。
- MySQL commit 後模擬 BullMQ enqueue 失敗，maintenance reconciliation 會從 MySQL outbox／document state 補入列，不遺失 invitation 或 finalization。
- 同一 notification/document 被重複 enqueue 或 BullMQ retry 時，DB claim/unique/lease 仍只產生一次寄送狀態、完成檔案與完成 audit；不得靠固定 business `jobId` 才成立。
- 使用真實隔離 Redis 啟動最小 worker application context，驗證 HTTP → BullMQ → processor → DB/file 全鏈路，以及 web process 不會載入 consumer/scheduler。
- 測試環境使用 fake mailer 與 local temp storage，驗證不連外且與 SMTP/SES、S3 adapter 共用同一 contract；config 測試覆蓋四種環境 mapping 與 production 禁止 fallback。
- PDF 產製、儲存或完整性驗證失敗時保留已成功簽署，document 不 completed；重試不重複簽署或結案。
- 簽署 vs creator stop、簽署 vs deadline worker 同時發生時依 Server UTC/DB lock 得到唯一結果，deadline 後零新增成功證據。
- 簽署時間統一使用 `start <= now < end`；開始前、截止瞬間及之後都不能新增證據。
- Server 固定的同意 text/version/hash 必須同時出現在 task 與 signing payload；Client 無法發起任意版本或只換文字不換 hash。
- 所有 cookie-authenticated write 對缺少/不符 Origin 回 403，不執行 DB/file/token 寫入；external 頁面不可被 iframe 嵌入。
- 並發建立第一筆 audit 或追加事件時都只有一條線性 hash chain；creator/signer history response 依角色裁切。
- Log/error/response 不含 PDF、PNG data URL、Authorization/cookie、invitation token/digest/ciphertext、session、完整 Email 或其他簽署人個資。

## 5. User Story 1：建立與發起

「發起簽署」只呼叫一次 `POST /api/esign/documents/:id/initiations`，body 必須同時包含 `signers`、`fields`、`signStartAt`、`signEndAt`。每個 field 使用 `signerIndex`（本次 signers 陣列從 0 開始的索引），不是尚未建立的 signerPublicId。後端在同一個 transaction 儲存名單、欄位、active 狀態、固定快照、稽核及通知待辦；任何步驟失敗皆回滾，commit 後才排寄信工作。不再支援只傳期間的舊發起請求。

「儲存設定」不發起，仍使用草稿 `PUT .../signers` 與 `PUT .../fields`；這兩隻 API 保留供編輯草稿，不是發起流程的前置呼叫。

欄位編輯器使用本機隨應用程式部署的 PDF.js（`pdfjs-dist`，採支援既有 Node 20.19 執行環境的 5.4.624），不將文件傳往外部預覽服務。`/pdf-assets/*` 僅提供 worker、字型與解碼資產；文件仍經有權限檢查的 source-file API 讀取。

在 `/forms/[id]/signers` 選擇簽署人，拖入或按按鈕新增簽名／日期欄位，可移動、調整尺寸、刪除、切換 PDF 頁面與重新指派所屬簽署人。選取欄位後方向鍵可微調，Shift 加快移動，Delete／Backspace 刪除。每人可有多個欄位；發起前每人至少需一個簽名欄位。儲存並重新開啟後須還原所有欄位；刪除簽署人只移除該人的欄位，不得移動其他人的位置。

欄位資料驗證可在 Node 22.18+ 執行 `node --experimental-strip-types --test client/tests/field-placement.test.mjs`，不需新增前端測試框架。瀏覽器驗收需另涵蓋拖曳、旋轉／裁切 PDF、儲存後還原、增刪簽署人、PDF 載入失敗重試與窄螢幕嵌入。

1. 以員工 A 的 Spec 2 session 開啟新增文件。
2. 上傳 2 頁有效 PDF，輸入文件名稱。
3. 加入內部員工 B 與 external `candidate@example.test`。
4. 為兩人各設一個 signature field 與 date field，設未來截止時間後發起。

預期：

- Document 進入 active，回應有後端驗證頁數/hash，但沒有 invitation token。
- DB 的 source file hash 與私有檔案重算相等，signing payload/hash 已固定。
- External invitation outbox 有且僅有一筆；local Mailpit（或 UAT SES sandbox 的已驗證收件人）收到一封邀請信。
- 重新上傳、改標題、改簽署人、改欄位與改截止時間全部失敗，原資料零變動。

## 6. User Story 2：內部與外部簽署

### 內部簽署人

1. 員工 B 在待簽清單看到文件，不能看到 external signer Email 或其他簽名。
2. 開啟固定 PDF、閱讀同意文案，以 Canvas 完成本人所有 signature fields。
3. 確認簽署，重複送出同 request ID。

預期：第一次建立一筆證據，第二次回同一結果；日期取自 Server `signed_at_utc`，Client `agreedAt` 或本機時鐘不會成為權威。因 external signer 尚未簽，document 仍 active。

### 外部簽署人

1. 從 local Mailpit 或 UAT SES sandbox 開啟 invitation URL，確認 GET 不設 cookie，bridge POST 後才 303 到乾淨 URL。
2. 關閉瀏覽器，再開同一 invitation URL，仍可進入同一任務。
3. 完成同意與 Canvas 簽名。

預期：外部人只看到自己的 snapshot/欄位，不有內部 session 或其他系統權限；簽署後 invitation access cookie 清除，重開 invitation 得到通用失效結果。同一瀏覽器取得以 signer public ID 限定 path 的唯讀 receipt cookie，可與其他文件 receipt 並存；它在文件 finalizing 期間不過期，文件完成/停止後可再存取 30 日。清除 cookie 後不可用舊 invitation 復原。

## 7. User Story 3：完成 PDF 與結案

1. 在內外兩人都簽署後保持 worker 運行。
2. 輪詢 creator 詳情，允許短暫顯示 active/finalizing，最後必須 completed。
3. Creator、員工 B 可下載 completed PDF；external signer 的原瀏覽器以該 signer path-scoped receipt cookie 可下載；未參與的員工 C 得到 404。

預期：

- Completed PDF 以原 PDF 為底，兩人的簽名只出現在各自欄位，date 與各自 Server 簽署時間一致。
- Final PDF 重算 hash 與 DB metadata 一致，只有一筆 active completed object 與一次 completion event。
- completed 文件的 edit/stop/delete/re-upload/sign 均失敗。

## 8. User Story 4：停止與全新重發

1. 建立第二份文件，讓一人先簽，creator 填寫原因後停止。
2. 確認 pending signer 與 external invitation 都立即失效，已簽署證據與 audit 仍可由有權者查看。
3. 以修正 PDF 建立另一份文件，重新指定同一群人。

預期：新 document id/doc number/source hash/payload hash 皆獨立，所有 signer 從 pending 開始，無舊 signature record/file 或版本關聯。

## 9. 到期與 worker 驗收

1. 以測試 clock 建立截止時間已過／即將到達的 active 文件，保留 pending signer。
2. 直接執行一次 maintenance processor 驗證業務邊界；另以真實 Redis 驗證 `esign-maintenance:30s` scheduler 已註冊且可喚醒 processor，不以長時間 sleep 等待。

預期：document stopped，reason 是穩定的「簽署期限已到」，已簽證據保留，pending signer 後續提交為零成功。重複 job/processor 不新增第二次 stop event；Redis 暫時不可用期間不改變 MySQL 文件狀態，恢復後下一輪 reconciliation 收斂。

## 10. 檔案與資料邊界人工檢查

- PDF 預覽：內部 creator/signing source-file 成功回應使用 CSP `frame-ancestors 'self'` 加上既有 `AUTH_TRUSTED_ORIGINS`，外部 source-file 僅允許 `'self'`；這三種成功回應移除全域 `X-Frame-Options: DENY`，未授權／越權錯誤與其他端點仍保留防護。從 Portal → 電子簽 → PDF 的巢狀 iframe 與外部簽署頁分別實測預覽；反向代理不可再次替 PDF 加上 DENY，且 Portal 的完整 origin（含 port）必須在既有允許清單。
- 瀏覽器 Network/React props 不出現其他簽署人 PNG、invitation token/ciphertext/digest 或 session cookie。
- Application/access log 中 invitation URL 必須已正規化，不可搜得 token、PNG prefix、PDF bytes、Cookie/Authorization、SMTP password 或 SES response。
- local/UAT 的 `ESIGN_STORAGE_ROOT` 不在 repository、Client public directory 或 Fastify static root；直接猜 object key 無法經 HTTP 取得，且 UAT 重啟 HTTP/worker 後檔案仍存在。
- production S3 bucket 啟用 Block Public Access，只允許應用程式 IAM role 的必要 prefix；bucket/object URL 不可直接下載，授權 API stream 仍可取得且 hash 與 DB 一致。
- 關閉 Redis 不得讓已建立的 employee session/MySQL 簽署交易改用未授權 fallback；MySQL 或 private storage 不可用時必須 fail closed。

## 11. 不屬於本次驗收

- 拒絕／退回簽署、補簽、依序簽署
- 催簽、批次通知、完成通知或簡訊
- 一般匯出、Excel、批次下載
- QR Code 公開驗證、完整 evidence package、PAdES-LT/LTA 或個人數位憑證
- 同一 document 的修改版本、版本關聯或舊簽署沿用
- 自行上傳簽名圖、文字字型簽名、手機號碼簽署人
- 多雲/MinIO storage framework、額外 Email provider、mail template 後台或長期封存政策
