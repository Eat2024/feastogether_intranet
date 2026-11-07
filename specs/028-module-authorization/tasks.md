# Tasks: 多子功能角色權限與電子簽授權

**Input**：本目錄 spec、plan、research、data-model、contracts 與 quickstart。
**Prerequisites**：027 的 actor union、有效 MySQL session、Origin 防護及隔離 console 已可用；不自行實作另一套登入。
**Tests**：依 constitution 與 server/AGENTS.md，授權、交易、migration、檔案及簽署改動包含單元、真 MySQL 整合與 e2e；先建立對應失敗案例，再實作。此文件沒有勾選任何已實作項目。
**Organization**：依 US 分階段；實際 tickets 可把共用前置與特定行為組成垂直交付。單一整合分支完成所有保護才允許正式切換，不把中途 demo 當成完整授權上線。

## Phase 1: Setup

- [X] T001 依 `specs/028-module-authorization/contracts/permissions.md` 盤點 `server/src/features/esign/controllers/` 與 027 的 actor／console 接縫，將現有每個 endpoint、public 例外、對應測試及後續任務記入 `specs/028-module-authorization/quickstart.md`；不把 mock 前端列為已完成業務。
- [X] T002 建立隔離員工／部門／兩子功能 fixtures 於 `server/test/helpers/authorization-fixtures.ts`，並在 `server/test/jest-e2e-security.json`、`server/test/jest-schema.json` 納入本功能測試；維持測試 DB 名稱 fail-closed，第二子功能不得進正式 catalog。

## Phase 2: Foundational

**Checkpoint**：資料約束、catalog、共用交易與能力 guard 接縫可用後才開始各 US；本階段本身不代表已完成電子簽授權。

- [X] T003 [P] 在 `server/src/features/authorization/authorization.catalog.ts` 定義 esign／platform 的 12 個權限與三個初始角色；同仁固定前四項、platform.authorization.manage 不可指派、scope modifier 要求同角色含對應 base，不建立動態 module CRUD。
- [X] T004 [P] 在 `server/src/features/authorization/entities/authorization-role.entity.ts` 與 `authorization-permission.entity.ts` 實作資料欄位；逐字沿用限制：module_key「varchar(50), NOT NULL；僅compiled module catalog」、role_code「varchar(80), NOT NULL；模組內穩定且不可改」、role_name「varchar(100), trim後1～100字」、is_active「boolean NOT NULL default true」、is_protected「boolean NOT NULL default false」、version「unsigned int NOT NULL default1」；permission_key／permission_name 各 varchar(100)、key 全域唯一，assignable boolean，code/key 使用 ascii_bin。
- [X] T005 建立 `server/src/features/authorization/entities/authorization-role-permission.entity.ts`、`authorization-user-role.entity.ts` 與 `authorization-event.entity.ts`：關聯 id／role_id／permission_id unsigned bigint、user_id bigint FK；module_key varchar(50) NOT NULL、關聯唯一鍵與雙側複合 scope FK RESTRICT；event 繼承 BaseEntity append-only，occurred_at datetime(6)、actor_kind varchar(20)=super_user|operator|system、source varchar(10)=http|repl|migration、module_key varchar(50)、event_type varchar(64)、target_kind varchar(20)=role|user|catalog、target_id bigint nullable、request_id varchar(64) nullable、before_json／after_json JSON nullable。
- [X] T006 在 `server/src/infrastructure/database/migrations/` 新增授權五表增量 migration 並同步 `server/src/infrastructure/database/schema.sql`；role 使用 UNIQUE(module_key,role_code)、UNIQUE(module_key,id)，generated active_role_name = CASE WHEN deleted_at IS NULL THEN role_name ELSE NULL END 與 utf8mb4_0900_bin 唯一鍵；inactive 也占名稱，soft-delete 後 code 不重用；共用 UTC datetime(6)／單欄時間索引及 user_roles(user_id,module_key,deleted_at) 索引完整。
- [X] T007 在 `server/test/authorization-schema.e2e-spec.ts` 驗證真 MySQL 複合 FK 拒跨 module、並發同名、名稱與 code 軟刪除語意、關聯撤銷恢復同列及空測試庫 up/down/reapply；down 若有 authorization_events 或需保存的新資料必拒絕，不因沒有 Super 業務資料就刪除稽核。
- [X] T008 在 `server/src/features/authorization/repositories/authorization.repository.ts`、`authorization-event.repository.ts` 與 `server/src/infrastructure/database/mysql/mysql.module.ts` 實作集合讀取與交易 repository，統一由 MysqlModule 註冊；更新 save、撤銷 soft-delete、重授恢復同列，固定鎖序 users → role id → permission id → relations，不反向鎖 user。
- [X] T009 在 `server/src/features/authorization/services/authorization-audit.service.ts` 與 `.spec.ts` 實作同交易白名單 audit：只保存角色設定、permission keys、一般 role IDs、本地 user ID；不記員編／憑證／文件／簽名，audit 失敗 rollback、no-op 不重複記錄，不恢復 026 歷程。
- [X] T010 在 `server/src/features/authorization/services/authorization-catalog.service.ts` 與 `.spec.ts` 實作明確 syncCatalog 交易：初次建立角色、後續不覆蓋一般角色自訂能力／active，移除目錄 soft-delete，protected 同仁隨程式更新，缺失／不相容 catalog 回 unavailable；不在 HTTP startup 或 GET 寫入；將 syncCatalog 接到 `server/src/console/helpers/authorization.helpers.ts` 並在 `server/src/console/console.module.ts` 註冊為明確維護操作，沿 027 active generation 驗證。
- [X] T011 在 `server/src/features/authorization/decorators/require-permissions.decorator.ts`、`guards/authorization.guard.ts`、`authorization.module.ts` 及 `server/src/features/feature.module.ts` 接入 actor-aware 能力 guard，支援明確 ALL／候選人 any-of／AuthenticatedOnly／SuperUserOnly；管理資格驗 actor kind，不能只看可指派 permission；電子簽服務尚未 actor 相容前維持 027 的 Super 拒絕保護。
- [X] T012 在 `server/src/common/errors/app-error-code.ts`、`app-errors.ts`、`client/src/api/errorCodes.ts` 加入 contracts 定義的授權錯誤；403 不當登入過期，保留資源不可見 404，DB／catalog 故障 503 不 fallback。

