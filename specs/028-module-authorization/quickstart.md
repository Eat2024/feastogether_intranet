# 028 驗證指南

本文件描述實作後的驗收程序；目前僅有設計文件，尚未建立授權API或執行以下業務驗收。

## 前置

完成027 actor／session與REPL；準備隔離MySQL、Redis、測試儲存與Portal測試資料。依既有.env.example設定本機環境，不提交secret。至少準備兩個部門、無額外角色員工、建立者、管理員、已停用員工、未登入員工與Super user；另以測試catalog提供第二子功能，不寫入正式目錄。

在repository root執行既有指令：

```bash
pnpm install
pnpm -C server db:test:create
pnpm -C server test:schema
pnpm -C server test -- --runInBand
pnpm -C server test:e2e
pnpm -C server lint:check
pnpm -C server build
```

若實作包含本plan要求的client型別／列表呼叫相容，再執行`pnpm build`與`pnpm lint`。手動流程以`pnpm dev`啟動現有HTTP、worker與client。開發資料庫migration用`pnpm -C server migration:run`；不可直接對正式庫試驗。REPL啟動沿027實作完成的指令，helper見[operations.md](contracts/operations.md)，不預造尚不存在的package script。

## 驗收順序

1. **Schema與seed（US2、US5／SC-001、006）**：up、重跑seed，確認一般角色自訂設定不被覆寫，員工及簽署FK／證據摘要保持。直接向MySQL送跨module的role_permission／user_role須被複合FK拒絕；並發同module同名create只有一筆成功，不同module同名可成立。soft-delete後可重用名稱但不能重用舊roleCode。驗證actor CHECK拒絕Super帶employee ID或employee缺ID。down於沒有Super資料時可回復，有Super資料時安全拒絕破壞性回退。
2. **同仁（US1／SC-002）**：OAuth及WebView新／舊session查`GET /api/me/authorization`都取得baseline；GET前後DB關聯筆數不變。同部門各既有可見狀態列表、detail、原始PDF允許；建立、一般匯出及歷史／下載拒絕。本人跨部門簽署／副本仍依本人規則；本地停用即拒絕，缺部門不影響另行判斷的本人資格。
3. **角色隔離與聯集（US2／SC-001、003）**：兩個角色互補能力、重複能力，撤掉其中一個不抹去另一個。第二module同名角色無法授予esign能力。角色停用／permission修改／撤指派提交後，保留原session對兩個HTTP實例發下一請求皆用新權限。無Redis權限快取或前端能力值可繞過。
4. **管理交易（US3／SC-004）**：只有Super或027維護context可管理；一般員工／esign管理員取得403。API和REPL各自建立角色、配權限、預指派未登入有效員工、撤銷，結果與稽核一致。競爭首次登入／預建檔只有同一users ID；同角色版本衝突409，指派CAS衝突409，audit失敗全部回滾。停用角色保留指派，使用中刪除409。所有同仁CRUD／permission修改／撤除企圖拒絕。
5. **員編失敗**：不存在、無效、模糊匹配的目標回422 AUTHORIZATION_EMPLOYEE_INELIGIBLE，Super session維持登入；Portal故障502且不fallback；本地disabled回403 ACCOUNT_DISABLED且不復活。只有操作者自身session無效回401。檢查錯誤及log無原始Portal內容／員編。
6. **電子簽管理與actor（US4／SC-005）**：一般建立者只能合法管理自己的文件；管理員／Super可跨部門處理他人合法狀態文件，不能改原creator／department。Super建立必填有效departmentCode，employee不能覆寫部門；完成上傳、欄位、簽署人編輯、發起、worker、通知與一般匯出，所有actor CHECK、mapper及檔名正常。worker記錄真正發起者而非文件creator；既有client列表super送all、員工送dep，顯示Super user且不出現undefined／假員編。
7. **不可繞過的邊界**：管理者／Super代簽、代拒簽、他人個人副本、departmentFile與pdf歷史下載旁路全部拒絕；完整文件的一般ZIP／Excel匯出在能力與範圍合法時允許。停止／完成狀態的非法改寫仍拒絕；外部邀請、OTP、公開驗證與簽名證據回歸不變。撤權前已受理job可完成，但撤權後poll／retry／download重驗並拒絕。
8. **029契約與端點覆蓋**：本人能力response符合OpenAPI，actor沿027 union、module／permissions排序，無role完整資料或憑證；Cache-Control:no-store。以路由清單比對[permissions.md](contracts/permissions.md)，每個非公開endpoint均有auth-only或能力分類；HTTP以實際請求確認非只metadata存在。029三選單key一致，403不觸發登出。
9. **導入演練（US5／SC-006）**：依operations停流量切換，只有同仁自動生效，核定額外指派全數核對；沒有歷史行為升權。重跑seed／指派不重複關聯。測試readiness拒絕缺目錄，備份／回復策略能保護Super資料與既有證據。

