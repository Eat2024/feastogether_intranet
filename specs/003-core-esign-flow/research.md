# Phase 0 Research: 核心電子簽端到端流程

## 1. 正式業務權威與 Client 遷移

**Decision**: NestJS/MySQL 成為文件、簽署人、欄位、簽署證據與狀態的唯一權威。Client 現有 UI 可沿用，但 `store.ts`、mock 當前使用者與 Server Actions 不再執行業務寫入，改為調用明確 REST contract。

**Rationale**: Spec 與 Constitution 都要求身分、權限、期限、hash 與寫入在 Server 裁決；Next.js process memory 無法提供持久化、交易與並發保證。

**Alternatives considered**: 在 Client store 繼續補權限與 hash 仍無法形成正式證據；Client 直接存取 MySQL 破壞 package 與授權邊界。

## 2. PDF 上傳與可處理性驗證

**Decision**: `multipart/form-data` 以 Fastify streaming limit 接收單一 PDF；固定上限 20 MiB、100 頁、不接受加密 PDF。Server 同時檢查 `%PDF-` signature、完整 parser load、page count、實際大小與 SHA-256，不信任 filename、Content-Type、Client 頁數或 hash。

**Rationale**: magic bytes 只能篩出顯然偽裝，parser 才能證明第一版有能力讀取與嵌入完成內容。固定上限讓 request memory、worker 處理與驗收可預測，避免新增未必要的 per-tenant 設定。

**Alternatives considered**: 只看 MIME/extension 可被偽造；先接收全部再檢查大小容易耗盡 memory；第一版處理加密 PDF 需另外密碼與解密邊界。

## 3. 私有檔案儲存

**Decision**: 定義單一窄化 `PrivateFileStorage` port，提供 persist、stream read、delete 與 metadata 回傳。local、test 與 UAT 綁定 filesystem adapter，使用 `ESIGN_STORAGE_ROOT` 指向 HTTP server 與 worker 共用的私有 persistent volume；檔案以 server-generated random object key 分層存放，先寫同目錄暫存檔再 atomic rename。production 綁定 AWS SDK v3 S3 adapter，bucket 啟用 Block Public Access，以不覆寫的隨機 object key 寫入並將 S3 VersionId（若有）保存為 object version。兩種 adapter 都不掛 static、不回傳 bucket/presigned URL；所有讀取均經授權 API stream，並在讀取或簽署前重算 SHA-256。Driver 或必要設定缺失時啟動 fail fast，production 不得 fallback 到 local。

**Rationale**: repository 已有 provider-neutral `esign_file_objects.object_key`；團隊也已確認 local/UAT 與 production 的部署媒介不同。單一 port 讓業務驗證、hash 與授權不分叉，同時使 UAT 維持易檢查的本地檔案、production 使用具持久性與權限控管的 S3。UAT 若 HTTP 與 worker 位於不同 host/pod，`ESIGN_STORAGE_ROOT` 必須掛載同一 NFS/共享 volume 並跨重啟保留，不能使用 container writable layer。S3 認證使用 runtime IAM role/default credential chain，不在 `.env` 保存 access key。

**Alternatives considered**: BLOB 寫 MySQL 會擴大 transaction/backup；公開 static URL 或直接發 presigned URL 會繞過每次 API 層的角色與資源授權；production 繼續依賴單機 volume 會綁死 HTTP/worker 拓撲；建立 MinIO/多雲 provider framework 超過目前已確認的 local/S3 需求。

## 4. 草稿、發起與不可變邊界

**Decision**: 草稿只能由 `created_by_user_id` 存取。發起 service 以 pessimistic document lock 開啟 transaction，重新讀取原 PDF 與摘要，驗證簽署人、欄位、截止時間與同意版本，產生 canonical signing payload JSON/SHA-256，寫入 snapshot、invitation outbox 與 audit 後一次轉為 `active`。所有後續 draft mutation 必須在 SQL condition 中同時要求 `status = draft`。

**Rationale**: 用 transaction 與條件寫入作競態仲裁，避免先查後寫讓發起與草稿修改同時成功。Canonical payload 綁定未來每筆簽署證據。

**Alternatives considered**: 由 Client 送 hash 無法證明實際儲存內容；只在 controller 檢查狀態有 TOCTOU 競態。

## 5. 簽署人與欄位模型

**Decision**: 沿用 `esign_signers` 的 user/email 互斥身分與文件內 unique indexes。新增 signer `public_id`、外部邀請 digest/ciphertext/expiry/delivery 欄位。`esign_document_fields` 新增 nullable `signer_id` FK：草稿編輯期可短暫未指派，但發起必須每個欄位屬於同文件 signer，且每名 signer 至少一個簽名欄位；date 欄位由 Server 以同一 `signed_at_utc` 呈現。