## Phase 3: US1 — 員工基本資格 (P1)

**Goal**：既有及新員工共享 session，得到唯讀推導同仁與本人能力查詢，基本簽署正常且沒有多餘管理權。
**Independent Test**：零額外角色員工以 OAuth／WebView session 查能力、同部門文件與本人跨部門簽署；建立、一般匯出與他人副本全部拒絕，GET 無業務寫入。

- [X] T013 [P] [US1] 在 `server/test/authorization-baseline.e2e-spec.ts` 建立新／舊 session、零指派、停用／刪除員工、缺部門、GET 無寫入及最小 response 契約案例。
- [X] T014 [US1] 在 `server/src/features/authorization/services/authorization-resolver.service.ts` 與 `.spec.ts` 實作有效員工固定 baseline，Super 回 compiled 全集；當前 DB 狀態與 catalog 必須有效，無逐人隱含指派寫入、無逐請求 Portal 或 cookie 權限；為一般 role 聯集保留同一解析入口，下一階段擴充。
- [X] T015 [US1] 在 `server/src/features/authorization/controllers/current-authorization.controller.ts`、`dto/authorization-view.dto.ts` 提供 GET /api/me/authorization；employee actor 僅 kind/userId（沿 027 安全整數 number），super 僅 kind/displayName，modules／permissions 排序去重、空 module 省略，no-store、不帶 roles／憑證／他人資料；未登入 401、不可用 503。
- [X] T016 [US1] 依矩陣在 `server/src/features/esign/controllers/documents.controller.ts`、`signing-tasks.controller.ts`、`signer-candidates.controller.ts`、`initiation-jobs.controller.ts`、`notification-batches.controller.ts`、`exports.controller.ts`、`export-history.controller.ts` 完整宣告所需能力；詳情 export view、匯出下載記錄分支於 service 重驗，候選人只允許 create/manage any-of，零角色員工寫入／一般匯出不得漏口。
- [X] T017 [US1] 在 `server/src/features/esign/services/esign-access-policy.service.ts`、`esign-document-query.service.ts` 驗證 document.read 的原有同部門／原建立人閱讀例外，無可信部門 fail-closed，簽名／邀請裁切及不可見 404 不變；此任務只做基本閱讀，跨部門管理由 US4 擴充。
- [X] T018 [US1] 在 `server/src/features/esign/services/esign-completion-access.service.ts`、`esign-signing-task.service.ts`、`esign-signing.service.ts`、`esign-rejection.service.ts` 及 `esign-export-history.service.ts` 將本人簽署／拒簽／departmentFile／pdf 歷史副本入口限定 employee 本人指派，保留期限、條款、證據、外部憑證隔離；一般匯出另走 export 能力。
- [X] T019 [US1] 在 `server/test/authorization-colleague-boundaries.e2e-spec.ts` 驗證同仁所有正負案例與任意管理 actor 代簽／代拒簽／他人副本失敗；覆蓋來源檔、export view、一般歷史／下載、pdf 歷史旁路及缺部門但本人資格仍可獨立判斷。