成功標準為spec全部SC；將執行命令、結果與無法驗證的環境限制記錄於實作交付，不以文件或mock替代真MySQL／worker證明。


## 028-01 實作盤點（2026-11-06）

範圍以實際 Nest controller 裝飾器逐一列出；下表能力省略 `esign.` 前綴，測試名稱位於 `server/test/*.e2e-spec.ts`（作為既有回歸參考；新增 028 矩陣驗收由對應後續票負責）。這是入口盤點，不代表能力 guard 已啟用。前端 mock 簽到表不列入正式功能。

| 方法／實際路徑 | 規格要求能力或公開例外 | 既有回歸測試 | 後續任務 |
| --- | --- | --- | --- |
| GET `/api/esign/documents` | document.read | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| POST `/api/esign/documents` | document.create | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| GET `/api/esign/documents/:documentId` | document.read；view=export 改驗 export.read | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| PATCH `/api/esign/documents/:documentId` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| DELETE `/api/esign/documents/:documentId` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| PUT `/api/esign/documents/:documentId/draftSave` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| PATCH `/api/esign/documents/:documentId/draft-settings` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| PUT `/api/esign/documents/:documentId/fields` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| POST `/api/esign/documents/:documentId/initiations` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| POST `/api/esign/documents/:documentId/reopenings` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| GET `/api/esign/documents/:documentId/reopening-invitations` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| GET `/api/esign/documents/:documentId/source-file` | document.read | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| POST `/api/esign/documents/:documentId/stoppages` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| PATCH `/api/esign/documents/:documentId/signers/:signerPublicId/note` | document.manage | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| POST `/api/esign/documents/:documentId/signers/:signerPublicId/completed-file/downloads` | signing.copy（本人） | security-esign-department、core-esign-flow、esign-initiation-acceptance、esign-initiation-query | T016–T019、T035–T047 |
| GET `/api/esign/history/export` | export.read；pdf 另驗本人 | esign-export-history、internal-email-copy | T016、T018–T019、T048–T051 |
| POST `/api/esign/history/export` | export.create | esign-export-history、internal-email-copy | T016、T018–T019、T048–T051 |
| GET `/api/esign/history/export/:id/document` | export.read；pdf 另驗本人 | esign-export-history、internal-email-copy | T016、T018–T019、T048–T051 |
| POST `/api/esign/history/export/:id/downloads` | export.read；pdf 另驗本人 | esign-export-history、internal-email-copy | T016、T018–T019、T048–T051 |
| POST `/api/esign/documents/:documentId/export-downloads` | export.read／export.create（實際分支） | esign-export、security-esign-department | T016、T048–T051 |
| GET `/api/esign/exportable-documents` | export.read | esign-export、security-esign-department | T016、T048–T051 |
| POST `/api/esign/documents/:documentId/exports` | export.create | esign-export、security-esign-department | T016、T048–T051 |
| GET `/api/esign/documents/:documentId/exports/:exportId` | export.read | esign-export、security-esign-department | T016、T048–T051 |
| POST `/api/esign/documents/:documentId/exports/:exportId/retries` | export.create | esign-export、security-esign-department | T016、T048–T051 |
| GET `/api/esign/documents/:documentId/exports/:exportId/files/:fileId` | export.read | esign-export、security-esign-department | T016、T048–T051 |
| POST `/api/external-signing-task/rejection` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| GET `/api/external-signature-invitations/:token` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| POST `/api/external-signature-otps` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| POST `/api/external-signature-session` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| DELETE `/api/external-signature-session` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| POST `/api/external-signing-task` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| GET `/api/external-signing-task` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| GET `/api/external-signing-task/source-file` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| POST `/api/external-signing-task/signatures` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| POST `/api/external-signing-task/completed-file/downloads` | Public（現有入口自驗） | esign-document-delivery-security、internal-email-copy | T057–T059（保留公開憑證邊界） |
| POST `/api/esign/documents/:documentId/initiation-jobs/:jobId/retries` | document.manage | esign-initiation-acceptance、esign-initiation-query | T016、T043–T047 |
| GET `/api/esign/documents/:documentId/initiation-jobs/latest` | document.manage | esign-initiation-acceptance、esign-initiation-query | T016、T043–T047 |
| GET `/api/esign/documents/:documentId/initiation-jobs/:jobId/issues` | document.manage | esign-initiation-acceptance、esign-initiation-query | T016、T043–T047 |
| GET `/api/esign/documents/:documentId/initiation-jobs/:jobId/input` | document.manage | esign-initiation-acceptance、esign-initiation-query | T016、T043–T047 |
| GET `/api/esign/documents/:documentId/initiation-jobs/:jobId` | document.manage | esign-initiation-acceptance、esign-initiation-query | T016、T043–T047 |
| POST `/api/esign/documents/:documentId/notification-batches` | document.manage | internal-group-reminders、esign-reminders | T016、T043–T047 |
| GET `/api/esign/documents/:documentId/notification-batches` | document.manage | internal-group-reminders、esign-reminders | T016、T043–T047 |
| GET `/api/esign/documents/:documentId/notification-batches/:batchId` | document.manage | internal-group-reminders、esign-reminders | T016、T043–T047 |
| GET `/api/signature-verifications/*` | Public（現有入口自驗） | security-signature-verification | T057–T059（保留唯讀公開驗證） |
| GET `/api/esign/signer-candidates/org-chart` | document.create OR document.manage | esign-candidate-resolution、org-chart | T016 |
| POST `/api/esign/signer-candidates/resolutions` | document.create OR document.manage | esign-candidate-resolution、org-chart | T016 |
| GET `/api/esign/signer-candidates` | document.create OR document.manage | esign-candidate-resolution、org-chart | T016 |
| POST `/api/esign/signing-tasks/:signerPublicId/rejection` | signing.submit | internal-portal-signing、internal-portal-completion | T016、T018–T019 |
| GET `/api/esign/signing-tasks` | signing.read | internal-portal-signing、internal-portal-completion | T016、T018–T019 |
| POST `/api/esign/signing-tasks/:signerPublicId` | signing.read | internal-portal-signing、internal-portal-completion | T016、T018–T019 |
| GET `/api/esign/signing-tasks/:signerPublicId/source-file` | signing.read | internal-portal-signing、internal-portal-completion | T016、T018–T019 |
| POST `/api/esign/signing-tasks/:signerPublicId/signatures` | signing.submit | internal-portal-signing、internal-portal-completion | T016、T018–T019 |
| POST `/api/esign/signing-tasks/:signerPublicId/completed-file/downloads` | signing.copy | internal-portal-signing、internal-portal-completion | T016、T018–T019 |

