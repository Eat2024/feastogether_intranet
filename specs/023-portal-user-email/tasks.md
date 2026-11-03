# Tasks: Portal 員工資料匯入與本機發起查核

依據：[spec](spec.md)、[plan](plan.md)、[data-model](data-model.md)、[contracts](contracts/local-directory.md)。勾選依實際實作與驗證更新；PR #45 與人工首次匯入僅為前置。Spec 明確要求對交易／權限／資料完整性進行自動化驗證。

## Phase 1: Setup

已完成 migration 不重做；核對並建立合成驗收基準。

- [x] T001 核對 PR #45 的 email 欄位及既有首次匯入摘要，於 specs/023-portal-user-email/quickstart.md 記錄前置證據；不複製真實員工資料或另建 migration。

## Phase 2: Foundational

建立用途限定的讀取介面與隱私測試；阻擋後續 stories。

- [x] T002 在 server/src/features/users/repositories/user.repository.ts 增加顯式 email 批次讀取與依 id 升冪鎖定方法（每批最多 500），包含軟刪除供呼叫端判斷；一般查詢仍不選 email。
- [x] T003 在 server/test/portal-user-import.e2e-spec.ts 新增合成 users fixture 與 repository 驗證，涵蓋精確員編／部門、select:false、unicode_ci／0900_bin 及鎖順序；保留 feastogether_intranet_test DB 名稱保護。

## Phase 3: US1 完整主檔匯入（P1／工具 MVP）

獨立驗收：5,001 人預覽／apply 分類一致，非法資料先擋下，不寄信。

- [x] T004 [US1] 在 server/src/maintenance/portal-users.spec.ts 新增七欄 HEX TSV、SQL NULL、非法 UTF-8／hex、缺欄位、空檔、前導零／大小寫衝突與相同重複列的解析驗證。
- [x] T005 [US1] 在 server/src/maintenance/portal-users.ts 實作 preview 與參數化匯入規劃：員編必填 1–20 ASCII 英數（DB32）、姓名必填最多100、部門代碼最多50／名稱150、職稱100、email trim小寫最多255且非空須合法；optional 空值為NULL，email非唯一；0→試用、1→正式，其他來源略過並計數。
- [x] T006 [US1] 在 server/src/maintenance/portal-users.ts 實作 apply：綁來源hash／目標DB／原值，先保存0600備份再鎖定確認、全有或全無，衝突停止；新增帳號啟用，停用／軟刪除整筆保護；不改既有ID、empid、department_id、登入紀錄。
- [x] T007 [US1] 在 server/test/portal-user-import.e2e-spec.ts 驗證5,001人新增／更新／保護／不合格分類、空email清除、同信箱不合併、write中途失敗無部分提交。

## Phase 4: US2 本機解析與發起（P1）

獨立驗收：已有合成主檔、有效session與選人資料，HR lookup/emails禁止呼叫，仍完整解析及發起。

- [x] T008 [P] [US2] 在 server/src/features/esign/services/esign-signer-candidate.service.spec.ts 與 server/test/esign-candidate-resolution.e2e-spec.ts 驗證本機查無／停用 unavailable、不寫 users、不呼叫HR、順序去重、每次100與payload無email。
- [x] T009 [US2] 在 server/src/features/esign/services/esign-signer-candidate.service.ts 移除 importStaff／HR補查；保留 getOrgChart 與Redis契約，DB故障明確拋ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE。
- [x] T010 [P] [US2] 在 client/src/features/esign-documents/DocumentSignersEditor.tsx 與 client/src/api/types/esignDocuments.ts 更新 unavailable 同步提示與註解；維持每批100、任一不可用阻止整份發起、不新增email payload。
- [x] T011 [US2] 在 server/src/features/esign/services/esign-employee-email.service.ts 與 esign-initiation.service.ts 切換批次本機email；交易內先依ID鎖發起者／內部員工、再鎖文件重驗權限；email／資格／身分快照使用同一manager，缺email保持可指派，DB錯誤不能轉null。
- [x] T012 [US2] 在 server/src/features/esign/services/esign-signer.service.ts 確保發起建立的員編／姓名／部門／職稱快照來自T011同一組已鎖定資料；不改外部Email指派與草稿一般儲存契約。
- [x] T013 [US2] 在 server/src/common/errors/app-errors.ts、server/src/features/esign/dto/employee-directory-response.dto.ts、server/src/features/esign/controllers/signer-candidates.controller.ts 及 client/src/api/errorCodes.ts 同步本機來源文案，保留既有422／409／502錯誤碼及HTTP形狀，不新增路由。
- [x] T014 [US2] 在 server/src/features/esign/services/esign-initiation.service.spec.ts、server/test/internal-email-initiation.e2e-spec.ts 與 server/test/internal-email-capacity.e2e-spec.ts 驗證5001人、無email skipped、惡意client email、HR零呼叫及並行email／狀態更新無混用快照；交易失敗無部分通知。

## Phase 5: US3 本機寄送白名單（P1）

獨立驗收：以合成users／規則呼叫policy，測允許／拒絕／故障並保持固定收件目標。

