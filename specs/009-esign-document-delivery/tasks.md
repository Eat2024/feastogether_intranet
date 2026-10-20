# Tasks: 電子簽文件與簽署人管理補強（Spec 009）

**Input**：[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts](contracts/)、[quickstart.md](quickstart.md)。
**Status**：Ticket 01 已進入實作；僅已完成且有驗證證據的項目勾選，整體交付仍進行中。
**Tests**：依 spec 驗收要求與 constitution 的身分／交易／Hash／migration驗證義務列入風險相稱測試；client 現無test script，不新增框架。測試任務先於對應實作準備，實作後必須跑過，不能只新增檔案即算驗收完成。

格式 `- [ ] Txxx [P?] [US?] 說明＋路徑`。[P] 僅表示同一階段、前置完成後可與不同檔案任務並行，不代表可跳過依賴。新增檔案路徑是預定位置；TypeORM migration 用實作當時合法時間戳產生於指定 migrations 目錄。近距離路徑省略前綴時承接該任務已寫出的 feature 目錄。

## Phase 1：Setup

目標：確認工作基線與既有邊界；不重建 workspace、不初始化新框架。

- [x] T001 核對 `specs/009-esign-document-delivery/spec.md`、`plan.md`、`contracts/` 與 root／client／server `AGENTS.md`；將目前分支、使用者既有修改及六故事驗收對照記在 `specs/009-esign-document-delivery/implementation-notes.md`，不得覆寫既有變更。

## Phase 2：Foundational

目標：建立共同錯誤與安全回歸基線；完成後才開始各故事。schema、依賴與 worker 變更留在所屬故事，避免為 US1 先做完整匯出平台。

- [ ] T002 依兩份 API 契約在 `server/src/common/errors/app-error-code.ts`、`server/src/common/errors/app-errors.ts` 定義草稿、拒簽、催簽、備註、匯出穩定錯誤；同步 `client/src/api/errorCodes.ts`，不輸出 storage key、credential 或原始 SMTP 錯誤。

- [ ] T003 在 `server/test/esign-document-delivery-security.e2e-spec.ts` 建立員工A/B、外部本人與未登入情境，保留「匯出有效員工 session 不限建立人；草稿／催簽／備註仍僅建立人」的測試基線；沿用隔離 DB 命名保護及既有 session fixture，不新增 RBAC。

## Phase 3：US1 完整暫存名單與期間（P1，MVP）

對應 FR-001–005、SC-001。獨立驗收：混合／純外部名單與完整、單端、清空日期，登出登入後一致；非法輸入整筆不變且不發信。

- [x] T004 [P] [US1] 在 `server/src/features/esign/services/esign-signer.service.spec.ts` 補草稿原子保存與回填案例：日期 omitted 保留、null 清空、單端與過去日期可存、兩端時 start<end、非法名單及期間全部回滾、非建立人與發起競態。

- [x] T005 [US1] 修改 `server/src/features/esign/entities/esign-document.entity.ts` 日期 check：引用「draft 日期允許任一端 null；皆有時 start<end。非草稿必須兩端完整」；新增對應 TypeORM migration 於 `server/src/infrastructure/database/migrations/`，同步 `server/src/infrastructure/database/schema.sql` 及 schema metadata tests，down 對單端草稿不得偷偷清值。

- [x] T006 [US1] 新增 `server/src/features/esign/dto/draft-settings.dto.ts` 並擴充 `services/esign-signer.service.ts`：signers 出現時整批取代且至少一人、未出現保留；日期「omitted 保留、null 清空」，watermark／allowReject 僅 boolean；同一 document 鎖與交易保存名單、日期及選項。

- [x] T007 [US1] 在 `server/src/features/esign/controllers/documents.controller.ts` 接 `PATCH :documentId/draft-settings`，回完整詳情；舊 `PUT :documentId/draftSave` 委派同 service 且保持 signers 回應相容；更新 `services/esign-view.mapper.ts` 與 `dto/document.dto.ts` 回填期間／選項，正式發起仍驗完整期間。

- [x] T008 [US1] 在 `client/src/api/endpoints.ts`、`types/esignDocuments.ts`、`requests/esignDocuments.ts` 新增草稿設定契約及匯出索引；接入 `client/src/features/esign-documents/DocumentSignersEditor.tsx` 的名單／日期／選項暫存、重新載入與台北日期轉換，移除發起固定傳 false 的行為。