027 接縫：`AuthGuard` 先驗 opaque session 與 actor；目前只有明確 `AllowSuperUser` 入口能使用維護身分，未完成 028 actor 相容的業務入口維持拒絕。`CurrentActor` 與 `actor.context.ts` 是後續服務接點，不能把 Super 轉成假員工。HTTP 寫入沿現有 Origin guard。

console 以 `ConsoleModule`、`createAuthConsole` 的窄 context 為基礎；本票新增 `createAuthorizationConsole` 暴露 `authz.syncCatalog()` 閉包。每次同步先讀 active generation，再於同交易鎖 singleton 重驗 generation／本機 fingerprint；沒有啟動初始化或 HTTP／worker／Portal／Redis／mail／storage 連線模組。`AuthorizationCatalogService.assertReady()` 僅讀，缺失或不相容回 503，不修補資料。

持久接點：`AuthorizationRepository` 以 manager 傳入，roles／permissions 集合查詢可依 ID 升冪鎖定，關聯差異透過 save 撤銷／恢復原列；指派交易後續必先鎖 users、再 roles、permissions、relations。`AuthorizationAuditService` 僅同交易寫白名單，no-op 無事件；本票不恢復文件簽署歷程。


### 028-01 驗證結果與交接

- `pnpm -C server test --runInBand`：126 suites／1282 tests 通過。
- `pnpm -C server test:schema`：7 suites／45 tests 通過，包含空庫 up/down/reapply、完整 schema drift、FK、名稱競爭、兩種關聯還原與有 audit 時拒絕 down。
- `pnpm -C server test:e2e:security --testPathPatterns=authorization`：2 suites／10 tests 通過。catalog 服務以真 MySQL `authorization-catalog.e2e-spec.ts` 驗證（取代 mock catalog service 單元），含並發 sync、保護同仁修復、移除權限、保留一般角色自訂、稽核故障 rollback、過期維護設定及真 ConsoleModule helpers。
- `pnpm build`、`pnpm lint` 通過；server 保留 271 個既有 lint warnings，沒有新增 warnings 或 errors。client `test` 4 項與 `check:bundle` 通過。
- schema 快照由獨立空測試庫套全部 migrations 後，以專案 `dump-schema.ts` 產生，只有五張授權表增量。舊 schema 測試的最新版本、表數／時間欄數／CHECK 清單已更新；027 歷史回填測試固定在其 migration／entity 版本，不因後續表增加而改變測試意義。
- 測試使用獨立 MySQL 8.4 容器 `intranet-spec028-mysql`（loopback 13328）與 `feastogether_intranet_test_a*`；沒有寫入開發／UAT／正式 DB。既有 `.env.test` 連線認證失敗後改用此隔離環境，未修改已追蹤設定或新增環境變數。
- T010 所需 `AUTHORIZATION_UNAVAILABLE` 已提前同步 server／client；其餘 T012 錯誤由 028-02 補齊。HTTP 授權 guards、角色管理 API、業務 actor、正式切換仍屬後續 tickets，這一票不代表 028 已上線。未執行全套業務 e2e 或正式 Portal 連線；本票沒有改既有業務控制器行為。


