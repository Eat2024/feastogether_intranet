# Tasks: 內部員工 Email 邀請與 OTP 簽署

**Input**: [spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/employee-email-api.md](contracts/employee-email-api.md)、[contracts/signing-notifications-api.md](contracts/signing-notifications-api.md)、[contracts/frontend-handoff.md](contracts/frontend-handoff.md)、[quickstart.md](quickstart.md)。

**Status**: 任務已產生，全部未執行。本文件不代表程式、migration 或測試已完成。

**Scope**: 僅 server、必要 schema migration 與串接文件。不修改 client、不部署、不建立 GitHub Issues，不自行刪除資料或回填歷史簽署證據。

**Tests**: 依規格 SC-001～008、plan 驗證要求及憲章 V，納入來源、交易、授權、migration、worker 與整合測試。優先建立對應測試以重現未支援行為，實作後再驗證通過；不要求無關重構或全面採用新測試框架。

## Format 與執行規則

- 任務格式為 `- [ ] TNNN [P?] [USn?] 描述與檔案路徑`，路徑相對 repository root。
- `[P]` 表示在共同前置任務完成後，可與同節其他標記任務平行；不代表可以忽略依賴或同時修改相同檔案。
- 標為「新增」的路徑是實作目標，現在不存在亦正常。migration 檔名以下一個無衝突 timestamp 為準；此清單指定 `1792540800000-InternalEmailSigning.ts`，若實作時已被使用，只調整檔名與對應引用。
- 完成任務才能勾選；來源不可用或整合測試未執行時保留未完成並記錄原因，不以 mock 通過代替實際 MySQL／Redis 驗證。

## Phase 1: Setup — 驗證前置與合成資料

**目的**：沿用現有專案，不重建依賴、框架或環境。

- [ ] T001 核對 root／server AGENTS.md、憲章 1.5.0、現有 migration 次序與測試隔離設定，將使用的 Node／pnpm、隔離 MySQL／Redis 可用性及基準狀態記錄於 `specs/010-internal-email-signing/quickstart.md`；不讀出 secret、不新增環境變數、不對開發資料庫執行清庫或 rollback。
- [ ] T002 在新增 `server/test/internal-email-signing.helper.ts` 建立沿用既有 e2e harness 的合成員工／文件、HR 回應及 mailer 捕捉輔助，支援取邀請／OTP但不輸出秘密，區分員工 session 與 Email cookie；測試 DB 名稱必須以 `feastogether_intranet_test` 開頭，不建立新的測試基礎框架。（依賴 T001）

## Phase 2: Foundational — Schema 與共用錯誤

**目的**：先解除資料層的內部 email 禁止及全體 email 唯一限制，建立所有故事共用的錯誤契約。

- [ ] T003 [P] 在 `server/test/schema-constraints.e2e-spec.ts`、`server/test/schema-migration.e2e-spec.ts` 加入 signer 新約束驗證：兩位 user 同 email 可保存、user 與 email signer 同地址可共存、兩位 email signer 重複仍拒絕、舊 user NULL 地址可保留；驗證隔離庫 up→down→up、有新內部 email／邀請時 down 在 DDL 前拒絕且資料不變。（依賴 T002）
- [ ] T004 [P] 在 `server/src/common/errors/app-error-code.ts`、`server/src/common/errors/app-errors.ts` 定義契約的五個 EMPLOYEE 錯誤、403 `ESIGN_EMAIL_OTP_REQUIRED` 與409 `ESIGN_REOPEN_RECIPIENT_UNAVAILABLE`；繁體中文訊息及 details 僅含允許的 userIds／signerPublicIds，不含 email、員編或上游 body。（依賴 T002）
- [ ] T005 修改 `server/src/features/esign/entities/esign-signer.entity.ts`，新增 `server/src/infrastructure/database/migrations/1792540800000-InternalEmailSigning.ts` 並同步 `server/src/infrastructure/database/schema.sql`：email「沿用 VARCHAR(255) nullable」；external_email 為「新增 nullable VARCHAR(255) STORED generated column：CASE WHEN signer_type='email' THEN email ELSE NULL END」，沿用 charset／collation、不進 DTO、snapshot、一般寫入；identity 的 user 分支保留 user_id／empid_snapshot 非 NULL，外部分支保留兩者 NULL 與 email 非 NULL。以 document_id,external_email unique 取代全體 email unique，保留 user unique、token digest unique及既有終態／副本約束；無資料回填。up 先補新唯一性再移除舊限制；down 先檢查不相容資料並拒絕，不清除欄位內容。（依賴 T003）
- [ ] T006 在隔離 MySQL 執行 T003 的 schema／migration 測試，核對 TypeORM generated 欄位與實際 metadata、DDL 順序及失敗後狀態，將結果記入 `specs/010-internal-email-signing/quickstart.md`；不得使用一般開發資料庫的 migration:revert。（依賴 T004、T005）