- [x] T009 [US1] 在 `server/test/esign-draft-settings.e2e-spec.ts` 驗證新舊 API、session／Origin、schema 與交易回滾；將 US1 瀏覽器 roundtrip 結果記入 `specs/009-esign-document-delivery/implementation-notes.md`，確認沒有寄信或發起。

## Phase 4：US2 後端依設定繪製浮水印（P1）

對應 FR-006–009、SC-002–003。獨立驗收：watermark true 每頁中文正常、false 不畫；直橫旋轉裁切皆可讀，既有副本 hash 不變。

- [x] T010 [P] [US2] 在 `server/src/features/esign/services/completed-pdf.service.spec.ts` 加 true/false、所有頁面、90/180/270度、CropBox、缺字型失敗及已有副本不重繪測試；樣本使用合成 PDF，驗證 hash 在加印後建立。

- [x] T011 [US2] 從 root 以 pnpm filter 安裝 `@pdf-lib/fontkit` 至 `server/package.json` 並更新 `pnpm-lock.yaml`；在 `server/assets/fonts/` 加可合法再散布的固定繁體中文字型與授權檔，於 `server/nest-cli.json` 配置 build 複製並確認 production 路徑，不依賴系統字型。

- [x] T012 [US2] 在 `server/src/features/esign/services/completed-pdf.service.ts` 讀固定 payload 的 watermark，依 `client/src/features/my-signature/sign/pdfCanvas.ts` 樣式在可視頁面座標畫「饗賓集團 內部文件 請勿外流」；true 才載字型／繪製，沿用旋轉 helper，在最終 hash／manifest 前完成，不覆寫原檔或舊成果。

- [x] T013 [US2] 檢查 `client/src/features/my-signature/sign/pdfCanvas.ts` 及正式下載呼叫點，移除正式完成副本的前端水印繪製責任，保留 `DocumentSignersEditor.tsx` 的 watermark 選擇；不將整個 mock 簽署流程宣稱已正式串接。

- [x] T014 [US2] 在 `server/test/esign-watermark.e2e-spec.ts` 驗證 build 後字型可讀、同一副本各下載入口 bytes一致與舊副本未變；將視覺中文／簽名／QR檢查記於 `specs/009-esign-document-delivery/implementation-notes.md`，ZIP一致性留待US3整合。

## Phase 5：US3 大量副本 ZIP 與七天重用（P1）

對應 FR-010–021、SC-004–008。獨立驗收：合成已簽資料可測受理、離頁、快照、七天重用與續傳；拒簽排除的最終整合於 US4 完成後重跑。

- [x] T015 [P] [US3] 新增 `server/src/features/esign/services/esign-export.service.spec.ts` 測文件鎖防重、固定 signature IDs、等待副本、不同員工重用同工作、完成+168小時到期、新簽不混入、全拒／無已簽409與 failed重試原快照；受理不讀PDF。

- [x] T016 [US3] 擴充 `server/src/features/esign/entities/esign-export-job.entity.ts` 的 publicId「UUID unique」、snapshotAt/Json/Sha256、resolvedFilesJson、processedCount/waitingCount、expiresAt、leaseToken/ExpiresAt、attemptCount/nextAttemptAt、stagingJson；status 固定「pending / waiting / processing / completed / failed / expired」，舊資料新增欄位nullable且空快照不可重用；新增migration與 `server/src/infrastructure/database/schema.sql` 同步索引(documentId,exportType,status,expiresAt,id)、(status,nextAttemptAt,id)、leaseExpiresAt。

- [x] T017 [US3] 擴充 `server/src/features/esign/entities/esign-file-object.entity.ts`：ZIP owner 使用 exportJobId、documentId=null，purpose=signed_copies_zip、mime=application/zip、unique(exportJobId,filePurpose)；在 `repositories/export-job.repository.ts` 實作短交易查重、lease fencing與批次快照讀取，透過 `server/src/infrastructure/database/mysql/mysql.module.ts` 註冊，migration/schema tests同步。

- [ ] T018 [US3] 在 `server/package.json` 與 `pnpm-lock.yaml` 以 pnpm filter 加 archiver、必要型別與 @aws-sdk/lib-storage；擴充 `server/src/infrastructure/file-storage/private-file-storage.port.ts` 的 ZIP storeStream、AbortSignal、Range、暫存清理契約，保留既有 store(bytes) 與PDF/PNG功能。

