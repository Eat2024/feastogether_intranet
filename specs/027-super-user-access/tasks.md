# Tasks: Super user 登入、隱藏入口輪換與 REPL 基礎

**Input**: [spec.md](spec.md)、[plan.md](plan.md)、[research.md](research.md)、[data-model.md](data-model.md)、[API](contracts/openapi.json)、[行為](contracts/api-behavior.md)、[維運](contracts/operations.md)、[驗證指南](quickstart.md)。

**狀態**: 待實作。所有任務未勾選，不表示功能已完成。

**Tests**: 憲章與本 feature 明確要求auth、schema、重放、交易及並發驗證，因此列入單元／整合任務。client無test script，使用lint/build與瀏覽器驗收，不新增測試框架。

**Format**: `- [ ] Tnnn [P?] [USn?] 行動與路徑`。路徑相對repo root；[P]只表示共同前置完成後，同phase不同檔案可平行。

## Phase 1: Setup

**Goal**: 確認既有工作、測試邊界與整合位置。

- [X] T001 核對 `specs/027-super-user-access/plan.md`、`data-model.md`、`contracts/` 與現有未提交變更，在 `specs/027-super-user-access/quickstart.md` 建立實作驗收紀錄區；不改共用feature指標、實際env或其他spec。
- [X] T002 在 `server/test/jest-e2e-security.json` 與 `server/test/jest-schema.json` 納入本清單新增的security-super-user-access、security-session-replacement、security-super-user-credentials及super-user-schema測試；沿用 `server/test/global-setup.ts`、`server/test/setup-e2e.ts` 的 `feastogether_intranet_test*` 保護。
- [ ] T003 盤點 `server/src/features/auth/auth.module.ts`、`client/src/proxy.ts`、`client/src/features/embed/EmbedBridge.tsx`、`client/src/components/providers/ReactQueryProvider.tsx` 的現行入口，記入 `specs/027-super-user-access/quickstart.md`；特別確認401先觸發全站dialog的行為，不能只用suppressGlobalErrorToast處理帳密登入失敗。

## Phase 2: Foundational

**Goal**: 建立共用actor/session、資料約束與最小REPL初始化，使US1不反向依賴US3週排程。