**Checkpoint**：Schema 與錯誤契約可供後續故事使用；應用程式尚未支援完整內部 Email 流程。

## Phase 3: US1 — 選取員工並確認可寄送邀請（P1）

**目標**：已選員編可取得本機 userId、查看信箱狀態；草稿可缺信箱，發起必須全部核對成功。

**獨立驗收**：使用合成組織與來源，經 HTTP 解析員工、暫存、預覽、發起；缺漏／來源失敗保持草稿且無通知，成功地址與發起快照逐人一致。不依賴前端畫面或實際 SMTP。

### Tests

- [ ] T007 [P] [US1] 在 `server/src/infrastructure/http-client/feastogether/feastogether.client.spec.ts`、`server/src/infrastructure/http-client/feastogether/services/feastogether-hr.service.spec.ts` 測試 staff_emails 成功 envelope、稀疏／空回應、前導零、空白／不合法 email、錯誤型別、重複／請求外員編、401／403／逾時與日誌不含 request／response body。（依賴 T006）
- [ ] T008 [P] [US1] 在 `server/src/features/esign/services/esign-signer-candidate.service.spec.ts` 與新增 `server/test/internal-email-candidates.e2e-spec.ts` 測試 POST 解析、本機命中、HR精確比對、並發建帳唯一、停用不恢復、非5–8碼且本機不存在時 unavailable、GET 不寫帳號、未登入／錯誤 Origin 不呼叫上游。（依賴 T006）
- [ ] T009 [P] [US1] 在新增 `server/src/features/esign/services/esign-employee-email.service.spec.ts` 與既有 `server/src/features/esign/services/esign-initiation.service.spec.ts` 測試預覽不保存、發起重查、缺地址422、來源失敗502、身分映射異動409、同信箱逐人映射、零內部人員不查 HR、失敗不留下部分 active／通知／稽核及 hash 包含固定地址。（依賴 T006）

### Implementation