## Phase 4: US2 — 子功能隔離、多角色聯集與即時生效 (P1)

**Independent Test**：以測試 fixtures 建立兩 module 同名角色與互補／重複 grant；兩 HTTP 實例的同一舊 session 在撤權提交後下一請求立即更新。此 US 可用 fixture 不依賴管理 UI 或 US3 API。

- [X] T020 [P] [US2] 在 `server/src/features/authorization/services/authorization-resolver.service.spec.ts` 增加同功能聯集、重複 grant、跨 module、停用／刪除／移出 catalog、不依名稱與未知 permission 拒絕案例。
- [X] T021 [US2] 擴充 `server/src/features/authorization/services/authorization-resolver.service.ts` 與 `repositories/authorization.repository.ts`，每請求集合讀取有效一般角色／權限與 compiled catalog 交集再疊 baseline；無 N+1、無 Redis／session 快取、無 deny 或優先序。
- [X] T022 [US2] 在 `server/src/features/authorization/services/authorization.service.ts` 提供業務 service 交易內目前讀授權核對，採目前讀／READ COMMITTED，撤權提交後開始的新請求不得沿長交易舊快照；明確區分已受理工作不倒退取消。
- [X] T023 [US2] 在 `server/test/authorization-revocation.e2e-spec.ts` 驗證兩實例舊 session 的 role 停用／permission 修改／撤指派即時生效、重複 grant 尚存仍有效；用 fixtures 驗證 schema 跨 scope 偽造失敗，管理 API 完成後再以正式變更路徑重跑。

## Phase 5: US3 — Super user 授權管理與預先指派 (P1)

**Independent Test**：有效 Super 由 API 與 REPL 各完成建立角色、配權、預指派未登入員工、撤銷及查 audit；員工／管理員一律不可維護，同仁不可更改，失敗無半套資料。