- [X] T004 [P] 先在 `server/test/super-user-schema.e2e-spec.ts` 建立空庫與既有員工session的migration測試：CHECK/FK/index、employee回填、文件關聯不變、空維護資料apply/down/reapply及有事件／維護session時拒絕down。
- [X] T005 [P] 先在 `server/src/features/auth/helpers/super-user-password.spec.ts` 與 `server/src/features/auth/services/super-user-config.service.spec.ts` 驗證固定scrypt參數、salt/key長度、輸入不trim、缺設定失敗、錯帳號同樣跑KDF、相同hash fingerprint穩定與新salt視為新版本；fixture不得是真實secret。
- [X] T006 [P] 先在 `server/src/features/auth/services/session.service.spec.ts` 驗證actor、固定八小時、expired/revoked、員工停用、super版本失配、替換rollback及舊replacement非空回409；測試行為，不只鏡射mock呼叫。
- [X] T007 延伸 `server/src/features/auth/entities/auth-session.entity.ts`，落實 actor_kind「varchar(20), NOT NULL, default employee」、user_id「nullable bigint FK users」、source「varchar(20)」、credential_generation「nullable unsigned bigint」、replacement_session_id「nullable unsigned bigint self FK RESTRICT, unique」；actor僅employee/super_user，source僅webview/oauth/super_user，super必須user_id IS NULL且generation IS NOT NULL，employee generation IS NULL且pending/active/revoked必有user_id，super不能validating/pending，active必有token hash/activated_at/expires_at；保留原欄位與歷史值，增加 `(actor_kind,credential_generation,status)` 索引。
- [X] T008 建立 `server/src/features/auth/entities/super-user-access.entity.ts`，繼承AuditableEntity；id「tinyint unsigned PK，CHECK id=1」、entry_key「char(43), ascii_bin, NOT NULL」、entry_generation/credential_generation「bigint unsigned, >=1」、active_credential_fingerprint「char(64), ascii_bin」、rotated_at/period_start_at/credential_activated_at「datetime(6), index」，created_at/updated_at/deleted_at各有單欄日期索引；不提供刪除，soft-deleted拒絕登入。
- [X] T009 建立 `server/src/features/auth/entities/auth-security-event.entity.ts`，繼承BaseEntity；id「unsigned bigint PK」、event_type「varchar(64)」、actor_kind「varchar(20)」、actor_user_id「nullable bigint FK users RESTRICT」、session_id「nullable unsigned bigint FK auth_sessions RESTRICT」、occurred_at/created_at「datetime(6)，各單欄 index」、outcome_code「varchar(64)」、credential_generation/entry_generation「nullable unsigned bigint」、request_id「nullable varchar(64)」；事件限login.succeeded/login.rejected/session.replaced/session.revoked/credentials.activated/entry.initialized/entry.rotated，actor限employee/super_user/operator/system/anonymous，只有employee帶actor_user_id；不提供update/delete或任意metadata。
- [X] T010 新增 `server/src/infrastructure/database/migrations/1793836802000-SuperUserAccess.ts`，按data-model先加欄位／回填employee再加CHECK/FK/index與兩表；nullable CHECK明寫IS NOT NULL，不寫真實入口／帳密，down有維護資料時拒絕；同步 `server/src/infrastructure/database/mysql/mysql.options.ts` 的entity/migration登錄並跑T004。若時間戳被同期佔用，依migration工具選下一唯一值並同步本任務引用，不改舊baseline。
- [X] T011 實作 `server/src/features/auth/helpers/super-user-password.ts` 與 `server/src/features/auth/services/super-user-config.service.ts`：只讀SUPER_USER_ACCOUNT/SUPER_USER_PASSWORD_HASH，固定 `scrypt:32768:8:1:<salt-base64url>:<derived-key-base64url>`、salt16bytes/derived64bytes/maxmem64MiB，非同步scrypt、固定長度timingSafeEqual、契約domain-separated fingerprint；缺漏／格式錯誤啟動失敗，不印值、不自動啟用DB版本。
- [X] T012 在 `server/src/features/auth/repositories/auth-session.repository.ts`、`super-user-access.repository.ts`、`auth-security-event.repository.ts` 實作actor-aware LEFT JOIN、固定鎖序、replacement、singleton CAS及事件append/query；query limit預設20最大100、beforeId倒序，全部接受EntityManager並由 `server/src/infrastructure/database/mysql/mysql.module.ts` 註冊，不另注入DataSource。（027-02：singleton 只提供讀取與 `FOR UPDATE` 鎖定；初始化、輪換與啟用的條件寫入隨 T015／T039／T047 的使用端實作。）
- [X] T013 建立 `server/src/features/auth/services/auth-security-event.service.ts`，成功登入／登出／維護異動與事件同交易；credential拒絕另短交易，不撤原會話；404／限流走既有安全log，DB故障只記類別/requestId；不得保存帳號、密碼、IP、UA、body、完整入口、fingerprint或文件資料。
- [X] T014 建立 `server/src/features/auth/services/session.service.ts`、`auth.types.ts`、`dto/session-view.dto.ts` 與 `server/src/infrastructure/database/actor.context.ts`，採 `{kind:employee,userId:number}|{kind:super_user}`；employee保留user/expiresAt，super回user:null，僅employee填request.user及CLS_AUDIT_USER_ID；驗super每次查DB fingerprint/generation、不快取；issue/revoke/replace依singleton→舊session→新/待啟用列鎖序同交易，cookie原值只在commit後交controller，固定八小時。（027-02：`actor.context.ts`、request.actor 與 Super user session view 隨 T022 的 guard／GET session 寫入端與讀取端一起建立；本張 guard 仍只接受員工。）
- [X] T015 建立 `server/src/features/auth/auth-session.module.ts`、`super-user-access.module.ts` 與 `services/super-user-access.service.ts` 的initialize/currentEntry/credentialStatus，並建立 `server/src/features/auth/helpers/rotation-period.ts` 與其 `.spec.ts` 的最近到期週期計算，供初始化與後續輪換共用：PK=1仲裁、randomBytes32 base64url、兩generation=1、最近週一台北04:00週期、初始化事件同交易；重複initialize不覆寫、查詢不寫入、缺row明確503；窄模組無controller/APP_GUARD/啟動寫入。（027-03：`SessionService` 只有 HTTP `AuthModule` 使用，窄 REPL 不需要它，因此未建立 `auth-session.module.ts`；`SuperUserAccessModule` 提供並匯出 `SuperUserConfigService`／`AuthSecurityEventService`，由 `AuthModule` import。）
- [X] T016 建立 `server/src/console/console.module.ts`、`repl.ts`、`auth-console.service.ts` 與 `server/package.json` 的repl/repl:dev，先暴露initialize/currentEntry/credentialStatus；僅組Config/CLS/Logging/Mysql/窄auth，不載AppModule/WorkerModule/完整InfrastructureModule，不自動初始化、不保留history、不暴露DS/裸SQL/repository，結束關閉連線；僅currentEntry回path與時程。（027-03：helpers 是 `repl.ts` 匯出的 `createAuthConsole(app)` 閉包，沒有另建 `auth-console.service.ts`；T042／T048 直接在 `createAuthConsole` 加 helper。不用 `@nestjs/core` 的 `repl()`，因為它會把所有 provider token 與 `get()`／`$()` 放進 REPL。）