- [x] T019 [P] [US3] 依新 port 在 `server/src/infrastructure/file-storage/local-private-file-storage.service.ts` 實作背壓串流、size/hash、generation暫存檔、完成後原子發布及range讀；增加相鄰 `.spec.ts` 覆蓋失敗中止／磁碟錯誤／不刪來源。

- [ ] T020 [P] [US3] 依新 port 在 `server/src/infrastructure/file-storage/s3-private-file-storage.service.ts` 實作multipart串流、Range與Abort；partSize至少16MiB、queueSize=2並依預估量保持≤10,000 parts，持久追蹤uploadId/generation及清理孤兒；相鄰 `.spec.ts` 驗證未知長度、完成失敗、abort及版本引用。

- [x] T021 [US3] 新增 `server/src/features/esign/services/esign-export.service.ts`，實作有效員工session跨建立人申請、固定已簽快照與安全唯一檔名、有效成果/進行中工作優先重用、failed retry保留快照與completed七天內毀損503；不得以建立人或新增簽署變更cache key，GET不啟動工作。

- [x] T022 [US3] 新增 `server/src/worker/esign/document-export.processor.ts`，按快照逐份懶讀既有PDF、串流校驗hash並輸出單一STORE ZIP64；等待原finalization而不重繪、缺檔/竄改整體失敗、lease續租及generation fencing、等storage成功才交易發布，重試同快照且不對外提供半包。

- [x] T023 [US3] 在 `server/src/features/esign/esign-queue.constants.ts`、`esign-queue.module.ts`、`services/esign-job-producer.service.ts` 與 `server/src/worker/esign/esign-worker.module.ts` 註冊專用export queue、全域concurrency=1；擴充 `esign-maintenance.processor.ts` 的有界補列／lease恢復／七天成果與殘件清理，不新增scheduler或在HTTP註冊processor。

- [x] T024 [US3] 新增 `server/src/features/esign/controllers/exports.controller.ts` 與 `dto/export.dto.ts`，接文件查找、申請、歷史、詳情、retry路由，游標limit「1–100」；回200重用/202工作/409空名單，明示snapshotAt/count/expiresAt，不回storage key；於 `esign.module.ts` 註冊，保留其他管理端點creator規則。

- [x] T025 [US3] 在 `server/src/features/esign/controllers/exports.controller.ts` 實作原生ZIP串流下載，逐次驗員工session、document/job/file歸屬及now<expiresAt；200/206/416與If-Range規則、到期410、未完成409、遺失503，attachment/private-no-store/nosniff，不發presigned URL。

- [x] T026 [US3] 擴充 `client/src/api/endpoints.ts`、`types/esignDocuments.ts`、`requests/esignDocuments.ts`、`queries/esignDocuments.ts`、query-keys/options及各index，串接 `client/src/features/esign-documents/DocumentExportView.tsx` 與 `DocumentsListView.tsx` 的跨建立人文件查找、申請、歷史、進度、retry、快照/期限與原生下載；不取整包Blob，不經creator-only詳情取得別人的匯出資料。

- [x] T027 [US3] 新增 `server/test/esign-export.e2e-spec.ts` 及 `server/src/worker/esign/document-export.processor.spec.ts`，驗兩員工重用、無/外部session拒絕、錯歸屬、七天邊界、GET唯讀、來源hash、兩worker全域上限、DB提交後enqueue失敗與stale worker不可發布；驗 `client/next.config.ts` 代理保留Range/stream標頭。

- [ ] T028 [US3] 建立 `server/test/performance/esign-export-benchmark.ts` 的隔離合成資料與測量入口（不得連正式DB），實測6,000份及>4GiB、STORE/DEFLATE1/6、local與部署使用的S3、正常簽署基準／匯出中p95、RSS/CPU/續傳/kill-worker；結果存 `specs/009-esign-document-delivery/performance-results.md`，受理p95≤5秒、簽署增幅≤20%、無OOM/漏件，未達標不得勾完成。

## Phase 6：US4 拒簽與正確結案（P1）

對應 FR-022–026、SC-009–010。獨立驗收：一簽一拒、全員拒、簽拒競態與重送，已拒不補簽、不產PDF且他人仍能簽。