- [X] T024 [P] [US3] 在 `server/test/authorization-role-management.e2e-spec.ts` 建立 Super-only、Origin、角色 CRUD／permission、保護同仁、不可指派平台權限、版本及名稱競態案例。
- [X] T025 [P] [US3] 在 `server/test/authorization-assignments.e2e-spec.ts` 建立 Portal exact-match、未登入員工、失效／模糊／故障、本地停用、首次登入競態、CAS、audit rollback 與 API／REPL 相同結果案例。
- [X] T026 [US3] 在 `server/src/features/authorization/dto/role-management.dto.ts`、`assignment.dto.ts`、`authorization-query.dto.ts` 實作嚴格 DTO：moduleKey 1～50 且 `[a-z][a-z0-9-]*`、ID 正整數字串且安全解析、roleName trim 後 1～100、expectedVersion 正整數、非空 patch；permissionKeys 每項 1～100／最多100／不重複，roleIds／expectedRoleIds 各最多50／不重複，empId 1～32 保留大小寫與前後字元；未知欄位拒絕，limit 預設20最大100、beforeId 正整數字串。
- [X] T027 [US3] 在 `server/src/features/authorization/services/authorization-role.service.ts` 實作角色新增／更名／停用／刪除／完整配權與 version CAS；後端產 immutable code，刪除仍被指派者409、停用保留關聯、no-op 不加版，protected 不可改，modifier 需同角色 base，platform 無可指派權限不可建一般角色；所有異動與 audit 原子提交。
- [X] T028 [US3] 在 `server/src/features/authorization/controllers/authorization-roles.controller.ts` 暴露 module／permission 查詢及角色列表／詳細／POST／PATCH／DELETE／PUT permissions；沿 027 SuperUserOnly 與寫入 Origin，管理 ID 輸出字串，分頁 no-store，錯誤符合 OpenAPI。
- [X] T029 [US3] 在 `server/src/features/authorization/services/authorization-assignment.service.ts` 重用 `server/src/features/auth/services/eligible-staff.service.ts` 查核後開本地交易，empid 唯一仲裁取得同一 user；目標不合格轉422 AUTHORIZATION_EMPLOYEE_INELIGIBLE、Portal 故障502 STAFF_LOOKUP_FAILED、本地停用403 ACCOUNT_DISABLED 不復活；不更改登入流程原錯誤。
- [X] T030 [US3] 在 `server/src/features/authorization/services/authorization-assignment.service.ts` 實作 users→roles 鎖序及 expectedRoleIds CAS，覆寫單一 module 一般角色集合，拒 protected／跨 module，重授恢復同列；目標已一致 no-op、audit 失敗含新 user 一併回滾。
- [X] T031 [US3] 在 `server/src/features/authorization/controllers/authorization-assignments.controller.ts` 提供 role employees、employee roles 及 employee-role-assignments；員編只在 body、不入 URL／log，implicitRoles 與 explicit roleIds 分開，Super session 不因目標422變成登出；同步在 `server/src/console/helpers/authorization.helpers.ts` 接 assignRoles／員工角色查詢到相同服務。
- [X] T032 [US3] 在 `server/src/features/authorization/controllers/authorization-events.controller.ts` 與 `dto/authorization-event.dto.ts` 實作 Super-only cursor 稽核查詢，輸出 actor/source/module/target/裁切前後值；無更新刪除入口，不輸出 raw Portal／員編／secret。
- [X] T033 [US3] 在 `server/src/console/helpers/authorization.helpers.ts` 與 `server/src/console/console.module.ts` 接入 roles／permissions／CRUD／events；全部呼叫相同業務 service，維護寫入逐次驗 027 active generation，不啟 HTTP／worker／mail／S3，不直接暴露 repository。
- [X] T034 [US3] 在 `server/test/authorization-management-concurrency.e2e-spec.ts` 驗證同名建立／同版本更新／刪除對並發指派／預建對首次登入及 audit 故障的原子結果；所有 HTTP 寫入與 REPL 寫入結果及錯誤一致。

## Phase 6: US4 — 管理能力與文件／簽署不變量 (P1)

**Independent Test**：員工建立者只管理自己文件；管理員／Super 跨部門處理合法狀態、Super 建立有效部門文件並完成 worker 流程，原建立人／部門不被改寫；任何人不得代簽或繞證據／狀態。