**Checkpoint**: 基礎測試通過；真正REPL可初始化與查詢入口，US1可獨立展示，不需US3排程。

## Phase 3: User Story 1 — 維護者登入與辨識操作身分（P1）

**Goal**: 完成實際隱藏登入與必要前端，保持028前業務隔離。

**Independent Test**: 在員工登入上游不可用時，由REPL初始化／取得入口，完成維護登入、身分查詢與登出；未知入口、錯帳密及防護失敗不建立會話，HTML/RSC不露表單。

- [ ] T017 [P] [US1] 先在 `server/test/security-super-user-access.e2e-spec.ts` 依OpenAPI驗GET200/404且無Set-Cookie/DB寫入、POST201與super union、錯帳密同401、舊入口404、DTO400、Origin403、413/429/Retry-After、缺可信IP/Redis/DB503；錯誤不揭露帳號是否存在。
- [ ] T018 [P] [US1] 先在 `server/src/features/auth/services/super-user-login.service.spec.ts` 驗入口預檢及KDF後交易重驗、錯帳號相同成本、失敗保留原session、local fingerprint不符拒絕、成功事件原子性與輪換先commit後登入404。
- [ ] T019 [P] [US1] 先在 `server/src/framework/guards/auth.guard.spec.ts` 與 `server/src/features/auth/helpers/auth-cookie.spec.ts` 驗actor、無假userId、未允許業務super403、session read允許兩者及正式None+Secure/本機Lax/28800秒。
- [ ] T020 [US1] 建立 `server/src/features/auth/dto/super-user-login.dto.ts`、`controllers/super-user-access.controller.ts`、`services/super-user-login.service.ts`，落實entryKey43字元base64url、account1～128字元、password1～1024 UTF-8 bytes、不trim／額外欄位、body8KiB；GET只驗位置，POST原子替換session並於commit後Set-Cookie，不回token/fingerprint/generation，controller回DTO。
- [ ] T021 [US1] 在 `server/src/framework/guards/origin.guard.ts`、`super-user-throttler.guard.ts`、`server/src/features/auth/auth.module.ts` 接入維護路徑explicit Origin、按IP與固定登入類別的10次/60秒及50次/300秒限流；缺可信IP或儲存不可用503，不按entryKey分桶、不因iframe信任origin而允許跨站POST。
- [ ] T022 [US1] 在 `server/src/framework/guards/auth.guard.ts`、`server/src/framework/decorators/allow-super-user.decorator.ts`、`server/src/features/auth/controllers/auth.controller.ts` 接入actor與明確allow metadata，僅session GET/DELETE等明確路由允許super；此任務同時將GET目前身分與DELETE登出委派actor-aware SessionService，不再經需要numeric userId的AuthService.getMe，讓US1即能讀取／登出super會話；其餘員工業務403；於 `server/src/common/errors/app-error-code.ts`、`app-errors.ts` 集中新錯誤碼，不假造CLS員工ID。
- [ ] T023 [US1] 在 `client/src/api/types/auth.ts`、`requests/auth.ts`、`queries/auth.ts`、`endpoints.ts`、`query-keys.ts`、各index與 `errorCodes.ts` 新增session union/login/logout；帳密401使用獨立分類或不經全域401攔截的請求處理，不能只設定suppressGlobalErrorToast；成功清舊session資料快取。
- [ ] T024 [US1] 建立 `client/src/app/ops-access/[entryKey]/page.tsx`、`client/src/features/super-user-login/SuperUserLoginForm.tsx`，server no-store確認、MUI表單、防重送、局部401、409重查身分、429等待、成功清輸入並replace到根路徑；不放(main)、不做OAuth或管理頁。
- [ ] T025 [US1] 在 `client/src/proxy.ts` 與 `client/next.config.ts` 增加隱藏入口pre-render驗證，無效HTML/RSC走404不含表單；no-store/no-referrer/noindex、僅維護頁frame-ancestors none，保留原main/WebView/iframe規則，SSR錯誤不含完整入口URL。
- [ ] T026 [US1] 建立 `client/src/components/CurrentActorBanner.tsx` 並整合 `client/src/app/(main)/layout.tsx`、`client/src/components/providers/ReactQueryProvider.tsx` 的必要身分更新；顯示Super user與登出，錯密碼401不開全站SessionExpiredDialog，不改選單或放行028前業務403。
- [X] T027 [US1] 建立 `server/src/console/hash-super-user-password.ts` 與 `server/package.json` 的super-user:hash-password，TTY無回顯及確認、不接命令列password、不載Nest/DB、不保留history，只輸出hash，不新增密碼套件。
- [ ] T028 [US1] 執行US1單元/e2e與瀏覽器登入、錯密碼、無效RSC、標示登出驗收，記錄於 `specs/027-super-user-access/quickstart.md`；用真正REPL初始化，不以裸SQL造可用帳號，未完成其他故事前僅可隔離展示。