**Rationale**: 現有 field 沒有 signer 關聯，無法支援多人欄位與最小揭露。新增 FK 比在 JSON 或 object-key 隱藏關聯容易驗證與約束。

**Alternatives considered**: 一份全體共用 layout 不能表達每人指定欄位；只用排序或 Client map 無 server-side referential integrity。

## 6. 外部 Email 邀請與受限存取

**Decision**: 發起時每名 email signer 產生 32-byte CSPRNG base64url token，DB 保存 SHA-256 與最多到 document deadline 的 expiry。為了交易後寄信與重試，token 另以獨立環境金鑰作 AES-256-GCM 加密，成功寄送後立即清除密文，只留 digest。邀請 URL 的 GET 僅回 no-store/no-referrer 同源 bridge；bridge POST 驗證 token 後將原值設為 HttpOnly/Secure/SameSite=Lax 外部 cookie 並 303 導向不含 token 的頁面。每次簽署 API 都重算 digest 並檢查 signer/document/expiry/status。簽署成功時 invitation 立即失效，Server 另產生一個只能查看終止狀態與 completed PDF 的 receipt token，以 digest 存 DB，並用 signer public ID 限定 cookie path，因此同一瀏覽器可同時保留多文件 receipt。Receipt 在文件完成/停止前不過期，終止後保留 30 日；不能用它再簽署、查原始 PDF 或開啟其他文件。

**Rationale**: URL 在簽署或終止前必須可重開，因此不能在首次開啟就消耗。Bridge 立即移除 address bar 的 bearer secret，HttpOnly 避免交給 Client JavaScript。加密 outbox 讓 SMTP 短暫失敗可重試，又不長期保留可直接使用的明文憑證。獨立 receipt 在不復活 invitation、不新增完成通知 Email 的前提下滿足 external signer 取得完成結果；其時間從終止時才起算，不會因 PDF 反覆產製失敗而提前消失。30 日是第一版窄化存取視窗，長期封存仍不在範圍。

**Alternatives considered**: OTP 為 spec 明確排除；JWT 連同身分放 URL 可被解碼且擴大暴露；首開即失效違反可重開要求；永久保存明文 token 擴大 DB 外洩影響。

## 7. Email 寄送與 BullMQ outbox 邊界

**Decision**: 使用單一窄化 `InvitationMailSender` port 與現有 notification batch/log 作 invitation-only MySQL outbox，並沿用驗收系統的 BullMQ producer/worker 模式。local 由 Nodemailer SMTP adapter 投遞本機 Mailpit；automated test 注入 in-memory fake，不連外；UAT 與 production 由 Nodemailer SES transport 搭配 AWS SDK v3 `SESv2Client` 寄送。UAT 維持 SES sandbox，寄件身分與所有測試收件人必須先驗證；production 使用已驗證 sender/domain 並在目標 region 移出 sandbox，才能寄送一般簽署人。SES 認證走 runtime IAM role/default credential chain，不新增 access-key 環境變數。Initiation transaction 只 commit outbox；commit 後 producer best-effort 將 `notificationLogId` 加入 `esign-external-invitation` queue。Processor 以 DB CAS claim pending/failed log 後寄送；可預期寄送失敗由 DB `attempt_count/next_attempt_at` 作唯一 business retry budget，job 正常結束，maintenance 到期後再入列；只有未能安全落 DB 狀態的非預期 execution error 才 throw 交由 BullMQ 作有限 delivery retry。固定 maintenance scheduler 每 30 秒觸發 reconciliation，把仍可處理但未在 queue 中的 outbox 再入列。Job data 不含 Email、token、ciphertext 或 URL，且不設定固定業務 `jobId`；重複 job 由 DB claim/result 仲裁。

**Rationale**: 外部簽署必須取得 invitation，但 Email provider 與 Redis enqueue 都不可放在 MySQL transaction 內，也無法和 MySQL atomic commit。Mail port 讓相同 outbox/重試/敏感資料裁切可在 Mailpit 與 SES 重用；test fake 提供決定性驗證而不寄信。Outbox 保證業務工作不會因 enqueue failure 遺失；BullMQ 提供團隊已有經驗的喚醒、retry/backoff 與獨立 worker 生命週期，maintenance reconciliation 封住 commit 成功但 enqueue 失敗的窗口。