- [x] T029 [P] [US4] 新增 `server/src/features/esign/services/esign-rejection.service.spec.ts`，覆蓋內外部本人、allowReject=false、期間外、簽拒競態、相同requestId回原結果與不同內容409；原因「trim 後最多200 code points」、留白、null非法。

- [x] T030 [US4] 修改 `server/src/features/esign/entities/esign-signer.entity.ts` 狀態與completion check，新增「rejectRequestId（nullable UUID）」；沿用rejectedAt/rejectReason，pending/rejected completion欄位全null、signedAt與rejectedAt互斥，建立migration並同步 `server/src/infrastructure/database/schema.sql` 和schema tests；down有rejected時拒絕破壞資料。

- [x] T031 [US4] 實作 `server/src/features/esign/services/esign-rejection.service.ts`，document→signer鎖定、本人/allowReject/有效窗口檢查、單一終態、原requestId與正規化內容重送驗證；追加signer.rejected audit且不建signature record，沿用 `esign-signing.service.ts` 鎖序並注入 `esign.module.ts`。

- [x] T032 [US4] 在 `server/src/features/esign/controllers/signing-tasks.controller.ts`、`external-signature.controller.ts` 接rejection子資源與 `dto/rejection.dto.ts`；擴充 `services/esign-access-policy.service.ts`／`external-access.service.ts` 讓已拒本人僅可讀結果及同次重送，不可讀來源或完成PDF；201首次/200重送。

- [x] T033 [US4] 修正 `server/src/worker/esign/document-finalization.processor.ts` 與 `server/src/features/esign/services/esign-verification.service.ts`：pending=0且readySigned=signed才結案，全拒不等PDF；新manifest含拒簽摘要及audit對應、只signed有PDF，保留舊版本驗證與stopped/expired狀態語意。

- [x] T034 [US4] 在 `client/src/api/` 的既有簽署型別／request檔新增拒簽；串接 `client/src/features/external-signing/ExternalSigning.tsx`、`client/src/features/my-signature/sign/SignFlow.tsx` 與相鄰正式Server Action，恢復allowReject選項、確認拒簽/200字原因與結果頁，不以mock拒簽算完成。

- [ ] T035 [US4] 新增 `server/test/esign-rejection.e2e-spec.ts` 並擴充finalization／verification相鄰tests，驗混合、全拒、事件hash、同時簽拒與舊manifest；在 `server/test/esign-export.e2e-spec.ts` 加拒簽不計入ZIP且全拒回409案例。

## Phase 7：US5 外部催簽與通知紀錄（P1）

對應 FR-027–034、041、SC-011–012。獨立驗收：多位外部逐人結果、同日限額、午夜重置、原邀請與提醒均走OTP，未知投遞不盲重送。

- [ ] T036 [P] [US5] 新增 `server/src/features/esign/services/esign-reminder.service.spec.ts` 測selected/all_pending、跨頁、重複ID、混合內外部、跨文件整批拒、0 eligible、台北23:59:59/00:00、並發批次與跨午夜pending；確認初邀/OTP不占催簽額度。

- [ ] T037 [US5] 擴充 `server/src/features/esign/entities/esign-notification-batch.entity.ts`：publicId UUID unique、kind invitation/reminder（舊資料invitation）、requestId nullable、requestPayloadSha256及unique(documentId,notifiedByUserId,requestId)；log entity加skipped/unknown、dispatchDate DATE nullable、leaseToken、attemptHistoryJson、reminderTokenSha256 unique nullable/ciphertext/generationSha256/expiresAt nullable；同步migration/schema/tests與signerId/result/dispatchDate索引，保留既有逐人唯一鍵。

- [ ] T038 [US5] 在 `server/src/features/esign/repositories/notification.repository.ts` 與新 `services/esign-reminder.service.ts` 實作建立人授權、文件→排序signer鎖、正規化payload hash防重、當日額度與in-flight去重、batch/log原子保存後enqueue；略過者留穩定原因，無可寄者409且不建空批次。

- [ ] T039 [US5] 擴充 `server/src/features/esign/services/esign-token.service.ts`、`external-access.service.ts`、`external-otp.service.ts` 及 `repositories/notification.repository.ts` 的reminder憑證解析：不旋轉原invitation digest，依log hash與generation驗當輪、加密原值供寄送；仍走OTP，signed本人下載不受提醒或ZIP期限影響，不能用publicId授權。