- [X] T035 [P] [US4] 在 `server/test/authorization-document-management.e2e-spec.ts` 建立 create/manage/read-all 正負矩陣、Super 有效部門／缺部門／假部門、employee 覆寫部門拒絕及 creator／department 保持案例。
- [X] T036 [US4] 在 `server/src/features/esign/entities/esign-document.entity.ts`、`esign-document-field.entity.ts`、`esign-signer.entity.ts` 與 `server/src/infrastructure/database/migrations/` 增加局部 actor schema 並同步 `schema.sql`：document created kind employee|super_user、employee FK 必非空／super 必 NULL；updated kind employee|super_user|null 與 nullable user FK、歷史 NULL 不猜測；fields／signers created/updated kind employee|super_user|system|legacy_unknown，舊有 user 回填 employee、空為 legacy_unknown，新 HTTP 禁 legacy_unknown；不改簽署人 user_id 或共用基底。
- [X] T037 [US4] 在 `server/src/infrastructure/database/audit.subscriber.ts` 與 `.spec.ts` 僅對支援 actor 的 esign entity 寫入真實 kind／nullable user，保留 Department 人事流程；在 `server/test/authorization-actor-schema.e2e-spec.ts` 驗證 NULL-aware CHECK、歷史回填、證據保持與有新受保護資料時 down 拒絕。
- [X] T038 [US4] 在 `server/src/features/esign/services/esign-access-policy.service.ts` 與 `.spec.ts` 加入 read-all／manage-all 精確範圍例外，業務寫入透過 T022 重核能力；只放寬建立人／部門，不跳文件狀態、鎖、期限、完整性或本人資格。
- [X] T039 [US4] 在 `server/src/features/esign/dto/document-upload.dto.ts`、`services/esign-draft.service.ts`、`services/esign-document-validation.service.ts` 實作 Super 建立 departmentCode「1～50字元、保留原碼」、Portal 有效部門 exact-match／可信名稱，無效400、上游503；employee 拒覆寫；儲存真 Super actor／NULL employee FK，不造假員工。
- [X] T040 [US4] 在 `server/src/features/esign/controllers/documents.controller.ts`、`services/esign-draft.service.ts`、`esign-field.service.ts`、`esign-signer.service.ts` 將建立／編輯／刪除／draft settings／fields 接到 CurrentActor，保留原 creator／department，只更新最後管理 actor；逐條解除已相容操作的 027 Super 拒絕，不以全域 bypass 放行。
- [X] T041 [US4] 在 `server/src/features/esign/services/esign-document-query.service.ts`、`repositories/document.repository.ts`、`dto/document-query.dto.ts` 支援 role=all 僅 read-all，Super 未帶 role 預設 all、employee 舊預設不變；query 中 role 是資料範圍不是 RBAC 角色，不能靠 departmentCode query 越權。
- [X] T042 [US4] 在 `server/src/features/esign/services/esign-view.mapper.ts`、`dto/document.dto.ts`、`client/src/api/types/esignDocuments.ts`、`client/src/features/esign-documents/DocumentsListView.tsx` 做最小相容：createdBy 增 kind，Super employeeNo=null/name=Super user、避免 null 強轉0／undefined檔名，列表依027 actor super送all／employee送dep；不做管理頁與新篩選UI。
- [x] T043 [P] [US4] 在 `server/test/authorization-lifecycle-actor.e2e-spec.ts` 建立管理他人文件的發起／重試／停止／補簽／提醒完整流程，驗證 worker 保存原 job 操作者與不可破壞狀態／證據。
- [x] T044 [US4] 在 `server/src/features/esign/entities/esign-initiation-job.entity.ts`、`esign-notification-batch.entity.ts` 與 `server/src/infrastructure/database/migrations/` 新增 job created kind employee|super_user、nullable user 及 notification kind employee|super_user|system，歷史 notification NULL user 回填 system；CHECK employee 必有 user、其餘 NULL，schema.sql 同步。
- [x] T045 [US4] 在 `server/src/features/esign/services/esign-initiation-job.service.ts`、`esign-initiation.service.ts`、`esign-job-producer.service.ts`、`server/src/worker/esign/document-initiation.processor.ts` 接受並持久化實際 actor，worker 從 job 讀 actor，不拿 document creator 代替；retry 保留原 job actor，新 job 才記新操作者。
- [x] T046 [US4] 在 `server/src/features/esign/services/esign-stoppage.service.ts`、`esign-reopening.service.ts`、`esign-reminder.service.ts` 及 `controllers/initiation-jobs.controller.ts`、`notification-batches.controller.ts` 套 CurrentActor／manage policy，通知保存真 actor；poll/issues/input/retry 重驗當前權限，已受理工作不承諾倒退取消。
- [x] T047 [US4] 在 `server/src/features/esign/dto/initiation-job.dto.ts`、`notification-batch.dto.ts` 及 `services/esign-view.mapper.ts` 補生命週期 actor 顯示與 employee 欄 nullable，完成 T043 的 worker 真流程及管理者狀態負向測試，不輸出簽名／邀請。
- [x] T048 [P] [US4] 在 `server/test/authorization-exports.e2e-spec.ts` 建立 export.read/create/all 範圍、Super 一般匯出、撤權後 poll/retry/download、pdf 個人副本旁路拒絕矩陣。
- [x] T049 [US4] 在 `server/src/features/esign/entities/esign-export-job.entity.ts` 與 `server/src/infrastructure/database/migrations/` 增 created kind employee|super_user|external_signer 並更新原 CHECK／schema.sql；歷史有 user=employee、無 user 且 pdf/signer_id=external_signer；excel/zip 只 employee 或 super，pdf 只 employee 或 external 且 signer_id 非空，Super 不可建立本人 pdf 紀錄。
- [x] T050 [US4] 在 `server/src/features/esign/services/esign-export.service.ts`、`esign-export-history.service.ts`、`repositories/export-job.repository.ts` 及 `server/src/worker/esign/document-export.processor.ts` 使用真 actor 與 export.read/create/all policy；每次查詢／下載重驗範圍，下載記錄與產生分支能力分開，保存實際提交者而非原建立人。
- [x] T051 [US4] 在 `server/src/features/esign/dto/export.dto.ts`、`export-history.dto.ts`、`services/esign-view.mapper.ts`、`client/src/api/types/esignExports.ts` 支援 exportedBy.kind 與 Super nullable employeeNo/email、姓名 Super user；既有下載檔名安全，外部本人副本不被一般匯出能力擴權，跑 T048 真 worker 與下載驗收。

