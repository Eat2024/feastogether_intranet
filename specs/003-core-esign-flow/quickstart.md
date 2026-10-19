# Quickstart: 核心電子簽端到端流程驗收

> **Spec 007 更新（2026-10-19）**：以下到期永久停止與補簽範圍外的記載為舊版決策，現由 Spec 007 取代。到期改為 expired，不填停止原因；人工停止維持永久 stopped。原始期限在固定 payload，sign_end_at 為有效期限；已簽證據及個人副本保留。補簽 API 與建立人取得新邀請端點已由 Spec 007 交付，沿用原證據且不自動寄信；前端正式串接另行交付。

> **本次 PR 範圍（2026-10-18）**：僅交付後端、migration 與契約；下文的前端設計及整合驗收保留為完整需求，前端實作由獨立 PR 交付。目前 client 為原有 mock 原型，不代表新版後端端到端流程已可由 UI 驗收。

> 2026-10-16 目標模型：共用欄位及個人 PDF。以下為實作完成後的驗收指南，本次尚未執行。

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

MySQL、Redis、Spec 2 auth 與 Client proxy 仍使用現有 `.env.test` / `.env.local` 命名；BullMQ 沿用 `REDIS_HOST/PORT/PASSWORD/DB`，不新增另一組 Redis 設定。驗收時應啟動 HTTP server、BullMQ worker 與 Client；worker 未啟動時外部信件、到期落盤與完成 PDF 不會自動處理。

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
- 最後兩名 signer 並發各自取得個人 lease，文件進入 finalizing，每人只有一份個人 completed PDF，整份流程只有一次 completed audit。
- Worker A lease 過期、Worker B 取得新 token 後，A 即使晚到也無法提交 B 已接手的個人產製狀態，A 的 orphan output 會被清理。
- MySQL commit 後模擬 BullMQ enqueue 失敗，maintenance reconciliation 會從 MySQL outbox／signer completion state 補入列，不遺失 invitation 或 finalization。
- 同一 notification/signer 被重複 enqueue 或 BullMQ retry 時，DB claim/unique/lease 仍只產生一次寄送狀態、完成檔案與完成 audit；不得靠固定 business `jobId` 才成立。
- 使用真實隔離 Redis 啟動最小 worker application context，驗證 HTTP → BullMQ → processor → DB/file 全鏈路，以及 web process 不會載入 consumer/scheduler。
- 測試環境使用 fake mailer 與 local temp storage，驗證不連外且與 SMTP/SES、S3 adapter 共用同一 contract；config 測試覆蓋四種環境 mapping 與 production 禁止 fallback。
- PDF 產製、儲存或完整性驗證失敗時保留已成功簽署，document 不 completed；重試不重複簽署或結案。
- 簽署 vs creator stop、簽署 vs deadline worker 同時發生時依 Server UTC/DB lock 得到唯一結果，deadline 後零新增成功證據。
- 簽署時間統一使用 `start <= now < end`；開始前、截止瞬間及之後都不能新增證據。
- Server 固定的同意 text/version/hash 必須同時出現在 task 與 signing payload；Client 無法發起任意版本或只換文字不換 hash。
- 所有 cookie-authenticated write 對缺少/不符 Origin 回 403，不執行 DB/file/token 寫入；external 頁面不可被 iframe 嵌入。
- 並發建立第一筆 audit 或追加事件時都只有一條線性 hash chain；creator/signer history response 依角色裁切。
- Log/error/response 不含 PDF、PNG data URL、Authorization/cookie、invitation token/digest/ciphertext、session、完整 Email 或其他簽署人個資。

## 5. User Story 1：先上傳共用欄位，再發起

1. 建立人上傳測試 PDF，設定兩個 signature 與一個 date，尚不選人；草稿保存成功。
2. 指定 10 人（至少包含一位外部 Email），帶 3 個不含 signerIndex/signerPublicId 的共用 fields 發起；確認只有 3 個 field ID。
3. 另驗 6,000 人及 6,001 人名單可完整儲存／發起；不設人數上限。共用欄位仍限 200 個，第 201 個欄位拒絕，不換算人數上限。
4. 發起後無法更改內容、名單、共用欄位或固定參數。

## 6. User Story 2：每人獨立簽署