- [ ] T040 [US5] 擴充 `server/src/worker/esign/external-invitation.processor.ts`：依kind讀原邀請或reminder密文，SMTP前再驗pending/期間/當日額度並持久保留dispatchDate與lease；成功清密文留hash，明確失敗重試原log，未知結果unknown不自動再寄；逐人信僅含文件/期限/本人入口，attemptHistory不含憑證或SMTP原文。

- [ ] T041 [US5] 修改 `server/src/worker/esign/esign-maintenance.processor.ts` 與 `server/src/features/esign/repositories/notification.repository.ts` 納入reminder補列、有限失敗重試及過期processing轉unknown；防跨午夜舊工作重排，不新增午夜或自動催簽scheduler，完成後清理無需再寄的密文。

- [ ] T042 [US5] 新增 `server/src/features/esign/controllers/notification-batches.controller.ts`、`dto/notification-batch.dto.ts` 並註冊module，接POST202與GET批次/明細分頁、kind篩選、逐人原因／attempt history裁切；管理名單通知摘要與eligibility回傳依契約，不把受理說成已送達。

- [ ] T043 [US5] 擴充 `client/src/api/` 通知request/types/query與 `client/src/features/esign-documents/DocumentDetailView.tsx`，接單人、多選、所有外部催簽、當日限制、逐人通知紀錄／初邀區分；按鈕人數只算外部，mutation同次重送沿用requestId、刷新結果，不加入內部同事寄信。

- [ ] T044 [US5] 新增 `server/test/esign-reminders.e2e-spec.ts` 並擴充 `server/src/worker/esign/external-invitation.processor.spec.ts`，驗SMTP前失效、同日跨批去重、未知結果、舊輪token失效、原邀請仍可下載、重試密文清除及無個資外洩；結果記入 `specs/009-esign-document-delivery/implementation-notes.md`。

## Phase 8：US6 備註、結果列表與歷程身分（P1）

對應 FR-035–040、SC-013–014。依賴 US4/US5 的正式結果；備註及actor mapping可先獨立進行。驗收：儲存後重整一致，簽/拒時間與匯出一致，真正系統動作仍顯示系統。

- [x] T045 [P] [US6] 在 `server/src/features/esign/services/esign-view.mapper.spec.ts` 補actor事件類型、姓名快照與本人裁切測試；透過 `server/test/esign-signer-management.e2e-spec.ts` 公開 HTTP 接縫測note 0/30/31 code points、trim、null非法、清空、取消與非建立人，完成/停止後可存但不改證據。

- [x] T046 [US6] 在 `server/src/features/esign/entities/esign-signer.entity.ts` 加note「varchar(30)，utf8mb4；service 限30 code points、預設空字串」並同步migration/schema tests；沿用 `services/esign-signer.service.ts` 並新增 `dto/signer-note.dto.ts`，在 `controllers/documents.controller.ts` 接PATCH note，最後成功寫入值為準，非建立人/錯歸屬拒絕。

- [ ] T047 [US6]（Ticket04已完成日期、原因、note與actor；通知摘要留待Ticket06整合） 修改 `server/src/features/esign/services/esign-document-query.service.ts`、`esign-view.mapper.ts` 與 `dto/document.dto.ts` 回signedAt/rejectedAt/rejectReason/note/通知摘要及actor kind/name/publicId；依事件類型辨別系統與本人，不只看signerId、不回寫audit；本人mapper排除note及他人通知資料。

- [x] T048 [US6] 在 `client/src/api/types/esignDocuments.ts` 與requests/queries同步欄位及note mutation，接 `client/src/features/esign-documents/DocumentDetailView.tsx` 的備註保存/清空/取消/失敗恢復、已拒頁籤與歷程；更新 `DocumentExportView.tsx` 簽署紀錄匯出的拒簽時間/原因，已拒不算已簽。

- [x] T049 [US6] 新增 `server/test/esign-signer-management.e2e-spec.ts` 驗證列表、歷程、本人資料裁切與note更新不改payload/PDF/hash；依 `specs/009-esign-document-delivery/quickstart.md` 核對畫面/匯出一致，記錄瀏覽器驗收而不宣稱client自動測試。