**Checkpoint**: 維護登入旅程可獨立展示；所有前端及後端防護有驗收證據。

## Phase 4: User Story 2 — 兩種員工入口與單一身分會話（P1）

**Goal**: OAuth與WebView接入共用會話，移除一般員工帳密且不破壞嵌入。

**Independent Test**: 兩種員工入口對應同一員工，雙向切換撤銷舊cookie、並發只一成功，失敗不先登出；iframe正常且一般帳密入口404。

- [ ] T029 [P] [US2] 先在 `server/test/security-session-replacement.e2e-spec.ts` 驗employee→super→employee、舊cookie重放401、同舊token並發一成功另一409且無Set-Cookie、rollback保留原會話、另一瀏覽器不受影響、登出不恢復舊身分；涵蓋有效/過期/一般登出/已替換舊token。
- [ ] T030 [P] [US2] 先更新 `server/test/oauth-login.e2e-spec.ts`、`server/test/security-webview-session.e2e-spec.ts`、`server/test/password-login.e2e-spec.ts`，保留state/nonce/replay/員工資格/部門同步測試，驗一般帳密與dev替代入口404、WebView activation仍303而launch不改browser session。
- [ ] T031 [US2] 修改 `server/src/features/auth/services/oauth-login.service.ts`、`controllers/oauth.controller.ts`，保留可信上游交換與profile解析；把目前cookie交SessionService，驗證後原子替換，employee回應相容，commit後才設cookie，錯誤不先登出。
- [ ] T032 [US2] 修改 `server/src/features/auth/services/auth.service.ts`、`controllers/auth.controller.ts`，WebView activation共用session交易，launch保留原jti/一次性code防護；僅activation撤舊啟新且303回根路徑；沿用T022已完成的session read/logout委派，不重造會話或移除WebView必要設定。
- [ ] T033 [US2] 從 `server/src/features/auth/auth.module.ts`、`controllers/auth.controller.ts`、`services/auth.service.ts` 移除一般員工login route與專用密碼依賴，清理無其他呼叫者的 `dto/login.dto.ts`／開發登入service；保留其他功能仍用的上游client，不新增forgot/reset/change-password或測試旁路。
- [ ] T034 [US2] 更新 `client/src/features/embed/EmbedBridge.tsx` 與 `client/src/api/types/auth.ts`，先判employee actor再比empId，super為mismatch並沿既有撤銷／launch-required流程；不把全權限視為同員工，user:null不得造成例外。
- [ ] T035 [US2] 更新 `server/src/features/auth/helpers/auth-cookie.ts`、`controllers/auth.controller.spec.ts` 的登出／錯誤邊界，commit後才發cookie，失敗不清原cookie，DELETE清相同屬性與適用OAuth交易cookie，缺cookie冪等成功，維持八小時不滑動與iframe屬性。
- [ ] T036 [US2] 執行兩入口、替換競態、舊路徑移除與iframe瀏覽器回歸，記於 `specs/027-super-user-access/quickstart.md`；明示commit後網路丟失需重新登入及無舊cookie無法辨識同瀏覽器並發的限制，不新增裝置cookie。