## 028-02 本人能力與即時聯集（2026-11-07）

完成 T011～T015、T020～T023、T053。`GET /api/me/authorization` 沿真實 MySQL session 回最小 actor union 與排序去重 modules/permissions，成功回應 `Cache-Control: no-store`。所有有效員工固定疊四項同仁能力，缺部門不影響本人能力查詢；一般有效角色採集合 JOIN，排除停用／刪除／跨 scope／非可指派／未知能力。Super 回 compiled 全集但不具任何員工簽署資格。GET 不建立隱含指派。

### 後續實作接縫

- `AuthorizationModule` 是 HTTP／worker／console 共用核心，沒有 controller、APP_GUARD 或啟動寫入。`AuthorizationHttpModule` 才提供本人能力路由及全域能力 guard；`FeatureModule` 先載入既有 `AuthModule`，正式 AppModule 測試確認先驗 session 再驗能力。
- `RequirePermissions(...keys)` 為 ALL，`RequireAnyPermission(...keys)` 為明確 ANY。兩者不自動放行 Super；業務 actor 相容完成後另標 `AllowSuperUser()`。`AuthenticatedOnly()` 與 `SuperUserOnly()` 明確接受 Super，後者另外驗 actor kind 及平台管理能力。
- `CurrentActor` 位於 `framework/decorators/current-actor.decorator.ts`，只取 `AuthGuard` 已驗證的 request session。
- `AuthorizationService.requirePermissions(actor, keys, manager?, mode='all')` 與 `requireSuperUser(actor, manager?)` 供業務／管理使用。業務交易必須傳本次 manager；resolver 不另換交易，對 user、roles、permissions、relations 採共享 current read，即使 caller 已建立 REPEATABLE READ 舊快照也不能沿用撤權前資料。新業務仍建議 READ COMMITTED。已受理工作是否繼續由工作生命週期處理，不以此取消工作。
- `authz.userPermissions(userId)` 與 HTTP 同 resolver，額外回 `sources.baseline`／`sources.explicit`；明確角色若同樣授予基本能力，兩種來源均保留。讀取不 sync、不連 Portal、不輸出角色、員編或憑證。
- 本次補齊 server/client 授權錯誤碼；既有前端仍只有401觸發過期提示，不將403或目標422視為失效登入。

**切換邊界**：本票只提供能力查詢與明確宣告入口的能力檢查。尚未宣告的既有電子簽入口仍由027 AuthGuard保護，Super仍403；此過渡不代表028完整上線。T016接入全業務矩陣、T054/T057完成全路由readiness後才允許切換，禁止把缺宣告的過渡行為當永久例外。