## Phase 9：整合與交付

所有故事完成後執行；只在有驗證證據時勾選。不得自動部署或提交正式資料。

- [ ] T050 在 `server/test/esign-document-delivery-security.e2e-spec.ts` 完成所有API的session/Origin/錯歸屬、資料裁切與重放檢查；確保匯出不查role、其他管理不擴權、外部cookie不能跨人下載，token/簽名不入log或DTO。

- [ ] T051 執行 `server/test/` 相關schema/e2e/security與service測試，驗舊資料升級、含新狀態down拒絕破壞證據及新舊worker交接；檢查 `server/src/infrastructure/database/schema.sql` 與entity/migration一致，記錄未能執行的環境限制，不將其當通過。

- [ ] T052 依 `specs/009-esign-document-delivery/quickstart.md` 執行server lint:check/test/build、client lint/build及root build/lint；重跑跨故事watermark/ZIP hash、拒簽結案/排除、催簽/備註隱私驗收，最終結果與performance報告連結寫入 `specs/009-esign-document-delivery/implementation-notes.md`。

- [ ] T053 更新 `specs/009-esign-document-delivery/quickstart.md`、`contracts/` 與 `implementation-notes.md` 的實際路徑/驗收結果/發布及回滾限制，逐項對照41條FR；分開列client/server/migration/config交付，不新增內部催簽、RBAC、補簽功能或自動部署。

## Dependencies & Execution Order

```text
Setup T001 → Foundation T002–T003
  → US1 T004–T009（MVP）
  → US2 T010–T014
  → US3 T015–T028
  → US4 T029–T035
  → US5 T036–T044
  → US6 T045–T049
  → 整合交付 T050–T053
```

以上為安全的預設循序順序；六個故事皆P1。US3不需等待US4才能以已簽fixture獨立驗收，US4完成後T035補拒簽匯出整合。US5以US4終態與本人資格為前置；US6整合依賴US4拒簽及US5通知DTO。US2以前述草稿選項串接完成為前置，server水印測試可獨立用固定payload。

同故事內按ID執行，標[P]者可在該故事前置完成後先準備測試；測試寫好不等於功能通過。T019與T020都依T018的storage port，彼此不同實作檔可並行；T021–T023等待storage/model可用。API共用檔、schema.sql、migration與worker maintenance等重疊檔案不可跨故事同時改，須序列整合。

## 每個故事的平行範例

| 故事 | 前置與可並行工作 |
|---|---|
| US1 | Foundation後，T004 service測試與T005 schema變更不同檔；T006 service須等兩者 |
| US2 | US1後，T010 PDF測試與T011字型/依賴準備不同檔；T012繪製待兩者完成 |
| US3 | T018後，T019 local storage與T020 S3 storage可並行；勿同時改port或lockfile |
| US4 | US3後，T029拒簽service測試與T030 entity/migration可並行；T031等兩者 |
| US5 | US4後，T036提醒service測試與T037通知schema可並行；T038等兩者 |
| US6 | US4/US5後，T045 mapper/note測試與T046 entity/note實作可在先完成測試介面約定後分工；同一service spec的修改由同一人持有 |

## Implementation Strategy

先完成Setup/Foundation及US1作最小可驗收交付，再依順序加入水印、匯出、拒簽、催簽、列表管理。各故事完畢先跑該範圍測試再繼續，不需每個小任務重跑全repo。MVP只是建議檢查點，不取消其餘五故事；未通過6000份容量驗收不可宣稱大量匯出已完成。role／permission、內部催簽與Spec007補簽本體不加入本清單。

## 覆蓋與驗收對照

| 故事 | FR | SC | 任務 |
|---|---|---|---|
| US1 | 001–005 | 001 | T004–T009 |
| US2 | 006–009 | 002–003 | T010–T014 |
| US3 | 010–021 | 004–008 | T015–T028 |
| US4 | 022–026 | 009–010 | T029–T035 |
| US5 | 027–034、041 | 011–012 | T036–T044 |
| US6 | 035–040 | 013–014 | T045–T049 |

合計53項：Setup/Foundation 3、US1 6、US2 5、US3 14、US4 7、US5 9、US6 5、整合4。checkbox 依實作驗證更新；未勾項目尚待其完整驗收，不因已有部分程式即算完成。