- [x] T015 [US3] 在 server/src/infrastructure/mail/mail-recipient-policy.service.spec.ts 增加本機員編／直接部門／email聯集、共享信箱、子部門拒絕、停用／缺信箱及DB故障整次check-failed測試。
- [x] T016 [US3] 在 server/src/features/users/repositories/user.repository.ts 增加白名單用途的有效員工email批次查詢，按完整員編精確核對或department_code精確直接所屬，僅選必要欄位，不逐人讀email。
- [x] T017 [US3] 在 server/src/infrastructure/mail/mail-recipient-policy.service.ts 以本機查詢取代組織樹／HR email，維持完整email規則短路、每次讀規則、只回傳原收件人交集；在 server/src/infrastructure/mail/mail.module.ts 移除不再使用的HR模組依賴，不移除EsignModule所需部門樹來源。
- [x] T018 [US3] 在 server/test/mail-whitelist-runtime.e2e-spec.ts、mail-whitelist-worker.e2e-spec.ts、mail-whitelist-otp.e2e-spec.ts 及 mail-whitelist-recovery.e2e-spec.ts 改用本機合成資料，驗證初邀／催簽／補簽／OTP、production bypass、NOT_WHITELISTED／CHECK_FAILED與HR零呼叫。

## Phase 6: US4 重跑與回復（P1）

獨立驗收：同來源重跑零變更；原值衝突、被使用的新帳號回復一律拒絕，歷史不改。

- [x] T019 [US4] 在 server/src/maintenance/portal-users.ts 實作 no-op與原值並行防護、rollback-preview／rollback；回復時核對現值、FK／session／audit引用，無法證明安全則拒絕整批，不刪已使用帳號；commit後artifact失敗回報待人工對帳。
- [x] T020 [P] [US4] 在 server/test/portal-user-import.e2e-spec.ts 加入同批重跑updated_at不變、預覽後登入更新／新增同員編競態、回復原值、安全新增刪除與引用／後續修改拒絕、commit後檔案失敗測試。
- [x] T021 [P] [US4] 在 server/src/features/auth/services/auth.service.spec.ts 與 server/test/internal-email-initiation.e2e-spec.ts 驗證登入save不清空email、一般回應不洩漏、匯入更新不動歷史快照及通知固定email。
- [x] T022 [US4] 新增 server/docs/portal-user-import.md 維護runbook，記錄來源只讀取得、0／1狀態、預覽／apply／回復命令、排除名單理由、私有檔案權限與清理、無排程及離職另行管理；不得寫真實員編／密碼。

## Phase 7: Polish 與整合交接

所有 stories 完成後才作完整交接。

- [x] T023 在 specs/016-internal-portal-signing/、specs/018-nonproduction-mail-whitelist/ 與 specs/021-external-mail-whitelist/ 的spec／contract標示023來源決策取代範圍，保留歷史驗證紀錄；同步 server/docs/internal-electronic-signature-data-dictionary.md 資料來源說明。
- [x] T024 依 specs/023-portal-user-email/quickstart.md 執行server lint/test/build與e2e/security、client lint/build及root檢查，修正此次變更引起的失敗；記錄未執行限制。
- [x] T025 在 server/test/internal-email-capacity.e2e-spec.ts 與 specs/023-portal-user-email/quickstart.md 記錄同環境5001人前後各三次各階段時間、DB查詢數、HR零請求；驗收組織樹／登入例外與缺人UI阻止送出。
- [x] T026 於 .scratch/023-portal-user-email/issues/06-verification-handoff.md 記錄驗收、code review、整合commit及維運更新責任／時機、應用回滾順序；未部署項目明列，不自行寄信或發布。

## Dependencies & Execution Order

T001 → T002 → T003；US1依賴foundation，US2／US3可用合成主檔獨立驗收，US4依賴US1。使用者授權平行實作後，02／03／04僅依賴已完成01；01完成後repository由04獨占修改，03使用已固定介面，02獨立維護工具。05等待02／03／04，06等待全部。T008→T009；T011→T012→T014；T015→T016→T017→T018；T019→T020；所有stories→T023–T026。

## Parallel Examples

- US1：解析／apply在同一維護檔案，依序執行；不強行平行。
- US2：T008（server解析測試）與T010（client文案）可獨立準備；T014須等待T011–T012。
- US3：repository與policy串接依序執行，勿與T002同時編輯。
- US4：T020與T021在對應前置完成後可平行；兩者與US2的同名e2e檔案變更不可重疊。

## Implementation Strategy

工具MVP為foundation＋US1，可先驗收匯入而不切換線上流程。使用者主要效能收益由US2提供，完整來源切換須US3完成；US4完成後才具備持續維運的交付條件。依本機ticket逐張實作，只有前置ticket resolved才可開始；單一功能整合分支，每張附驗收與commit紀錄。

## Requirements Coverage

| FR | Tasks |
| --- | --- |
| 001、015 | T001–T003、T021、T023–T024 |
| 002–004 | T004–T007 |
| 005–006、014 | T006–T007、T019–T022 |
| 007、012 | T008–T010、T013–T014、T025 |
| 008–009 | T011–T014 |
| 010–011 | T015–T018 |
| 013 | T018、T021 |

## Task Counts

共26項：Setup 1、Foundation 2、US1 4、US2 7、US3 4、US4 4、Polish 4。