1. A、B 看到同一組 field ID，但看不到對方 PNG、record 或敏感身分資料。
2. A 提交全部必要簽名後，signed 與 completion pending 同交易成立，worker 產製 A 的副本；其餘人仍 pending，文件仍 active。
3. B 在不同日期簽署，副本必須使用 B 的時間及簽名，不受 A 影響。
4. 外部簽署人以邀請簽署；成功回應清除 access cookie，不產生 receipt。舊邀請及 external-completions URL 都無法取得 PDF。

## 7. User Story 3：10 份個人 PDF 與結案

1. A ready 後立即以本人下載端點下載，建立人以 document/signers 路徑下載 A 副本；不必等待其他人。
2. A 改用 B 的 publicId 或別份 documentId 必須失敗；未授權者不能由回應判斷副本是否 ready。
3. 10 人全簽後文件為 finalizing；全部 ready 且結案 snapshot 成功後 completed。
4. 驗證恰有 10 筆有效 completed_pdf，分別關聯不同 record；每份只含本人簽名與日期，無重疊。本人 QR 連到本人 verification code。
5. 每份 persisted bytes 的 hash 與其 metadata、manifest v2 的本人項目一致；公開驗證只回本人 hash。未結案或停止時公開 completedPdfSha256 仍為 null。
6. 阻擋一個人的 storage 寫入，其他人 ready 檔案不變；重試只補失敗者。結案 snapshot 失敗不得回滾 ready，maintenance 後續可補結案。
7. 驗證 lease 過期舊 worker 無法覆寫、兩人並發不重複結案、enqueue 失敗可補入列；使用既有真 Redis queue e2e。

## 8. User Story 4：停止與全新重發

1. 建立第二份文件，讓一人先簽，creator 填寫原因後停止。
2. 確認 pending signer 與 external invitation 都立即失效，已簽署證據與 audit 仍可由有權者查看；即使停止時尚未產製，既有成功簽署的副本仍可產製並由本人／建立人下載。文件保持 stopped，不自動結案。
3. 以修正 PDF 建立另一份文件，重新指定同一群人。

預期：新 document id/doc number/source hash/payload hash 皆獨立，所有 signer 從 pending 開始，無舊 signature record/file 或版本關聯。

## 9. 到期與 worker 驗收

1. 以測試 clock 建立截止時間已過／即將到達的 active 文件，保留 pending signer。
2. 直接執行一次 maintenance processor 驗證業務邊界；另以真實 Redis 驗證 `esign-maintenance:30s` scheduler 已註冊且可喚醒 processor，不以長時間 sleep 等待。

預期：document expired，不填 stoppedAt／stopReason，已簽證據保留，pending signer 後續提交為零成功。重複 job/processor 不新增第二次 document.expired event；Redis 暫時不可用期間不改變 MySQL 文件狀態，恢復後下一輪 reconciliation 收斂。

## 10. 檔案與資料邊界人工檢查

- PDF 預覽：內部 creator/signing source-file 成功回應使用 CSP `frame-ancestors 'self'` 加上既有 `AUTH_TRUSTED_ORIGINS`，外部 source-file 僅允許 `'self'`；這三種成功回應移除全域 `X-Frame-Options: DENY`，未授權／越權錯誤與其他端點仍保留防護。從 Portal → 電子簽 → PDF 的巢狀 iframe 與外部簽署頁分別實測預覽；反向代理不可再次替 PDF 加上 DENY，且 Portal 的完整 origin（含 port）必須在既有允許清單。
- 瀏覽器 Network/React props 不出現其他簽署人 PNG、invitation token/ciphertext/digest 或 session cookie。
- Application/access log 中 invitation URL 必須已正規化，不可搜得 token、PNG prefix、PDF bytes、Cookie/Authorization、SMTP password 或 SES response。
- local/UAT 的 `ESIGN_STORAGE_ROOT` 不在 repository、Client public directory 或 Fastify static root；直接猜 object key 無法經 HTTP 取得，且 UAT 重啟 HTTP/worker 後檔案仍存在。
- production S3 bucket 啟用 Block Public Access，只允許應用程式 IAM role 的必要 prefix；bucket/object URL 不可直接下載，授權 API stream 仍可取得且 hash 與 DB 一致。
- 關閉 Redis 不得讓已建立的 employee session/MySQL 簽署交易改用未授權 fallback；MySQL 或 private storage 不可用時必須 fail closed。