- [ ] T010 [US1] 新增 `server/src/infrastructure/http-client/feastogether/types/staff-email.dto.ts` runtime parser，擴充 `server/src/infrastructure/http-client/feastogether/services/feastogether-hr.service.ts` 與 `server/src/infrastructure/http-client/feastogether/feastogether.client.ts`：固定 POST staff_emails、1–100 個最多20碼 ASCII英數員編、成功 envelope 嚴格驗證；缺漏／不合法地址為 unavailable，結構錯誤／重複／額外員編為502；request／unwrap兩處省略敏感 body，使用既有 API Key、不傳員工 Bearer。（依賴 T007）
- [ ] T011 [US1] 擴充 `server/src/features/esign/services/esign-signer-candidate.service.ts` 與 `server/src/features/users/repositories/user.repository.ts`：只解析已選員編，批讀本機、缺者有限併發沿用 HR lookup 的精確比對與建帳；停用／刪除不恢復、並發唯一處理不重複建帳，來源失敗502但已建帳可保留；既有 list 改純讀本機，org-chart 7,200秒快取及無建帳行為不變。（依賴 T008）
- [ ] T012 [US1] 在新增 `server/src/features/esign/dto/signer-candidate-resolution.dto.ts`、既有 `server/src/features/esign/controllers/signer-candidates.controller.ts` 接上 POST resolutions：employeeNos「1–100 個、每個 1–20 碼 ASCII 英數字串」，去重保序，回200 items的 resolved／unavailable 與 nullable userId／name／department／title，不回email；session＋OriginGuard、Swagger與GET唯讀說明同步。（依賴 T011）
- [ ] T013 [US1] 新增 `server/src/features/esign/services/esign-employee-email.service.ts`，以 userId→完整員編核對T010來源：每批100、最多4批併發、單批10秒逾時，失敗停止派新批並收束已派請求，不新增重試、email cache、fallback或queue；以員編Map而非位置對應，狀態「ready／unavailable」，結果僅在request記憶體。（依賴 T009、T010）
- [ ] T014 [US1] 在新增 `server/src/features/esign/dto/employee-email-check.dto.ts`、既有 `server/src/features/esign/controllers/documents.controller.ts`、`server/src/features/esign/esign.module.ts` 接上 POST employee-email-checks 與服務注入：userIds「1–6,000 個正整數字串」且安全整數，先驗草稿建立人，回200 items僅userId／status／maskedEmail（unavailable時null）及private,no-store；404／409／422／502依契約，不更新草稿／帳號或寄信。（依賴 T013）
- [ ] T015 [US1] 調整 `server/src/features/esign/dto/signer.dto.ts`、`server/src/features/esign/services/esign-signer.service.ts` 及對應 spec 測試，維持草稿可無email與內部user身分，拒絕type=user攜帶可覆寫地址等不允許輸入；預覽資料不得成為可信來源，同信箱不同員工不新增檢查／警告／去重，外部既有正規化去重保留。（依賴 T012、T014）
- [ ] T016 [US1] 修改 `server/src/features/esign/services/esign-initiation.service.ts`：上游核對在文件交易外，交易內再鎖草稿、重驗同份request帳號有效與userId→empid，套入固定email後才建schemaVersion 2 snapshot/hash；維持完整名單／欄位取代語意，不新增revision。任一失敗整次不寫入；所有指派各建邀請與invitation log，使用既有 invitationGenerationSha256，同交易保存，提交後入列。（依賴 T015）
- [ ] T017 [US1] 新增 `server/test/internal-email-initiation.e2e-spec.ts`，串起T012／T014／T016並驗證授權、草稿缺信箱可存、偽造地址被拒、混合名單、同地址逐人token／log、交易回滾、身分變動及發起回應遺失後查詳情可確認active；測試來源查詢不持文件長鎖。（依賴 T016）
- [ ] T018 [US1] 在新增 `server/test/internal-email-scale.e2e-spec.ts` 驗證1／100／101／6,000位合成人員的解析與信箱核對、60批上限100及併發≤4、部分失敗不發起；執行 `server/test/org-chart.e2e-spec.ts` 確認兩小時快取回歸，將量測耗時／記憶體及請求／代理期限風險記入 `specs/010-internal-email-signing/quickstart.md`，不自行新增背景發起。（依賴 T017）

**Checkpoint**：US1 可獨立驗證名單與發起原子性；此時尚不可宣稱內部收信後已能完成簽署。

## Phase 4: US2 — Email 邀請、OTP 與簽署／拒簽（P1）

**目標**：內部員工無須一般登入即可由邀請完成OTP並簽署／拒簽；內部session不可繞過。

**獨立驗收**：以US1發起的文件或合成已發起fixture，捕捉邀請／OTP、經HTTP取得cookie並簽署；只持連結、員工session、錯人或過期憑證皆無法提交。

### Tests