**Checkpoint**: 員工登入及切換回歸通過，沒有一般帳密或dev旁路。

## Phase 5: User Story 3 — 每週輪換與受控查詢入口（P1）

**Goal**: DB週期仲裁配合worker排程，舊入口立即失效且不撤既有會話。

**Independent Test**: 控制時間、並發worker與Redis遺失，當週只產一個入口；舊GET/POST404、原session有效，REPL查詢無寫入或背景工作。

- [ ] T037 [P] [US3] 先在 `server/src/features/auth/helpers/rotation-period.spec.ts`、`services/super-user-access.service.spec.ts` 驗台北週一03:59:59/04:00、跨年、最近到期週期、初始化、同週no-op及多週停機只補一次；用測試注入clock，不新增production時間env。
- [ ] T038 [P] [US3] 先在 `server/test/super-user-entry-rotation.e2e-spec.ts`、`server/test/super-user-console.e2e-spec.ts` 驗多worker/startup/job只換一次、DB失敗保留舊key、舊GET/POST404、登入/輪換競態與session仍有效；REPL唯讀且不啟動HTTP/worker/Portal/mail/storage。
- [ ] T039 [US3] 重用T015的 `server/src/features/auth/helpers/rotation-period.ts`，在 `server/src/features/auth/services/super-user-access.service.ts` 實作rotateEntryIfDue：鎖singleton、最新週期大於storedPeriod才產新key及entryGeneration+1並同交易append事件；credentialGeneration不變、不撤session，缺row不偷初始化。
- [ ] T040 [US3] 新增 `server/src/worker/auth/super-user-access.constants.ts`、`super-user-access.scheduler.ts`、`super-user-access.processor.ts`、`super-user-access-worker.module.ts` 並只接 `server/src/worker.module.ts`；固定queue auth-access-maintenance、scheduler super-user-entry-weekly、job rotate-entry-if-due，cron `0 4 * * 1`/Asia/Taipei、空payload、attempts3/exponential5000ms、保留最近100成功/失敗；startup先DB catch-up，再保留overdue job或upsert。
- [ ] T041 [US3] 在 `server/src/worker/auth/super-user-access.scheduler.spec.ts`、`super-user-access.processor.spec.ts` 驗Redis排程遺失／過期job／重啟／retry仍由DB週期裁決，HTTP/Console不註冊queue，不新增掃描排程；DB不可用job失敗，未初始化只回明確結果。
- [ ] T042 [US3] 擴充 `server/src/console/auth-console.service.ts` 的rotateEntryIfDue/securityEvents，limit預設20最大100、beforeId倒序與operator身分；`server/src/console/repl.ts` 只由currentEntry明確回原path，不保留history或一般log，不提供任意強制輪換或token查詢。
- [ ] T043 [US3] 在 `server/test/super-user-console.e2e-spec.ts` 驗初始化並發仲裁、重複initialize不覆寫、唯讀helpers不寫入、結束關閉pool及repl/repl:dev import/env模式一致；入口原值只在受控currentEntry結果。
- [ ] T044 [US3] 完成週期／並發／故障／Redis遺失驗收，將worker/console副作用檢查記入 `specs/027-super-user-access/quickstart.md`，對齊 `contracts/operations.md` 實際排程註冊方式，不把未跑的停機情境標成通過。