## 11. 不屬於本次驗收

- 拒絕／退回簽署、依序簽署
- 催簽、批次通知、完成通知或簡訊
- 一般匯出、Excel、批次下載（Spec 05）
- QR Code 公開驗證（Spec 04）、完整 evidence package、PAdES-LT/LTA 或個人數位憑證
- 同一 document 的修改版本、版本關聯或舊簽署沿用
- 自行上傳簽名圖、文字字型簽名、手機號碼簽署人
- 多雲/MinIO storage framework、額外 Email provider、mail template 後台或長期封存政策

## 12. Migration 與全公司規模驗收

- 在獨立測試 DB 驗證 migration up/down/up 及 source、document-owned／record-owned 完成檔各自唯一鍵；既有單人完成檔如調整 owner，bytes/hash 必須不變。不以存在非草稿資料拒絕 migration，不要求舊多人合簽回放。
- 發布前停止舊 worker，排空舊 finalization 工作，不誤消費舊 payload。
- 使用合成 6,000 名有效員工、3 個共用欄位，驗證完整選人、儲存、發起、簽署、個人產製及結案；恰有 6,000 筆指派與 6,000 份正確副本。另驗 6,001 人可發起，確保測試基準沒有變成硬上限。
- 驗證跨候選名單頁面的全選不漏人；欄位仍 3 個、不產生 18,000 個配置。前端進度完整，不能因只顯示一頁而誤判全員完成。
- 名單含重複／無效員工時整筆發起失敗，無部分 active 名單。
- 暫停部分副本、模擬 Redis enqueue 失敗及超過單批 maintenance 掃描數量，確認最末一批仍可被補入列，無飢餓或遺失；成功副本不重製。
- 量測 request bytes、發起耗時、DB 鎖等待、峰值記憶體、queue 積壓、儲存量與結案時間；確認代理／HTTP 限制不阻擋五千多人需求。保留一般文件既有效能目標，大規模結果以實測回報，不假設無限資源。

## 13. 完成檔兩種歸屬的 schema 驗收

- completed_pdf 僅填 document_id 或僅填 signature_record_id 各自成功；兩者皆空、同時填兩者，或帶 document_field_id／verification_record_id／export_job_id 均失敗。
- 同一 document 重複文件層級 completed_pdf 失敗，同一 record 重複個人 completed_pdf 失敗；同文件不同 record 的個人副本可共存，且不與 source_pdf 唯一性衝突。
- 在 schema fixture 建立文件層級完成檔，確認個人下載缺少本人副本時不會回退取得它。
- 此處只驗證資料表示與授權邊界，不建立簽到表 UI、排版、產製或結案流程；本次 10 人簽署仍須產生 10 份個人副本。

## 14. 部署與回復順序

1. 暫停發起與簽署寫入，停止舊 HTTP／worker。備份 DB 與私有檔案；不得在舊 worker 仍可能寫入時修改 schema。
2. 排空舊 document-only finalization 工作；新 payload 必須同時含 documentId、signerId。只清理這次退役的 queue 工作，不刪除 DB 簽署證據或 PDF。
3. 由部署流程執行 `pnpm -C server migration:run` 套用 SharedFieldsPersonalCopies；確認 field 無 signer_id、signer 個人狀態、owner XOR 與 generated unique 均存在。
4. 部署新版 HTTP、client、worker，再恢復寫入。確認 30 秒 maintenance 可從 DB 補入缺少的個人工作；等待中的重複工作會合併，執行時釋放合併鍵，業務冪等仍由 DB 保證。
5. 用兩名合成員工檢查先簽先下載、第二人 ready 後才結案；檢查停止後保留本人副本及外部邀請失效。
6. 只有空白隔離測試 DB 執行 up/down/up。已有 completion 狀態時 down 會拒絕，以避免遺失個人歸屬；正式部署後需要回復時先停止寫入，採向前修正，或依已核准的完整 DB／檔案備份回復程序，不覆寫或重算既有證據。

傳輸邊界：本機 6,001 人／3 欄位 initiation JSON 約 192 KB，低於既有 Fastify 預設 1 MiB 與 Next Server Action 2 MiB；沒有調高限制或新增環境變數。部署代理的 body/timeout 設定須依實際 UAT 代理再驗，不能把代理錯誤轉成產品人數限制。