- [ ] T019 [P] [US2] 在 `server/src/features/esign/services/external-access.service.spec.ts`、`server/src/features/esign/services/external-otp.service.spec.ts`、`server/src/features/esign/services/external-access-credential.service.spec.ts` 覆蓋user指派的基本邀請完整性、GET無寄碼／存取、OTP「6 位、10 分鐘、錯 5 次、60 秒冷卻、每小時 5 封」、新碼使舊碼失效、並發一次消耗、credential「8 小時期限」、同email不同signerId隔離及寄信失敗。（依賴 T018）
- [ ] T020 [P] [US2] 在 `server/src/features/esign/services/esign-signing.service.spec.ts`、`server/src/features/esign/services/esign-rejection.service.spec.ts` 及新增 `server/test/internal-email-signing-security.e2e-spec.ts` 覆蓋internal principal首次／重送均拒絕、五個舊個人入口本人403／他人404／未登入401、頁面與cookie錯位409、偽造世代、Origin失敗與管理人原權限保留。（依賴 T018）

### Implementation

- [ ] T021 [US2] 擴充 `server/src/features/esign/services/esign-access-policy.service.ts`、`server/src/features/esign/services/external-access.service.ts`：user／email皆可用Email通道，但須具固定有效email、邀請世代與正確文件關聯；signed／rejected僅略過期限；沿用獨立credential與現有cookie，不由employee session換發Email principal。（依賴 T019）
- [ ] T022 [US2] 修改 `server/src/features/esign/services/esign-signing.service.ts`、`server/src/features/esign/services/esign-rejection.service.ts`，在首次及重送授權路徑拒絕internal principal；經Email驗證的user指派保留userId／type與快照、以email_invitation記錄驗證方法；保留欄位完整性、條款版本、requestId寬等、pending→signed／rejected終態規則，不改歷史證據。（依賴 T020、T021）
- [ ] T023 [US2] 修改 `server/src/features/esign/controllers/signing-tasks.controller.ts`、`server/src/features/esign/services/esign-signing-task.service.ts`、`server/src/features/esign/services/esign-completion-access.service.ts`：舊open／source／sign／reject／completed-file先驗本人再403 OTP_REQUIRED；未登入401、他人404，連service直接呼叫亦受限；metadata列表、creator讀檔／下載／匯出維持原授權，不保留舊文件免OTP。（依賴 T022）
- [ ] T024 [US2] 在 `server/src/features/esign/services/esign-view.mapper.ts`、`server/src/features/esign/services/external-access.service.ts` 裁切Email task的userId與建立人資料，employeeNo／department／title回null，保留必要本人資料、type與副本狀態；建立人詳情不套用這份裁切，並在對應service測試驗證無其他人或管理note洩漏。（依賴 T021、T023）
- [ ] T025 [US2] 擴充 `server/src/worker/esign/external-invitation.processor.ts` 與其測試，支援所有具固定地址／邀請的指派，逐signer寄送；claim／完成／失敗回寫比對T016的generation，禁止未claim舊log再寄或舊結果清除新密文。沿用原retry／unknown／持久通知補償，不跨SMTP持有DB交易；已在途舊信允許送達但其連結失效。（依賴 T016、T024）
- [ ] T026 [US2] 修改 `server/src/features/esign/services/esign-document-query.service.ts`，初次邀請對user／email皆呈現invitationDelivery，依目前世代／最新有效invitation log對應寄送結果；確認寄送失敗不撤銷active，回應不帶原始token／密文。（依賴 T025）
- [ ] T027 [US2] 在 `server/src/features/esign/controllers/external-signature.controller.ts` 與既有DTO／Swagger說明標示兩種類型共用external路徑；保留HTML form token／code、200／303／400／401／409／429／503、cookie名稱／Path及OTP前遮罩；簽署沿用signerPublicId與requestId UUIDv4、consentVersion 1–50、accepted=true、signatures 1–200、PNG字串上限400,000，拒簽reason trim最多200且null非省略。（依賴 T026）
- [ ] T028 [US2] 新增 `server/test/internal-email-signing.e2e-spec.ts` 並執行T019／T020案例，完成混合名單「邀請→OTP→task/source→簽署／拒簽」HTTP驗收、未來開始不寄碼、到期／停止／刪除拒絕、同requestId重送及僅有連結／employee session不可操作；不以成功送出PDF產製工作宣稱本人副本已完成。（依賴 T027）

**Checkpoint**：Email邀請與OTP簽署可用，所有舊內部免OTP入口均封閉；尚須US3確認留存副本。