### 驗證與環境

- 單元 `pnpm -C server test --runInBand`：127 suites／1285 tests 通過。
- 新授權HTTP／catalog／revocation整合：baseline3、revocation2、catalog5 共10項通過；另既有authorization-schema6項證明FK與scope拒絕。HTTP涵蓋OAuth/WebView來源的既有真session（非重新測登入入口）、停用／刪除、無部門、Super裁切、no-store、資料庫查詢故障503、正式AppModule guard順序及未相容Super業務403。
- 兩個獨立 DataSource pool 與 Fastify instance 共用DB，同一舊cookie在角色停用／軟刪除、permission改動、撤指派提交後立即採最新能力；重複grant撤一仍保留。另先建立RR舊快照再撤權，交易內requirePermissions仍拒絕。角色異動目前以fixtures執行；028-05/T034與最終整合需再以正式管理API路徑覆驗。
- root `pnpm build`、`pnpm lint`、`pnpm -C client test`（4項）與 `pnpm -C client check:bundle` 通過；lint仍為原有271 warnings、0 errors。
- 全security首跑22/24 suites、183/188 tests通過；舊department suite遭主機暫停期間5秒hook逾時，定向重跑4項通過。另舊external copy expired fixture混用host與Docker MySQL時鐘（實測差約4分14秒）違反既有sign_period CHECK；只改測試到期值為與建立時相同的應用程式時鐘，未改正式期限或CHECK。兩失敗suite定向重跑19/19通過；修正後全security重跑24 suites／188 tests全數通過（39秒）。
- 測試使用隔離Docker MySQL 8.4 `intranet-spec028-mysql`（loopback13328），獨立測試庫`feastogether_intranet_test_b`；新增隔離Redis7 `intranet-spec028-redis`（loopback16328），本票使用DB2。連線只在ignored `.env.test`，沒有新增正式env、dependency、cookie或排程。後續worktree須使用不同DB，勿共用清理中的fixtures。

未執行正式Portal/UAT/正式部署或核定名單指派；本票沒有新增migration或變更文件／簽署證據。028-03～09仍待完成。


## 028-03 同仁入口與本人資格（2026-11-07）

- 完成 T016–T019。documents、signing-tasks、candidates、initiation-jobs、notification-batches、exports、export-history 全部內部入口宣告能力。`view=export` 驗 export.read；`export-downloads` 在 service 依 Excel／ZIP 驗 export.create／export.read，controller any-of 不能單獨授權。未完成 actor 改造的 Super 入口繼續403。
- 基本同部門閱讀維持敏感欄位裁切、來源檔與不可見404；缺 export.read 時詳情 canExport=false 且不回 exportSummary。本人簽署／拒簽／副本不以部門為資格，文件 completed-file 及 pdf history 必須是指派本人；pdf history 同時仍需 export.read。管理員／Super 不具代簽或取他人個人副本資格。
- `authorization-colleague-boundaries.e2e-spec.ts` 使用真 AppModule、MySQL、Redis 驗 OAuth／WebView session、34受限入口、分支能力、跨部門／缺部門本人及他人副本／代簽負例。既有 internal portal／email／department／delivery security 套件覆蓋實際簽署、來源 PDF、worker 副本、證據與外部憑證隔離。
- `security-e2e.helper.ts` 明確 seed 測試目錄；`authorization-business-fixtures.ts` 只在各測試明確呼叫時授 document_creator。employeeSessionCookie 不升權。seed 若暫建 Super singleton，完成僅刪自己的 singleton，保留既有授權事件。這些均不是正式啟動副作用。
- server build、lint（0 errors；既有271 warnings）、unit 127 suites／1285 tests 通過。完整 security 25 suites／191 tests 通過（使用 `caffeinate -i pnpm -C server test:e2e:security` 防主機休眠；前兩輪分別遇固定port衝突及主機長時間暫停，未放寬timeout或正式規則）。
- 交接後續 tickets：一般文件／匯出 actor 改造屬06–08；T054 readiness 上線前，未使用 security helper 的舊 AppModule e2e 必須補明確 catalog seed，寫入流程逐一明確授角色。此票未執行全業務 `test:e2e`，不能把 security 回歸視為全業務切換驗收。