## Phase 7: US5 — 導入與維運查詢 (P1)

**Independent Test**：保留既有員工／文件／會話的測試副本中，兩次 sync、核定名單指派、停舊實例後切換；既有會話只有同仁、無歷史升權，查詢結果與 HTTP 一致。

- [ ] T052 [P] [US5] 在 `server/test/authorization-cutover.e2e-spec.ts` 建立既有員工／文件／證據／session fixture，驗證重跑 seed 不覆寫自訂角色、無歷史行為升權、關聯與證據保持、無新舊放行混跑的切換驗收。
- [X] T053 [US5] 在 `server/src/console/helpers/authorization.helpers.ts` 接上唯讀 userPermissions：userPermissions 與 HTTP 同 resolver 並標 baseline／explicit；無 raw employee、無 read 自動 sync、不要求 console 啟動 Portal 可用。
- [ ] T054 [US5] 在 `server/src/features/authorization/services/authorization-readiness.service.ts` 與 `.spec.ts`、`server/src/worker.module.ts` 接入 catalog 完整性及 endpoint 宣告掃描，漏 Public／AuthenticatedOnly／RequirePermissions 或版本不符拒絕啟用；HTTP／worker 不接受流量且不 fallback，不新增 env／flag／排程。
- [ ] T055 [US5] 在 `specs/028-module-authorization/contracts/operations.md` 與 `quickstart.md` 記錄可執行的備份副本演練、核定名單預指派／resolver核對、停止舊HTTP與worker、migration與sync、同版本啟動順序；僅空且無新受保護資料可down，其餘向前修復或一致備份回復，repo 不存員編名單。
- [ ] T056 [US5] 在 `server/test/authorization-cutover.e2e-spec.ts` 完成 T052 導入及維運驗收，保留舊 session、所有原 user ID 與證據、核定額外權限與 baseline 差異、audit 不可遺失；舊角色設定與 no-op 指派重跑冪等。

## Phase 8: Polish & 跨功能驗收