## Phase 5: US3 — 簽署後留存本人副本（P1）

**目標**：簽署後及日後重新OTP均能取得本人副本，不受簽署期限／停止影響，不可取得他人資料。

**獨立驗收**：合成已簽user指派配合真實測試產物，驗證產製狀態、重新OTP、本人下載與建立人下載bytes一致、跨人拒絕。

- [ ] T029 [P] [US3] 在 `server/src/features/esign/services/external-access.service.spec.ts` 補user已簽／已拒／刪除與文件停止／到期／完成案例，驗證已簽仍須有效OTP credential、世代基本驗證不可略過；既有 `server/src/features/esign/services/external-access-credential.service.spec.ts` 驗證8小時失效後不可沿用。（依賴 T028）
- [ ] T030 [P] [US3] 在 `server/src/features/esign/services/esign-completion-access.service.spec.ts` 與新增 `server/test/internal-email-copy.e2e-spec.ts` 覆蓋completion「pending／processing／ready／failed」、未就緒409、未簽／已拒不可下載、損壞產物不可提供、同一人與建立人PDF bytes一致、跨人／跨文件拒絕及舊證據hash不變。（依賴 T028）
- [ ] T031 [US3] 依T029／T030調整 `server/src/features/esign/services/external-access.service.ts`、`server/src/features/esign/services/esign-completion-access.service.ts`、`server/src/features/esign/controllers/external-signature.controller.ts` 的本人結果／原檔／副本授權及回應，沿用既有產製、完整性檢查、GET唯讀與private,no-store；簽署成功不清cookie、已簽者不可重簽，不新增產物或期限。（依賴 T029、T030）
- [ ] T032 [US3] 執行 `server/test/internal-email-copy.e2e-spec.ts`，以測試worker完成產物後經HTTP下載，再以新瀏覽器cookie流程重新OTP下載；確認期限後／停止後仍可留存、刪除後拒絕，將後端結果與尚待前端輪詢／手機驗收的界線記入 `specs/010-internal-email-signing/quickstart.md`。（依賴 T031）

**Checkpoint**：US1＋US2＋US3形成可驗收的後端最小簽署閉環，不代表已交付前端畫面。

## Phase 6: US4 — 內部催簽與補簽通知（P2）

**目標**：混合名單可人工催簽，補簽以原固定地址自動寄送新邀請，已簽副本存取不受影響。

**獨立驗收**：合成pending／signed／rejected內外部名單執行selected／all_pending及補簽，核對逐人結果、台北每日限額、世代輪替與worker競態。