**Alternatives considered**: 發起 HTTP request 內同步寄信會產生「已寄出但 DB rollback」或長交易；log-only mailer 無法驗收真實連結流程；在 UAT 自建另一套 SMTP 服務增加維運但不驗證 production SES 整合；只用 BullMQ 而不留 MySQL outbox 會在 commit/enqueue 之間遺失工作；只做 worker setInterval polling 會自行重造 queue retry/scheduler。固定 `jobId=notificationLogId` 也不採用，因驗收系統已發現 retained completed/failed job 可能讓後續合法工作被靜默忽略。

## 8. 簽署交易、冪等與證據

**Decision**: 簽署 request 必填 client-generated UUID `requestId`，但不相信其業務內容。Service 開 transaction 並 lock signer/document，重驗 principal/invitation、active 狀態、deadline、原 PDF hash、payload hash、同意版本、所有必要簽名 PNG 與欄位。使用 server UTC 作唯一 `signed_at_utc`，同一 transaction 寫 signer status、單一 signature record、每個簽名欄位的 private file metadata 與 append-only audit。Unique signer evidence 與 authentication event/request ID 處理序列/並發重放，重複時回現有結果或穩定 conflict。

**Rationale**: 一筆簽署必須是全或無，且 server time 同時驅動證據與所有 date 欄位。DB unique constraint 是多 instance 並發的最終仲裁。

**Alternatives considered**: Client `agreedAt`、signature ID 或 hash 不能當權威；分開寫 signer/evidence/audit 會留局部成功。

## 9. 完成 PDF 與自動結案

**Decision**: 最後一筆簽署 transaction 只負責成立證據；commit 後 best-effort 將 `documentId` 加入 `esign-document-finalization` queue，不在 HTTP request 進行 PDF I/O。BullMQ processor 以 conditional update 將 `active` 且全員 signed 的文件轉為 `finalizing`，同時寫新 UUID lease token 與 5 分鐘 expiry。重驗 source/evidence hashes 後以 `pdf-lib` 嵌入每人 PNG 與 UTC 轉台北的 `YYYY/MM/DD`，寫入、重讀並驗證 final hash/page count，最後在 transaction 以 `status = finalizing AND finalization_lease_token = :mine` 作 CAS，才能寫 final file metadata、completed audit、`completed_at` 與 `status = completed`。失敗回 `active` 也必須命中同一 token。Maintenance reconciliation 會重新入列全員已簽但尚未 finalizing 的文件，並回收/重入列過期 lease；失去 lease 的舊 processor 必須清理自己的 orphan output，不能提交。

**Rationale**: 保留已成立簽署又不提前結案，也不在 DB lock 期間執行大型 PDF I/O。BullMQ 能立即喚醒 worker 並重試，但 queue delivery 可能重複、延遲或 enqueue 失敗，因此 DB conditional transition 與 fencing token仍是多 worker 唯一仲裁。

**Alternatives considered**: 在最後簽署 transaction 同步產檔會長時間持鎖且失敗時無法同時保留簽署；只由 Client 下載個人 PDF 不是可保存的全員完成結果；只依賴 BullMQ job existence 去重無法防止 lease 回收後的舊 worker 晚到提交。

## 10. 過期與停止競態

**Decision**: 簽署視窗統一為半開區間 `sign_start_at <= now < sign_end_at`。`esign-maintenance` queue 使用 BullMQ `upsertJobScheduler` 每 30 秒產生 maintenance job；processor 掃描 `active` 且 `sign_end_at <= now` 的文件，在 transaction lock 後再判斷是否還有 pending signer，有則轉 stopped並寫穩定系統原因/audit。同一 maintenance job 也 reconciliation invitation outbox、全員已簽 active 文件與 stale finalization lease。簽署 service 以同一 server UTC 和 row lock 決定：開始前或 `now >= sign_end_at` 一律不建立證據。手動停止同樣 lock document，僅 creator 可對 active 文件操作，completed/finalizing 不接受一般停止。

**Rationale**: DB lock + server time 產生唯一結果，不依賴 Client 時鐘或掃描剛好在截止點執行。

**Alternatives considered**: 只靠 UI 顯示 expired 不會停止後續 API；為每份文件建立單獨 delayed job 仍需處理 job 遺失／修改／清理。固定 scheduler 只負責喚醒 DB scan，不把 Redis timer 當狀態權威，且能在 outage 恢復後收斂。

## 11. API 與資料揭露