- [ ] T057 在 `server/test/authorization-route-coverage.e2e-spec.ts` 列舉實際註冊 routes，逐條驗證矩陣與 401／403／404、公開外部例外；不能只檢查 decorator metadata，缺宣告須 fail readiness，沒有永久漏標放行。
- [ ] T058 在 `server/test/authorization-privacy.e2e-spec.ts` 驗證 response／access log／audit 白名單、無員編body／Portal raw error／cookie／隱藏入口／簽名，並確認 assignment422與業務403不觸發有效管理者登出。
- [ ] T059 在 `specs/028-module-authorization/quickstart.md` 記錄 server test、test:e2e、test:e2e:security、test:schema、lint:check、build，以及既有外部簽署／公開驗證／來源與完成檔安全回歸結果；client 有相容改動須 root pnpm build／pnpm lint，無環境就明列未驗證，不把 mock 當通過。
- [ ] T060 在 `specs/028-module-authorization/contracts/openapi.json` 與 `quickstart.md` 對照最終 DTO／HTTP 實測契約，核對 029 的三個 menu keys、no-store／actor union，記錄全部 FR／SC 驗收及 migration/config 限制，無新增授權 env、cookie 或排程。

## Dependencies & Execution Order

- Setup → Foundation → US1 → US2；US3 依 US2 的 resolver／transaction 能力，US4 依 US2 與 US1 的本人邊界，可用 fixture 角色獨立於 US3 開發。正式端到端驗收必須整合 US3。
- syncCatalog 的 console 接線在 foundation T010 完成；US5 的 read-only REPL 查詢可隨 resolver 完成先接，最終切換驗收必須 US1～US4 與 027 全部完成。
- US4 文件建立／編輯（T035～T042）先行；生命週期（T043～T047）與匯出（T048～T051）依其 actor/policy，再分工作區並行；mapper/schema/migration 共用變更必須序列整合。
- T014 僅 baseline＋Super；T021 才提供完整一般角色聯集。給 029 的正式交接點為 T015＋T021～T023，不將基礎 demo 誤當完整後端契約。
- T016 先保護全部入口，US4 僅解除已完成 actor/service 相容的 Super 拒絕；未完成前保持拒絕。T054 的全路由 readiness 啟用在全覆蓋完成後，沒有臨時全域放行。
- T010 的同步核心由 foundation 建立；T053 僅是既有 console helper 的唯讀有效能力查詢。fixtures 可呼叫相同核心，不需要先啟動正式 UI。
- 所有實作先有對應失敗測試，再補功能，故事 checkpoint 不等於正式可部署。

## Parallel Examples

- Setup 完成後 T003 catalog 與 T004 entity 可並行，T005～T010 依序接入資料交易。
- US1：T013 測試情境可與尚未占用測試檔的 T014 resolver 實作並行準備；T015 依 resolver、T017～T018 涉共同 policy 需協調，再執行 T019。
- US2：T020 純 resolver 測試可先寫，T021／T022 序列，T023 用兩實例驗證。
- US3：T024／T025 測試檔可並行；T026 共用 DTO 完成後 role service 與 assignment service 可分工；T033 與 T032 可在共用服務完成後分檔作業。
- US4：T035／T043／T048 各自測試檔可並行準備；先完成文件 actor schema，再分 lifecycle/export 實作；共用 mapper、schema.sql 必須單人整合，不宣稱整段無衝突。
- US5：T052 導入情境可先準備；T053 helpers 與 T054 readiness 分檔，但最終 T056／T059 等待全部業務完成。

## Implementation Strategy / MVP

第一個可展示增量是唯讀本人能力與 protected baseline（foundation＋T013～T015），第二個是完整同仁電子簽邊界（US1），再加多角色／Super 管理與各業務切片。任何部分 demo 都不允許正式切換；需完成全部 5 個 P1 stories、027 安全登入、端點覆蓋與核定角色預指派。

## Requirements Coverage

| Requirements | 主要 tasks |
|---|---|
| FR-001／002／013／021 | T003～T008、T020～T023、T027、T030、T034 |
| FR-003／004／005／006 | T003、T010、T013～T019、T027、T030 |
| FR-007／008／009／017 | T011、T016～T019、T035～T051、T057 |
| FR-010／011／012／014／015／016 | T009～T012、T015、T024～T034、T053、T058 |
| FR-018／019／020 | T007、T010、T015、T052～T056、T059～T060 |

安全測試與 schema suite 在各切片完成時即跑；最後廣泛回歸只針對跨功能整合，不以單元 mock 取代 FK／並發／worker 驗證。所有 tasks 未執行；只完成規劃。