- [ ] T033 [P] [US4] 在 `server/src/features/esign/services/esign-reminder-policy.spec.ts`、`server/test/esign-reminders.e2e-spec.ts` 測試內外部selected／all_pending、同email逐人、同requestId重送／異payload衝突、台北午夜重置、pending／processing／待重試／unknown額度與已簽／已拒略過；OTP額度獨立。（依賴 T032）
- [ ] T034 [P] [US4] 在 `server/src/features/esign/services/esign-reopening.service.spec.ts` 與新增 `server/test/internal-email-reopening.e2e-spec.ts` 建立補簽用例：缺固定信箱／世代整次409、固定地址不查HR、只輪替pending、舊token／cookie失效、signed原邀請仍可下載、舊未claim job不可寄、在途SMTP舊結果不可覆寫新通知／密文。（依賴 T032）
- [ ] T035 [US4] 修改 `server/src/features/esign/services/esign-reminder-policy.ts`、`server/src/features/esign/services/esign-reminder.service.ts` 及 `server/src/features/esign/controllers/notification-batches.controller.ts`，移除內部未支援限制、all_pending納入user；依signerId而非email計額度及通知，沿用selected最多6,000、kind與所有狀態、202及既有cursor／limit 1–100契約，無合格者仍回既有details.items。（依賴 T033）
- [ ] T036 [US4] 修改 `server/src/features/esign/services/esign-reopening.service.ts`、`server/src/features/esign/repositories/notification.repository.ts`，補簽在鎖定後先驗所有pending固定地址／邀請，缺者409列signerPublicIds且無寫入；依原expectedSignEndAt／新期限與reason trim 1–500規則，原子作廢舊未完成通知、輪替pending、建帶generation的invitation batch/log並提交後入列；不查HR、不變原payload及signed／rejected世代。（依賴 T034、T035）
- [ ] T037 [US4] 在 `server/src/worker/esign/external-invitation.processor.spec.ts` 擴充補簽並發驗證，配合 `server/src/worker/esign/external-invitation.processor.ts` 修正任何T025未覆蓋的claim／finish／fail世代核對；證明在途舊信即使送達也失效、舊結果不能覆寫新通知／清新密文，沿用文件→通知→簽署人鎖序且不跨SMTP持鎖。（依賴 T036）
- [ ] T038 [US4] 修改 `server/src/features/esign/services/esign-document-query.service.ts` 與 `server/src/features/esign/controllers/documents.controller.ts`，補簽後顯示最新有效invitation寄送狀態；reopening-invitations納入內部pending、正常略過寄送後清除密文項目／全部送完回[]，仍有密文卻損壞回503；不保留永久密文、不把此清單當待簽總表，補上對應查詢測試。（依賴 T037）
- [ ] T039 [US4] 執行 `server/test/esign-reminders.e2e-spec.ts`、`server/test/internal-email-reopening.e2e-spec.ts`，驗證SMTP失敗保留已補簽狀態、重送不重複批次、補簽前後下載與授權不變、混合名單結果完整且既有外部催簽回歸通過；記錄於 `specs/010-internal-email-signing/quickstart.md`。（依賴 T038）

## Phase 7: Polish — 跨故事驗證與交接

**目的**：核對全部FR、實際契約及前端未實作界線，不增加新功能。

- [ ] T040 核對 `server/src/infrastructure/logging/httpEndpointLog/http-access-logger.service.ts`、`server/src/infrastructure/logging/logHelper/logger.config.ts`、`server/src/infrastructure/http-client/feastogether/feastogether.client.ts` 與對應測試，確保新增POST／錯誤／邀請路徑的access log、application log、audit metadata不含員編清單、email、OTP、token、cookie或簽名；僅在發現缺口時做本需求所需修正，不新增logging框架。（依賴 T039）
- [ ] T041 [P] 在 `server/test/core-esign-flow.e2e-spec.ts`、`server/test/security-core-esign-flow.e2e-spec.ts`、`server/test/esign-rejection.e2e-spec.ts`、`server/test/api-coverage.e2e-spec.ts` 更新受影響的舊內部免OTP成功假設，保留對應拒絕驗證並改用Email流程覆蓋成功情境；檢查新測試被 `server/test/jest-e2e.json`／`server/test/jest-e2e-security.json` 收錄，不刪除或跳過安全案例，驗證外部流程與歷史證據不變。（依賴 T040）
- [ ] T042 [P] 依實作核對Swagger與 `specs/010-internal-email-signing/contracts/employee-email-api.md`、`specs/010-internal-email-signing/contracts/signing-notifications-api.md`、`specs/010-internal-email-signing/contracts/frontend-handoff.md`，記錄實際路徑、status／error／details、cookie與HTML表單、GET改唯讀、舊個人入口403、補簽自動寄信及空清單語意；只有已驗證API才能改標已交付，client仍不修改。（依賴 T040）
- [ ] T043 依 `specs/010-internal-email-signing/quickstart.md` 執行server lint:check、unit、build、test:schema、test:e2e、test:e2e:security與容量案例，記錄實際命令／結果及無法執行的風險；檢查 `server/src/infrastructure/database/schema.sql`、entity與migration一致，確認無新表／依賴／env／排程或非本需求client差異，不為檢查而執行修正型lint。（依賴 T041、T042）
- [ ] T044 依FR／SC對照表完成最終檢核，更新 `specs/010-internal-email-signing/spec.md`、`specs/010-internal-email-signing/checklists/requirements.md`、`specs/010-internal-email-signing/quickstart.md` 與本 `specs/010-internal-email-signing/tasks.md` 的真實交付狀態；摘要分列後端、migration、config無新增、前端未實作及未驗證限制，不建立commit／PR／部署作為隱含任務。（依賴 T043）