**Decision**: 內部 resource 放在 `/api/esign/*`，使用 Spec 2 employee session；外部 bridge/session/task 是獨立 public controllers，每次自行驗證 external cookie。Creator detail 只回簽署人 snapshot/status，不回簽名圖；signer task 只回本人、本人欄位、文件與整體計數。原始/完成 PDF 使用受權的 stream endpoint 並設 private/no-store headers。

**Rationale**: 將內部 session 與 Email bearer 邊界實體分開，可避免 `@Public()` 路由意外獲得內部功能或查看其他簽署人個資。

**Alternatives considered**: 同一 detail DTO 給 creator/internal/external signer 容易資料過度暴露；回傳 data URL 將簽名擴散到 JSON/log/devtools。

## 12. 既有原型與範圍衝突

**Decision**: Spec 03 頁面移除或隱藏拒簽、補簽、催簽、QR 公開驗證與一般匯出入口，不將這些原型狀態寫入正式 API。Spec 03 建檔時強制 `allow_reject = false`、`watermark_enabled = false`，固定平行簽署，不接受 Client 選項。保留無關 UI 檔案不等於將功能納入 Spec 03。

**Rationale**: Feature spec FR-034/035 明確排除這些行為，原型不可擴張已核准範圍或被誤述為正式功能。

**Alternatives considered**: 一次搬運所有原型會擴大 API、schema、權限與驗收矩陣，違反 KISS/YAGNI。

## 13. 同意文案權威

**Decision**: 第一版只支援 Server code 內的一個 active 繁體中文電子形式告知，以穩定 version 與 SHA-256 識別。Initiation 不接受 Client 自選 version，Server 將 active version/hash 放入 signing payload。Signing-task view 回完整告知 text、version 與 hash，提交只接受相同 version 與 `accepted=true`。

**Rationale**: 只保存 version 但不固定文案無法證明當時顯示內容；讓 Client 選版本也破壞 Server 權威。

**Alternatives considered**: 第一版建同意文案管理表/後台屬過度設計；只在 Client hardcode 不可驗證。

## 14. Cookie 寫入的 CSRF 與頁面嵌入

**Decision**: 所有使用 employee session、external access 或 receipt cookie 的 `POST/PUT/PATCH/DELETE` 都沿用 Spec 2 `OriginGuard`，要求 `Origin` 精確命中電子簽同源/受信 origin，並拒絕缺少或不符的 browser write。Invitation bridge POST 也是同源 form，必須通過相同檢查。外部簽署頁設 `frame-ancestors 'none'`；內部頁只允許 Spec 2 `AUTH_TRUSTED_ORIGINS`，不使用 `*`。

**Rationale**: SameSite=Lax 不能取代對 same-site hostile origin 的 write 防護，multipart/form-data 也可是 simple cross-origin request。Frame policy 同時降低 clickjacking 風險。

**Alternatives considered**: 只靠 cookie SameSite 或 CORS 不足以保證業務寫入來自受信頁面。

## 15. BullMQ 模組、queue 與測試模式

**Decision**: 依驗收系統實作建立單一 `BullRootModule`，以既有 `REDIS_HOST/PORT/PASSWORD/DB` 呼叫 `BullModule.forRootAsync`，`maxRetriesPerRequest=null`；不新增第二組 Redis 環境變數。`EsignQueueModule` 註冊並 export 三條 queue：`esign-external-invitation`、`esign-document-finalization`、`esign-maintenance`。HTTP `EsignModule` 只使用前兩條 producer；獨立 `EsignWorkerModule` 才提供三個 processors 與 maintenance scheduler。Processor concurrency 明確設定，job data 只含 non-sensitive local IDs。Scheduler 註冊失敗必須讓 worker 啟動或 readiness fail closed，不能只記 log 後假裝可服務。測試除 mock queue unit tests 外，必須啟動最小 worker application context 與真實隔離 Redis，覆蓋 HTTP/transaction → enqueue/reconciliation → processor → DB/file 的完整鏈路。

**Rationale**: 集中 root module 避免每個 worker module 重複 `forRootAsync` 或隱式依賴 import 順序；web/worker 分離避免 HTTP process 消費工作或多實例重複註冊 scheduler。真 queue e2e 能抓出 mock 看不到的 job retention、jobId 去重、module wiring 與 Redis DB isolation 問題。到期停止是 spec MUST，因此 scheduler 不可用必須明確反映服務降級。

**Alternatives considered**: 一條 queue 以多個 job name 分派會讓三種不同 concurrency、retry 與 retention 混在一起；每個 feature worker 各自註冊 Redis root 會形成順序耦合；只測 processor service 而不跑真 queue 無法驗證 producer/consumer 接線。