**Checkpoint**: 排程、停機補做與REPL維運可獨立驗收，網址輪換不撤session。

## Phase 6: User Story 4 — 帳密輪換撤銷舊維護會話（P1）

**Goal**: 明確啟用憑證版本，舊設定實例不能恢復舊憑證。

**Independent Test**: 共享DB的兩個不同設定實例，activate後舊session／帳密拒絕、新設定可用、員工不受影響；同設定重啟不撤會話。

- [ ] T045 [P] [US4] 先在 `server/test/security-super-user-credentials.e2e-spec.ts` 建共享DB/Redis且載不同設定的兩實例：新設定未active時503，activate後舊session兩端拒絕、舊實例不能新登入、員工session不受影響、同設定重啟有效；不能用單實例改env假裝雙實例。
- [ ] T046 [P] [US4] 先在 `server/src/features/auth/services/super-user-credentials.service.spec.ts` 驗expectedGeneration CAS衝突、同fingerprint no-op、再啟用舊設定仍加generation、撤銷／事件同交易與故障rollback，啟動不得自動activate。
- [ ] T047 [US4] 建立 `server/src/features/auth/services/super-user-credentials.service.ts` 並接 `super-user-access.module.ts`，依singleton→session鎖序驗CAS，異fingerprint時generation+1、activatedAt更新、撤銷全部active super_user及credentials.activated同交易；不撤employee、不輸出fingerprint、不允許startup覆寫。
- [ ] T048 [US4] 在 `server/src/console/auth-console.service.ts` 提供activateCredentials({expectedGeneration})，只啟用已驗格式的本機env，不接受任意帳密參數；沿 `server/src/features/auth/services/session.service.ts` 與super-user-login既有local/active/session三方版本檢查，不另加快取或版本來源。
- [ ] T049 [US4] 執行雙實例、rollback、重啟及再啟用舊設定驗收，於 `specs/027-super-user-access/quickstart.md` 記錄commit生效點與混跑期間維護503限制；不宣稱零中斷或只更新部分實例就完成。

**Checkpoint**: 跨實例撤銷與部署啟用邊界可證明，原員工會話保持。

## Phase 7: Polish & Cross-Cutting Concerns

**Goal**: 完成敏感資料邊界、部署文件及完整驗收，全部故事通過才可交付。

- [ ] T050 在 `server/src/framework/http/request.context.ts`、`server/src/framework/interceptors/http-access-log.interceptor.ts`、`server/src/infrastructure/logging/logHelper/log-masker.ts` 及其 `.spec.ts` 遮罩維護路徑、排除raw URL/query/body/Referer/Set-Cookie，涵蓋成功/404/guard/429/exception；不能只改getRequestPath卻留下safeUrl原值，不恢復簽署事件鏈。
- [ ] T051 在 `client/next.config.ts` 與 `docs/deployment/uat-cicd.md` 配置／記錄Next和反向代理raw access/error log遮罩或關閉方式，驗證HTTP/RSC/SSR錯誤；倉庫外代理尚未套用時明列部署阻擋，不把Nest遮罩視為全鏈通過。
- [ ] T052 更新 `server/.env.example`、`server/README.md`、`client/README.md`、`docs/deployment/uat-cicd.md` 及必要 `server/AGENTS.md`／`client/AGENTS.md`：兩server-only設定、hash/REPL、啟用生效／停機migration／回復程序、actor邊界與028前403；修改agent文件前依writing-for-agents技能，不提交secret或改成全站旁路。
- [X] T053 在受保護隔離庫驗schema apply/down/reapply及有維護資料拒絕down，透過schema:dump更新 `server/src/infrastructure/database/schema.sql`，核對entity/index/CHECK/FK與舊users/文件關聯，將結果記於 `specs/027-super-user-access/quickstart.md`；不在UAT或正式庫執行測試。
- [ ] T054 按 `specs/027-super-user-access/quickstart.md` 跑server lint:check/unit/build/e2e/security/schema、client lint/build，再跑root build/lint（注意可能修檔）；驗八小時cookie、iframe、HTML/RSC不露表單、所有log遮罩、雙實例撤銷與REPL副作用；逐項記真實結果／未跑原因，不宣稱client自動測試。
- [ ] T055 對照 `specs/027-super-user-access/contracts/openapi.json`、`contracts/api-behavior.md`、`contracts/operations.md` 與實作，更新 `quickstart.md` 交付摘要，分列client/server/migration/config及限制；確認沒有角色表、管理UI、OAuth前端、029選單或028業務放行混入027。