## Dependencies & Execution Order

```text
Setup T001–T002
  → Foundation T003–T006
  → US1 T007–T018
  → US2 T019–T028
  → US3 T029–T032
  → US4 T033–T039
  → Polish T040–T044
```

故事本身有業務依賴，不能為形式上的獨立性假裝全部可同時交付。各故事的測試可透過合成前置資料獨立重現，但完整交付須依上述順序整合。

- T003與T004可平行；T005依賴T003，T006須待T004／T005。
- US1：T007→T010（上游）；T008→T011→T012（身分）；T009＋T010→T013→T014（信箱）；T012＋T014→T015→T016→T017→T018。T010／T011同時進行時須分別持有HR service與candidate檔案，不同時改同一檔。
- US2：T019／T020可平行；T021→T022→T023→T024→T025→T026→T027→T028。T022也依賴T020；worker與發起log generation須在同一整合版本相容。
- US3：T029／T030可平行，完成後T031→T032。
- US4：T033／T034可平行，T035完成後T036→T037→T038→T039；T036同時依賴T034。
- Final：T040後T041／T042可平行，兩者完成後T043→T044。跑同一MySQL／Redis測試資源時必須序列執行或使用既有隔離機制，文件的[P]不代表允許共用測試庫併發清理。

## Parallel Examples

| 故事 | 可平行工作（共同前置已完成） | 合流點 |
| --- | --- | --- |
| US1 | T007上游測試、T008身分解析測試、T009信箱／交易測試，分屬不同檔案 | 各自實作後於T015合流 |
| US2 | T019 OTP／存取測試、T020簽署／舊入口安全測試 | T022需要兩者 |
| US3 | T029存取與過期測試、T030副本完整性與HTTP測試 | T031 |
| US4 | T033催簽政策測試、T034補簽世代測試 | T036 |

這是後續工作可平行的說明，並非本次已啟動實作或授權自動派出多個agent。

## FR／SC Traceability

| 規格 | 主要任務 |
| --- | --- |
| FR-001～003；SC-001 | T007～T014、T018 |
| FR-004～005；SC-002 | T003～T006、T009、T015～T018 |
| FR-006；SC-003 | T016、T025～T028 |
| FR-007～010；SC-004 | T019～T021、T024、T027～T029 |
| FR-011～012；SC-004、SC-007 | T020、T022～T023、T028、T041 |
| FR-013；SC-003、SC-005 | T029～T032 |
| FR-014；SC-006 | T025、T033～T039 |
| FR-015～016；SC-007 | T004、T007～T014、T024、T026、T038、T040 |
| FR-017；SC-007 | T003～T006、T020、T022～T023、T030、T034、T041 |
| FR-018；SC-008 | T042～T044 |

## Implementation Strategy

1. 先完成Setup與Foundation，特別確認schema rollback不毀資料。
2. US1是最早可獨立展示的「選人／信箱準備」增量；只完成US1不能稱為內部Email簽署已完成。
3. 建議後端MVP為US1＋US2＋US3：名單、發起、邀請、OTP、簽署與本人留存形成閉環；所有舊免OTP入口需同步封閉，不分開部署。此次未要求部署。
4. 接上US4完成已核准的催簽／補簽範圍，再跑跨故事回歸與交接。MVP不是允許省略US4的交付。
5. 前端只接收contracts／交接文件，桌面／手機畫面驗收不在本次後端完成宣告內。

## 任務統計與生成檢查

總計44項：Setup 2、Foundation 4、US1 12、US2 10、US3 4、US4 7、Polish 5。全部為未完成checkbox，任務ID連續，故事任務皆有US標籤與明確目標路徑；依賴與共享檔案合流點列於上方。

生成時 `.specify/extensions.yml` 不存在，無 before_tasks／after_tasks hooks。此次僅產生任務與同步規劃文件狀態，不執行以上實作任務。
