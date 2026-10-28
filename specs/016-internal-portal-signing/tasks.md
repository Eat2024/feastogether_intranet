# Tasks：員工 Portal 登入、本人簽署與內部 BCC 通知

**輸入**：[spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、`contracts/`、[quickstart.md](quickstart.md)。

**分支**：電子簽 `feat/016-internal-portal-signing`（PR #34）；Portal 是獨立 repository。以下路徑相對電子簽 root，`../portal/` 指本機 Portal。已開始依正式 tickets 實作；核取方塊只標示已有證據的完成項目。

**測試依據**：spec 的授權、重送、狀態、群寄及完整旅程驗收，以及憲章 V 要求相應測試；先補能重現差異的測試再改實作。不新增 client 測試框架，不使用正式個資／文件，不把環境受限寫成通過。

**格式**：`- [ ] Tnnn [P?] [USn?] 描述與檔案路徑`。`[P]` 僅代表列明前置完成後可分開處理的不同檔案，不代表自動派代理或可並行修改同檔。

## Phase 1：Setup

- [x] T001 核對 `AGENTS.md`、`client/AGENTS.md`、`server/AGENTS.md`、`../portal/AGENTS.md` 與兩個 git 工作區；記錄分支、工具與測試前置到 `specs/016-internal-portal-signing/quickstart.md`，保留 Portal `index.php` 修改，後續 Portal 改動使用 develop 衍生分支或隔離 worktree，不重設既有工作。
- [x] T002 核對 `.specify/memory/constitution.md` 2.0.0 與 `specs/016-internal-portal-signing/contracts/`，確認本次包含內部 BCC、UAT／PRD 同導 Portal 正式機、無 Email 仍可簽署；以相鄰舊規格作歷史來源，Spec 014 跨分支衝突依 016，不引入另一功能程式。

## Phase 2：共用基礎

**前置**：T001–T002。完成後 US1／US2／US3 可分線開發，實際合併依下方依賴表。

- [ ] T003 新增 `server/src/features/esign/esign.constants.ts` 的單一固定 Portal 登入網址及內部 BCC 上限 50 常數，供 worker／舊入口使用；值為 `http://portal.feastogether.com.tw/portal/login?redirect_to=hr/esign/mine`，不新增環境變數、不改外部 origin，mail adapter 透過輸入接收網址以維持邊界。
- [ ] T004 在 `server/src/common/errors/app-error-code.ts`、`server/src/common/errors/app-errors.ts` 與 `client/src/api/errorCodes.ts` 定義 `ESIGN_INTERNAL_LOGIN_REQUIRED`（403）及繁體中文文案；錯誤 details 中的 `portalLoginUrl` 只能由 T003 固定值產生，不接受 caller 回跳 URL。

## Phase 3：US1 Portal 登入後自動到我的電子簽（P1）

**目標**：Email 帶 `redirect_to`，登入及必要改密碼完成後自動進 mine，保留原權限與一般登入。

**獨立驗收**：即使本人簽署 UI 尚未完成，仍能驗證 Portal 登入→既有我的電子簽列表；失敗重試／改密碼／已登入／無參數／惡意參數各有明確結果。對應 FR-002～003b、驗收 1／11／14。

- [ ] T005 [US1] 新增 `../portal/tests/esign-login-redirect.php` 可獨立執行的 PHP 測試 harness（不增套件），以 session/input stub 覆蓋清單允許值、缺參數、重複參數、陣列、外站、穿越、POST 保留、成功消費與改密碼待辦；注入測試專用第二頁映射，驗證不改 controller 即可回跳，移除映射後舊 session 失效；先確認現況不符契約的案例失敗。
- [ ] T006 [US1] 新增 `../portal/application/config/login_redirect.php` 集中允許映射與薄的 `../portal/application/libraries/Login_redirect.php` 共用處理，初始 `hr/esign/mine → hr/esign/mine`；修改 `../portal/application/controllers/Login.php` 在已登入分支前呼叫共用驗證，保存 `login_redirect_target`，取用時再次確認映射有效後 base_url。新 GET 無值／非法值清除，POST／失敗重試保留，無目標回原首頁；登入程式不硬編碼電子簽目的地。
- [ ] T007 [US1] 在 `../portal/application/controllers/Login.php` 設定 server 控制的 `login_password_change_pending`；需改預設密碼先走原頁，已登入再點 Email 仍先完成待辦，不用前端值判斷可否跳過。
- [ ] T008 [US1] 修改 `../portal/application/controllers/Account.php`：DB 改密碼成功才清待辦並透過共用 Login_redirect 消費目標，在原 `{status,msg}` 成功回應追加安全 `redirectTo`；錯誤保留目標及待辦，無目標沿原首頁，不增加頁面專用判斷。
- [ ] T009 [US1] 修改 `../portal/application/views/admin/account/modify_password.php` 成功分支使用 server 的 `redirectTo`，失敗不導頁；保留欄位、CSRF、既有密碼驗證及錯誤呈現。
- [ ] T010 [US1] 修改 `../portal/application/core/WebController.php` 共用 Logout，透過 Login_redirect 重設目的地並清除改密碼待辦；不新增自動記住任何原網址功能，核對 `../portal/application/controllers/hr/Esign.php` 原選單 gate 仍有效。
- [ ] T011 [US1] 執行 PHP harness、所有變更 PHP 的 `php -l` 及 Portal 瀏覽器驗收，將結果記入 `specs/016-internal-portal-signing/quickstart.md`；驗證 `../portal/template/js/hr/esign_webview.js` ready/navigate/launch、權限不足、帳號切換、cookie 故障與一般登入回歸，不改固定首頁 launch 協定。

## Phase 4：US2 以員工身分完成本人文件流程（P1）

**目標**：以正式員工 session 閱讀、同意、簽署／拒簽、查看結果與本人副本，不回 Email。

**獨立驗收**：合成員工 session 可直接操作本人任務，跨人／外部指派拒絕；重送只有一筆證據，已簽者下載本人副本。可不依賴 Portal UI 測 API，但完整旅程仍依 US1。對應 FR-004～008／011、驗收 2／3／5／6／7／9／10／13。

- [ ] T012 [P] [US2] 在 `server/src/features/esign/services/esign-signing.service.spec.ts`、`esign-rejection.service.spec.ts`（同目錄）補內部 principal、兩處重送、併發及驗證方式案例；保留外部回歸，驗證「`pending → signed` 或 `pending → rejected` 在交易鎖內完成」與「新 requestId 不可再次完成」。
- [ ] T013 [P] [US2] 新增 `server/test/internal-portal-signing.e2e-spec.ts`，加入 `server/test/jest-e2e.json` 及 `server/test/jest-e2e-security.json` 適用清單，先寫 401／404、本人 source/open/sign/reject/copy、狀態／期限／聲明／PNG／hash 竄改與去重案例；測試 DB 名稱須以 `feastogether_intranet_test` 開頭。
- [ ] T014 [US2] 修改 `server/src/features/esign/services/esign-signing-task.service.ts` 的 open/source，移除本人 OTP 阻擋並保留身分、草稿／刪除、期間與原檔完整性；POST 記開啟事件，GET 無寫入，列表仍只含本人資料。
- [ ] T015 [US2] 修改 `server/src/features/esign/services/esign-signing.service.ts` 的初始檢查、assertPrincipal、交易鎖內及兩個 repeated 分支；以本人 session 而非 invitation generation 授權，保留鎖定後的期間、欄位、PNG、source／payload hash 與唯一索引驗證。
- [ ] T016 [US2] 在 `server/src/features/esign/services/esign-signing.service.ts` 依 principal 寫 `authenticationMethod`：「新內部紀錄 `internal_session`，外部保留 `email_invitation`」；event ID 沿「`internal:<signerPublicId>:<requestId>`／`external:<signerPublicId>:<requestId>`」，不存 session token、不回填歷史 `esign_signature_records` 或 PDF／manifest。
- [ ] T017 [US2] 修改 `server/src/features/esign/services/esign-rejection.service.ts` 與 `esign-completion-access.service.ts` 的本人入口，保留 allowReject、本人已簽資格與 personalCopy 完整性；副本沿「`pending → processing → ready|failed`」，到期後本人可讀、不授權重簽。
- [ ] T018 [US2] 更新 `server/src/features/esign/controllers/signing-tasks.controller.ts` 契約／Swagger，保留 OriginGuard、首次 201／重送 200、PDF cache/frame headers；`SignatureSubmissionDto` 沿 requestId UUIDv4、accepted=true、1–200 筆簽名及每 PNG data URL 最長 400,000，拒簽 reason trim 後最多 200 code points，不新增身分輸入或單筆 GET。
- [ ] T019 [US2] 在 `client/src/api/endpoints.ts`、`types/signingTasks.ts`、`requests/signingTasks.ts`、`queries/signingTasks.ts` 及各 barrel／query-key/options 補本人 open/sign/reject 與原檔／副本 URL；沿同源 cookie、既有 GET 列表及 mutation 失敗規則。
- [ ] T020 [US2] 從 `client/src/features/external-signing/ExternalSignForm.tsx`、`taskForm.ts` 擷取實際重複的表單／轉換至 `client/src/features/my-signature/sign/SigningForm.tsx` 與 `signingTaskForm.ts`（新增）；共用現有 TermsStep、DocumentViewer、SignaturePadDialog、RejectDialog，內外容器各自注入提交 callback，不帶外部 cookie API 或 Email 文案進內部。
- [ ] T021 [US2] 改寫 `client/src/features/signing-tasks/SigningTaskView.tsx`：取代邀請信提示，進入 POST open、本人閱讀／同意／簽署／拒簽；換 signer 重置狀態、重試沿用 requestId、pending 防連點、401 提示 Portal 重登，不自動提交未完成簽名。
- [ ] T022 [US2] 在 `client/src/features/signing-tasks/SigningTaskView.tsx` 接完成結果、GET 列表副本輪詢及 completed-file 下載；ready/failed 停止輪詢，卸載清理，成功 invalidate 本人列表，保留公開驗證連結，不再要求回 Email，不用 POST open 輪詢。
- [ ] T023 [US2] 執行 T012／T013 與外部表單回歸，依 `specs/016-internal-portal-signing/quickstart.md` 記錄桌面／窄螢幕、鍵盤、session 失效、切換文件及副本流程；確認任一正式員工 session 同等授權，未實作 Spec 014 不宣稱測過。

## Phase 5：US3 內部 BCC 群寄與無 Email 員工（P1）

**目標**：內部同文件／批次以 BCC 一封多人，無 Email 保留指派，逐人通知結果可追蹤。

**獨立驗收**：測試 mail transport 捕捉 2／50 地址一次 send、51 地址兩次、6,000 地址 120 次（無失敗時），共用地址只投遞一次；部分受理不重寄已受理者；無 Email 發起／補簽成功。完整簽署依 US2，但通知可獨立驗收。對應 FR-001／012／013、驗收 8／12／14／15／16。

- [ ] T024 [P] [US3] 擴充 `server/src/infrastructure/mail/invitation-mail-sender.spec.ts` 及 `mail-delivery-outcome.spec.ts`，先驗證 BCC MIME／envelope 隱私、單次多地址、固定正式 Portal 連結、accepted/rejected/unknown、永久／暫時拒收與外部逐人／OTP 不變。
- [ ] T025 [P] [US3] 擴充 `server/test/internal-email-initiation.e2e-spec.ts`、`internal-email-capacity.e2e-spec.ts`、`esign-employee-email-checks.e2e-spec.ts`，驗證 mixed／全無信箱可發起、nullable 快照、身分無效及上游失敗仍阻擋；維持 6,000 人與每批 100 人查詢邊界，不把容量測試變成真實大量寄信。
- [ ] T026 [P] [US3] 擴充 `server/src/worker/esign/external-invitation.processor.spec.ts`、`esign-maintenance.processor.spec.ts`（同目錄），先寫群組租約、舊單 log 轉批次、部分失敗、SMTP 後落庫失敗、stale processing、併發與 supersede 測試。
- [ ] T027 [US3] 在 `server/src/infrastructure/mail/invitation-mail-sender.port.ts` 加 `sendInternalGroup`，輸入最多 50 個不同 BCC 地址、kind、文件資訊及可信固定 Portal URL，回逐地址結果；外部 send／sendOtp 保持單人契約，內部無 invitationToken。
- [ ] T028 [US3] 修改 `server/src/infrastructure/mail/invitation-mail-content.ts`、`smtp-invitation-mail-sender.service.ts`、`fake-invitation-mail-sender.service.ts` 及 `mail-delivery-outcome.ts`：一次 sendMail 多 BCC，To/CC 不放員工，MIME 不保留 BCC；解析受理與拒收，不以 Promise resolve 推定全成功，不記原始收件名單／憑證至 log。
- [ ] T029 [US3] 修改 `server/src/features/esign/services/esign-initiation.service.ts` 與 `esign-document-validation.service.ts`：內部「`email` 可以 NULL」，「`signerType=user` 必須有可信本機 `userId` 與員編快照」；缺信箱保留全部指派，外部仍需有效 Email，HR 故障不能當空值，既有快照不改寫。
- [ ] T030 [US3] 修改 `server/src/features/esign/services/esign-initiation.service.ts` 的 token／通知建立：內部新 `invitationTokenSha256/invitationTokenCiphertext/invitationExpiresAt`「保持 NULL」，可寄者 pending、無有效地址「`skipped`，reasonCode 使用既有 `RECIPIENT_UNAVAILABLE`」，不入寄信佇列；保留逐人 log，不新增 schema。
- [ ] T031 [US3] 修改 `server/src/features/esign/services/esign-reopening.service.ts`、`esign-reminder.service.ts`、`esign-reminder-policy.ts`，內部期間不依賴 invitation token；補簽同交易 supersede 舊通知、建立新批次，無 Email 仍可補簽，保留台北每日催簽限制及原有限重試，外部 token 世代照舊。
- [ ] T032 [US3] 在 `server/src/features/esign/repositories/notification.repository.ts` 加入同 document/batch 的群組候選與原子領取／finish 查詢；按 log id 穩定排序、地址去重並領取同地址全部合格 log，共用 lease／processingStartedAt，逐人 attemptCount；排除 delivered/unknown/skipped/未到期重試，統一鎖順序且 SMTP 不在交易內。
- [ ] T033 [US3] 修改 `server/src/features/esign/services/esign-job-producer.service.ts`、`server/src/features/esign/esign-queue.constants.ts` 與 `server/src/worker/esign/esign-maintenance.processor.ts`：沿現有 queue，內部 `{notificationBatchId}` 去重、外部 `{notificationLogId}`，維護候選不再要求內部 token；群組工作完成後確保剩餘 chunk 可繼續處理，不增 scheduler。
- [ ] T034 [US3] 修改 `server/src/worker/esign/external-invitation.processor.ts`，分流新 batch／歷史單 log 工作，內部同批合格地址一次 BCC（最多 50），外部仍逐人；批次中只有一位或重試剩一位可寄，不能為湊數加入未選取者，不能跨文件合併。
- [ ] T035 [US3] 完成 `server/src/worker/esign/external-invitation.processor.ts` 與 `server/src/worker/esign/esign-maintenance.processor.ts` 的逐地址 finish／恢復：accepted 映射該地址所有 log 為 delivered，暫時未寄出才重試，「內部每個 log 最多 3 次（含首次），採既有催簽的 30／60 秒退避」；永久拒收停止，未知與 stale processing 轉 unknown 不重寄；finish 匹配 lease，不覆寫 superseded／新批次。
- [ ] T036 [US3] 修改 `client/src/features/esign-documents/DocumentSignersEditor.tsx`、`DocumentEditView.tsx` 與 `notificationLabels.ts`：無 Email 只提示人資另行通知、不擋發起；身分／上游錯誤仍擋，通知歷史維持逐人結果，不把人次誤稱寄送封數，不新增 HR 通知介面。
- [ ] T037 [US3] 執行群寄、容量與 `server/test/esign-reminders.e2e-spec.ts` 回歸，將 1/2/50/51/6,000 地址、共用信箱、混合內外部、補簽競態、未知結果與兩環境相同 URL 的證據記入 `specs/016-internal-portal-signing/quickstart.md`；驗證未知結果沒有被 maintenance 再寄。

## Phase 6：US4 舊邀請切換與外部回歸（P1）

**前置**：US2／US3 涉及 signing/rejection/worker 的修改完成，避免同檔交錯。

**目標**：舊內部 token／OTP 不能繼續操作，員工仍可從本人列表使用既有指派；外部流程不受影響。

**獨立驗收**：預置舊內部邀請／cookie／queue 與歷史簽章，驗證引導、拒絕與資料不變；外部完整 OTP 及下載回歸。對應 FR-009～010／011、驗收 4／8／9／16。

- [ ] T038 [P] [US4] 擴充 `server/test/internal-email-signing.e2e-spec.ts`、`internal-email-copy.e2e-spec.ts`，使用明確建立的舊內部 token／cookie fixtures，驗證 open/source/sign/reject/copy／重送都不能靠 OTP；舊 pending 指派用 session 可簽，歷史證據 hash 不變。
- [ ] T039 [P] [US4] 擴充 `server/src/features/esign/services/external-access.service.spec.ts` 與 `esign-access-policy.service.spec.ts`（同目錄），測邀請 GET 無副作用、內部 token POST 303 固定 Portal、無效 token 原失效、外部 OTP／拒簽重送／期限後下載照舊。
- [ ] T040 [US4] 修改 `server/src/features/esign/services/esign-access-policy.service.ts`、`external-access.service.ts`、`external-access-credential.service.ts` 及 signing/rejection 的 external 分支，只允許 `signerType=email`；有效舊內部 cookie 回 T004 的 403 固定提示，原檔／副本回錯誤而非 HTML，token／cookie 不因持有就成為員工 session。
- [ ] T041 [US4] 修改 `server/src/features/esign/controllers/external-signature.controller.ts` 與 `server/src/features/esign/services/external-access.service.ts`：保留 GET 確認頁不查 DB／不寄碼，POST 可辨識的舊內部 token 303 到 T003，不建立外部 session、不回文件；外部驗證流程維持。
- [ ] T042 [US4] 修改 `client/src/features/external-signing/ExternalSigning.tsx` 與 `client/src/api/types/externalSigning.ts`（核對既有型別檔後就地擴充），處理 `ESIGN_INTERNAL_LOGIN_REQUIRED` 及固定 `portalLoginUrl` 按鈕，不自動提交，不把其他一般錯誤誤判成需 Portal 登入。
- [ ] T043 [US4] 執行 T038／T039 與 `server/test/security-core-esign-flow.e2e-spec.ts`、`esign-document-delivery-security.e2e-spec.ts`，確認外部逐人專屬信／OTP／副本完整性、舊內部 queue BCC 路徑、歷史證據不變，記錄至 `specs/016-internal-portal-signing/quickstart.md`。

## Phase 7：跨專案驗證與交付

**前置**：四個故事全部通過局部驗收。此階段不推定授權部署正式機。

- [ ] T044 依 `specs/016-internal-portal-signing/quickstart.md` 執行 server lint:check/test/build/e2e/security、client lint/build、root build/lint 及 Portal PHP 檢查；新增 suite 依 `server/test/jest-e2e.json`／`jest-e2e-security.json` 實際納入，失敗修復後重跑相關項目，不宣稱 client 有不存在的 test script。
- [ ] T045 依 `specs/016-internal-portal-signing/quickstart.md` 以合成資料驗收 Email→Portal 登入→本人簽署→副本與內部 BCC／外部逐人；記錄實際 iframe origin、資料環境及桌面／窄螢幕。UAT 通知連正式 Portal 不代表 UAT 文件會出現，沒有環境存取時記未驗收，不自行改正式配置或同步資料。
- [ ] T046 更新 `specs/016-internal-portal-signing/contracts/notifications-and-cutover.md` 的可執行交付紀錄：Portal 先行、舊 worker 停止／在途處理、新 HTTP/client/worker 協調切換、逐人 log 保留與安全回退；列明新增 Portal 版控回跳清單，無 migration／環境變數新增，實際上版待部署流程，不由 tasks 自動執行。
- [ ] T047 核對 `specs/016-internal-portal-signing/spec.md` 所有 FR／驗收對應完成證據，更新 `plan.md`、`quickstart.md` 及 `.scratch/016-internal-portal-signing/issues/01-plan-internal-portal-signing.md`；依 `.specify/memory/constitution.md` 審查 Sync Impact Report、只在提交前按治理規則移除，未驗收／未整合不得標 resolved，不自行建立遠端 Issue／PR 或推送。

## 依賴與平行安排

```text
T001–T002 → T003–T004
                   ├→ US1 T005–T011 ──────────────────┐
                   ├→ US2 T012–T023 ─┐                │
                   └→ US3 T024–T037 ─┴→ US4 T038–T043 ─┤
                                                      └→ T044–T047
```

- 各故事內未標 `[P]` 的任務依編號執行。T012/T013 可並行；T024/T025/T026 可並行；T038/T039 可並行。實作等待相關測試先建立並確認現況失敗。
- US1 的 PHP 工作可與 US2／US3 的電子簽工作並行；US2 與 US3 只有在檔案負責範圍分開且共用錯誤／常數基礎完成後才並行。
- US1 內範例：T008 Account 與 T010 Logout 在 T006/T007 的 session 契約已穩定後可分工，T009 等 T008；因預設編號順序較安全，未以 `[P]` 承諾無條件並行。
- US2 範例：T012 service tests 與 T013 HTTP tests；US3 範例：T024 SMTP tests、T025 發起 tests、T026 worker tests；US4 範例：T038 舊憑證 e2e 與 T039 policy tests。
- US4 的 shared service／external UI 變更等待 US2/US3 完成，T044–T047 必須等待所有故事，不將可平行理解為可分別上線。

## 覆蓋與交付策略

| 範圍 | Tasks | 驗收重點 |
| --- | --- | --- |
| Setup／基礎 | T001–T004 | 工作區、憲章、固定 URL、錯誤邊界 |
| US1（7） | T005–T011 | GET/POST、改密碼、登出、權限及自動到列表 |
| US2（12） | T012–T023 | 本人全流程、交易重送、證據及 UI |
| US3（14） | T024–T037 | BCC 群組、部分受理、恢復、無 Email、外部逐人 |
| US4（6） | T038–T043 | 舊 token/cookie/queue、外部回歸、歷史證據 |
| 跨專案（4） | T044–T047 | 完整驗收、部署交接、限制紀錄 |

合計 47 項。最小示範先完成 US1（登入直達列表），再以 US2 展示本人簽署；正式 CR 交付必須包含 US3 BCC 與 US4 舊入口隔離，不能以示範完成取代安全切換。無 Email 的人資通知方式、Spec 014 實作與跨環境同步不在 tasks 範圍。

每項完成後才勾選並追加驗證證據；若依賴環境無法驗收則保留未完成與原因。本 tasks 不建立 GitHub Issues，不代表已修改任何應用程式。