## Dependencies & Execution Order

- Setup T001～T003 → Foundational T004～T016 → US1 T017～T028。
- US2 T029～T036 與 US3 T037～T044 都以US1及共同基礎完成為前置，可在不同檔案上分工；共享auth/module／fixtures的修改必須序列整合。
- US4 T045～T049 依賴US1登入與US3完整REPL；US2可並行完成，但正式交付須四個故事全部通過。
- Polish T050～T055 全部完成後交付。敏感log遮罩可提前做，不等最後才驗是否洩漏，但不得和US1同檔同時修改。
- initialize/currentEntry/credentialStatus與窄REPL已放共同基礎，不存在US1依賴US3又US3依賴US1的循環。
- 每故事先寫行為測試並確認預期失敗，再實作與整合；同檔案有修改依賴時不得因[P]標示強行平行。

### Parallel Examples

- Foundational：T004 schema、T005 password/config、T006 session測試可平行；entities→migration→repository→service依序整合。
- US1：T017 API e2e、T018登入service、T019 guard/cookie測試分檔可平行；契約固定後client/server分工，最後一起驗收。
- US2：T029替換e2e與T030既有登入回歸可平行；OAuth/WebView接線依同一SessionService契約。
- US3：T037週期單元與T038整合可平行；worker與console分別遵守組合邊界。
- US4：T045雙實例e2e與T046 CAS單元可平行；T047完成後接T048。

## Implementation Strategy

最小可展示切片為Setup＋Foundational＋US1：可透過真正REPL初始化，使用隱藏頁登入／登出。但只可隔離展示；正式交付必須完成US2員工入口相容、US3週輪換、US4撤銷及Polish，不把未輪換或尚有員工帳密旁路的版本稱為完成。

每故事完成即用Independent Test檢查，不任意擴張到028授權或029選單。Tasks生成本身不執行程式變更、migration或真實secret操作。

## Requirement Coverage

| 規格需求 | 任務範圍 |
|---|---|
| FR-001 員工兩入口／移除帳密 | T029～T036 |
| FR-002／003 唯一維護帳號、hash與限流 | T005/T011/T020/T021/T027/T045～T049 |
| FR-004 有效入口與提交防護 | T017～T025/T038～T040/T050～T051 |
| FR-005 原子替換與登出 | T006/T014/T020/T029～T036 |
| FR-006／014 actor及業務隔離 | T007/T014/T019/T022/T026/T034 |
| FR-007／008 入口持久與週輪換 | T008/T010/T015～T016/T037～T044 |
| FR-009 網址不撤／帳密撤session | T038～T040/T045～T049 |
| FR-010／011 REPL與無副作用 | T015～T016/T038/T042～T043/T048 |
| FR-012 安全事件與最小揭露 | T009/T012～T013/T020/T039/T047/T050～T051 |
| FR-013 前端登入／身分／登出 | T023～T028/T034～T036 |

## Notes

- `.specify/extensions.yml` 不存在，無pre_tasks／after_tasks hooks。
- setup-tasks使用顯式027路徑與 `SPECIFY_FEATURE_NO_PERSIST=1`；不修改共用feature指標或分支。
- entity／DTO任務直接列出型別、nullable、長度、枚舉與CHECK約束；完整對照以data-model與contracts為準。
- 不假造員工、不提前實作028全權限、不恢復026簽署歷程。持有隱藏網址只代表知道入口，不授予任何業務權限。
