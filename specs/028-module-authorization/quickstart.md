# 028 驗證指南

本文件記錄028已實作的驗收程序與各票實測結果。最終整合紀錄見文末；正式核定名單、停機與部署仍須由維運執行。

## 前置

完成027 actor／session與REPL；準備隔離MySQL、Redis、測試儲存與Portal測試資料。依既有.env.example設定本機環境，不提交secret。至少準備兩個部門、無額外角色員工、建立者、管理員、已停用員工、未登入員工與Super user；另以測試catalog提供第二子功能，不寫入正式目錄。

在repository root執行既有指令：

```bash
pnpm install
pnpm -C server db:test:create
pnpm -C server test:schema
pnpm -C server test --runInBand
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm -C server lint:check
pnpm -C server build
```

若實作包含本plan要求的client型別／列表呼叫相容，再執行`pnpm build`與`pnpm lint`。手動流程以`pnpm dev`啟動現有HTTP、worker與client。開發資料庫migration用`pnpm -C server migration:run`；不可直接對正式庫試驗。REPL啟動沿027實作完成的指令，helper見[operations.md](contracts/operations.md)，不預造尚不存在的package script。

## 驗收順序

1. **Schema與seed（US2、US5／SC-001、006）**：up、重跑seed，確認一般角色自訂設定不被覆寫，員工及簽署FK／證據摘要保持。直接向MySQL送跨module的role_permission／user_role須被複合FK拒絕；並發同module同名create只有一筆成功，不同module同名可成立。soft-delete後可重用名稱但不能重用舊roleCode。驗證actor CHECK拒絕Super帶employee ID或employee缺ID。down只允許沒有需保留資料的空測試庫；存在授權audit或Super資料時安全拒絕破壞性回退。
2. **同仁（US1／SC-002）**：OAuth及WebView新／舊session查`GET /api/auth/me`都取得 session 白名單資料與 baseline；GET前後DB關聯筆數不變。同部門各既有可見狀態列表、detail、原始PDF允許；建立、一般匯出及歷史／下載拒絕。本人跨部門簽署／副本仍依本人規則；本地停用即拒絕，缺部門不影響另行判斷的本人資格。
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

完成 T011～T015、T020～T023、T053。`GET /api/auth/me` 沿真實 MySQL session 回 actor／白名單 user／expiresAt 與排序去重 modules/permissions，成功回應 `Cache-Control: no-store`，且不回任何角色資料；舊 `/api/me/authorization` 已移除。所有有效員工固定疊四項同仁能力，缺部門不影響本人能力查詢；一般有效角色採集合 JOIN，排除停用／刪除／跨 scope／非可指派／未知能力。Super 回 compiled 全集但不具任何員工簽署資格。GET 不建立隱含指派。

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


## 028-04：Super 角色／權限管理與稽核（2026-11-07）

T024、T026～T028、T032、T033 已實作。管理API只有有效Super可用，寫入必驗Origin；未帶Origin與跨站請求拒絕。以下REPL操作使用同一服務及DTO，不直接暴露repository：

```js
await authz.modules()
await authz.permissions('esign')
const role = await authz.createRole('esign', { roleName: '合成驗收角色' })
await authz.rolePermissions('esign', role.id)
await authz.roles('esign', { limit: 20 })
const granted = await authz.setRolePermissions('esign', role.id, {
  permissionKeys: ['esign.document.read', 'esign.document.read-all'],
  expectedVersion: role.version,
})
const disabled = await authz.updateRole('esign', role.id, {
  isActive: false, expectedVersion: granted.version,
})
await authz.events({ moduleKey: 'esign', limit: 20 })
await authz.deleteRole('esign', role.id, disabled.version)
```

角色ID為字串；`expectedVersion`為正整數。仍有有效指派時刪除回409；停用可保留關聯。protected同仁不能修改，platform無可指派權限不能建立一般角色。HTTP和REPL拒絕相同的未知欄位／非法輸入；body/query/path由共用DTO邊界驗證，400使用契約 `REQUEST_FORMAT_INVALID`，保留其他feature既有 `INVALID_REQUEST`。管理API成功回應no-store，access log不保存管理body/query，audit只保存角色設定與權限差異。

### 後續028-05接縫

- `AuthorizationManagementService.read(context, run)`提供唯讀資格／catalog檢查與安全DB錯誤映射；`transaction(context, run)`開READ COMMITTED交易並先鎖維護singleton、重核fingerprint與active generation。HTTP context由可信Actor產生，console閉包固定source=repl，不接受caller指定actor。
- 固定鎖序：singleton → users（涉及指派時）→ roles ID升序 → permissions ID升序 → relations。角色服務先取roles排他鎖再進catalog current read；不要先取所有角色shared鎖再升排他。管理寫入與sync共鎖singleton，仍須依序鎖實際資料列並執行CAS。
- `AuthorizationRoleService`提供modules／permissions／list／detail／create／update／setPermissions／delete。`AuthorizationEventService.list`產出OpenAPI白名單與cursor；沒有稽核修改或刪除入口。
- `dto/assignment.dto.ts`與`authorization-query.dto.ts`提供員編原樣、兩個最多50角色ID集合、安全ID解析、module／page驗證。assignment服務沿相同transaction邊界並先鎖user，不可反向取得user鎖。
- `createAuthorizationConsole`只回傳函式閉包。AuthorizationModule仍是窄核心，不啟HTTP、Redis、worker、mail或儲存；本票未新增Portal依賴。

### 已執行驗證及限制

- `pnpm -C server test --runInBand`：128 suites／1289 tests通過。
- `pnpm -C server test:e2e:security --runTestsByPath test/authorization-role-management.e2e-spec.ts test/authorization-catalog.e2e-spec.ts test/authorization-baseline.e2e-spec.ts test/authorization-revocation.e2e-spec.ts`：4 suites／15 tests通過。
- server build／lint:check、root build／lint、client test（4項）／check:bundle通過；271既有warnings、0 errors。
- `caffeinate -i pnpm -C server test:e2e:security`：25 suites／193 tests全部通過（47.865秒）。先前主機休眠造成多次120秒逾時（整套記370／2733秒），已透過防休眠、錯開測試port後完整重跑收斂；沒有修改timeout或正式規則。不同worktree的DB/Redis雖隔離，既有credential測試使用固定3030/3031，因此全套不可並行。
- 無migration／新環境變數／dependency／管理前端；本票完成不代表完整028可以正式切換。


## 028-05：員工預指派、CAS 與即時撤權（2026-11-07）

T025、T029～T031、T034 已完成。管理介面新增：

- `POST /api/authorization/modules/:moduleKey/employee-role-assignments`：員編僅由 body 傳入，查 Portal 唯一且有效的 exact-match，再原子預建／取得同一員工與覆寫一般角色集合。
- `GET /api/authorization/modules/:moduleKey/employees/:userId/roles`：只回 userId／moduleKey／roleIds／implicitRoles；同仁不混進可修改的 roleIds。
- `GET /api/authorization/modules/:moduleKey/roles/:roleId/employees`：倒序本地 userId cursor 分頁，成員只回 userId／name，預設20、最多100。

REPL 透過同一服務，不暴露 repository；下面只使用合成示例員編，正式必須依核定名單替換，名單不得入 repository：

```js
const { items } = await authz.roles('esign')
const creator = items.find(role => role.roleCode === 'document_creator')
const assigned = await authz.assignRoles('esign', {
  empId: 'SYNTHETIC028', roleIds: [creator.id], expectedRoleIds: [],
})
await authz.employeeRoles('esign', assigned.userId)
await authz.roleEmployees('esign', creator.id, { limit: 20 })
await authz.userPermissions(Number(assigned.userId))
await authz.assignRoles('esign', {
  empId: 'SYNTHETIC028', roleIds: [], expectedRoleIds: assigned.roleIds,
})
```

`empId`原樣查核，不 trim／轉數字；Portal的大小寫／尾空白候選仍需 exact-match。本地 empid unique key 命中後也必須字元相同，不自動改員編。預建不偽造登入時間，不更新既有員工資料。來源不存在／無效／模糊回422，Portal故障502；本地inactive／deleted回403且不復活，目標錯誤不清除管理者cookie。

指派以 singleton → user → roles ID → permissions ID → relations 鎖序，使用READ COMMITTED及CAS；已是相同目標時冪等成功。初次預建即使目標空集合仍保存一次建檔audit（changed=true），後續相同請求no-op。重授恢復原關聯列，不插入重複關聯。新增user、角色關聯與audit同交易，任一失敗全部回滾；不從歷史文件推導額外權限。

`AuthorizationModule`沿用lazy Portal provider。Console不啟HTTP／worker／Redis／mail／storage，Portal設定缺漏不影響啟動、唯讀授權或syncCatalog；只在assignRoles查上游。所有成功與錯誤結果沿相同API/REPL業務邊界。

### 已執行驗證及後續交接

- 新增assignment與management-concurrency兩套真MySQL／合成Portal測試，共7項。包含正式AppModule、API／REPL、一致錯誤、cursor、首次登入競態、刪role對指派、CAS、稽核故障新user回滾及兩獨立pool舊session即時撤權。
- `pnpm -C server build`、unit 128 suites／1289 tests、root lint通過。
- `caffeinate -i pnpm -C server test:e2e:security`：28 suites／203 tests通過（69.4秒）。首輪202／203，唯一舊測試禁止PortalModule，已改驗lazy連線行為後全套通過，沒有放寬正式授權或timeout。
- 無前端／migration／正式env／dependency變更。只用隔離Docker MySQL與測試庫`feastogether_intranet_test_e`、Redis DB5；未連正式Portal／部署／配置真實核定名單。全業務e2e及完整切換由028-09驗收。


## 028-06 文件管理與 actor 交接

- 文件建立、標題/PDF/欄位、草稿簽署人設定、簽署人備註及刪除已接 `CurrentActor`，寫入交易重核目前 create/manage，只有 read-all/manage-all 放寬跨部門範圍。尚未遷移的 lifecycle/export 端點仍拒絕 Super，由 07/08 接續。
- 新 async policy：`readableForActor`、`manageableDocument`、`canManageDocument`、`assertManagerNotInitiating`、`lockManagedDocument`、`lockManagedDraft`；全部接受真 Actor 與呼叫端 manager。交易外快拒忙碌不得取悲觀鎖，交易內先完成授權 current read 再鎖文件。舊 numeric lifecycle policy 暫保留，07 不可漏 await 或把 creator 當目前操作者。
- `prepareSigners`、`updateSigners`、`buildFields` 共用介面改 Actor；`actorAudit` 只供新增欄位/簽署人，`markDocumentUpdated` 只改最後管理 actor，保留原 creator/department。signer.user_id 仍是被指定簽署人。07 worker 必須使用 job actor；08 需要將 detail 的 canExport 與 exportSummary 改為 actor-aware，目前仍只支持員工匯出。
- 詳情以 `canManage` 辨識管理 DTO，`isCreator` 保留員工本人建立語意；非建立人管理員是 false/true，失去 manage 的建立人是 true/false。必要既有 client caller 改用 canManage，列表 Super 送 all、員工送 dep，沒有新增管理 UI。
- `EsignDocumentActors1793923201000` 與 schema.sql 新增局部 actor CHECK、nullable FK；歷史有員工回填 employee，欄位/簽署人空 slot 為 legacy_unknown，document 最後管理者維持 NULL。沒有改共用 UserAuditableEntity，Department subscriber 行為不變。新 HTTP 寫入由 CLS actor 覆蓋，禁止新 legacy_unknown。既有欄位/簽署人的單獨新增若無 HTTP context 為 system，已受理 worker 應明確傳 actor。
- Super 建立只接受 Portal 唯一有效部門原碼（1–50 字元、exact-match），不接受 UI 名稱。無效 400、Portal 查核失敗 503；員工覆寫部門 400。沒有新增環境變數或假員工。
- 空庫可 down/reapply；存在 Super 業務 actor、document 最後管理 metadata 或 audit_logs 資料時拒絕 down，採前向修復或一致備份復原。027 schema 測試固定舊 migration，其 auth drift 與最新完整 schema drift 分開驗證。


- 簽署人候選清單／組織樹／resolutions 已明確開放 Super，但維持 create/manage any-of、最小欄位與 Origin 規則；沒有以 actor 改造繞過候選人資料裁切。


### 028-06 驗證紀錄（整合 46f9163 後）

- server unit 128 suites／1309 tests、root `pnpm build`、root `pnpm lint`、client `test`（4項）及 `check:bundle` 通過。lint為271既有warnings、0errors。schema.sql由隔離測試庫套migration後dump，沒有新增正式env或依賴。
- 完整security初版27 suites／196 tests全綠。備註與候選人入口另完成真HTTP紅→綠；整合04/05後完整security 28/30 suites、206/208 tests，完整schema 6/8 suites、45/47 tests；僅catalog/document-management及schema-migration/authorization-schema各一項遭主機兩次約1000秒暫停而超時，無業務assertion錯誤。`caffeinate -i`未完全阻擋該環境暫停，沒有放寬測試timeout或正式規則。
- 改以process-scoped `caffeinate -is`定向重跑受影響套件：security 2 suites／8 tests、schema 2 suites／19 tests全綠。其餘套件保留完整執行通過證據；不宣稱合併後曾有單次完整綠燈，09最終整合統一回歸。
- 文件actor MySQL案例涵蓋NULL-aware CHECK、歷史employee/legacy_unknown回填、document未知最後actor、不可變雜湊/簽署證據保留、up/down/reapply與受保護資料拒絕down。HTTP涵蓋create/manage/read-all矩陣、可信部門與員工覆寫拒絕、原creator/department保留、草稿狀態、備註/欄位/簽署人真actor、被指定user_id不變、撤權建立人canManage=false及role=all。
- 隔離MySQL `127.0.0.1:13328`、`feastogether_intranet_test_f*`與Redis測試設定僅存ignored檔；沒有操作正式/UAT資料。07/08尚待生命週期與匯出actor遷移，09 readiness前不能宣稱028全業務已切換。


## 028-07 生命週期 actor 交接

- 發起／重試／停止／補簽／提醒與工作 latest/poll/issues/input、通知詳情及補簽邀請，全數使用真 Actor 並重核當前 manage 與資源範圍；Super 不繞過狀態、期限、busy、通知節流或證據規則。
- `EsignLifecycleActors1793923202000`：initiation job 新 created actor kind，employee 必有 user、Super 必為 NULL；通知新增 employee/super_user/system，歷史有 user 回填 employee、無 user 回填 system。新增 CHECK 與禁止破壞 actor/授權稽核的 down；schema.sql 以新隔離庫真實套用後 dump。
- worker 由持久化 job 建立 actor，沿現有 lease/version/deadline 執行已受理工作；角色撤權不倒退取消，後續 HTTP 一律重新授權。同 job 自動重試／idempotent replay 保留提交者，人工新 job 保存新提交者。佇列只傳 job ID，producer／processor 無須另一份 actor。
- job.createdBy 與通知 requestedBy 回傳 kind、nullable userId、顯示姓名；client types 同步 nullable，既有姓名顯示即可呈現 Super user，沒有新增 UI。系統通知 requestedBy 延用 null。mapper 的文件 actor 顯示沿06介面，生命週期 DTO 不含確認輸入、租約或憑證。
- 管理動作更新最後 actor，原 creator/department 與 signing payload 保留。擴充回歸一併修正 softDeleteDraft：以同一次 SQL 保存 actor 與單調版本，避免未來時間版本倒退。
- 已驗證新 lifecycle 三項（真 HTTP→Bull WorkerModule→poll、撤權、跨 actor 重試）、schema9 suites/48 tests、unit128 suites/1309 tests、root build/lint與client bundle檢查。使用 ignored 測試庫 g／Redis DB7，沒有新 env、dependency、正式資料或部署。完整security32 suites/212 tests全綠（135.3秒），既有initiation鎖／續租／retry／完整性合計48項分輪通過；client test4項通過。08匯出與09最終切換仍需接續。


## 028-08 一般匯出與本人副本交接

- 一般 Excel／ZIP 使用真 `Actor`；`export.read` 用於來源／工作／歷史／既有檔下載，`export.create` 用於新產生與 retry，`export.all` 只擴大各 base 能力的資料範圍，不能單獨使用。Excel／ZIP 準備分支分別驗 create／read；檔名寫入亦在交易內重驗 read 與範圍。
- `exportScope`／`exportDocument` 統一範圍判斷，預設可信員工部門、all 可跨部門；文件 export view、detail.canExport/exportSummary 同樣依目前 actor 判斷。Super 使用一般匯出，不冒用文件建立人。
- `EsignExportActors1793923203000` 回填有員工為 employee、無員工且 pdf/signer 非空為 external_signer；NULL-aware CHECK 限 Excel/ZIP 為 employee+user 或 super_user+NULL，PDF 為 employee+user 或 external_signer+NULL 且 signer 非空。匯出 user FK 保持 nullable，欄位註解同步。已有 Super 匯出或授權稽核時禁止 down，採前向修復。
- Worker 保留受理時的 actor，已受理工作繼續處理；poll/retry/download 重新驗目前 actor。DTO 與 client 型別加入 exportedBy.kind；Super 姓名為 Super user，employeeNo/email 為 null。本人 PDF 歷史下載維持內部指派本人條件，Super/他人無旁路，外部 OTP/session 規則未擴權。
- 真 HTTP 紅→綠包含 read/create/all 分離及 all-only 拒絕、Super Excel、跨部門來源、撤權舊會話、真 Worker finalization/ZIP、HTTP ZIP SHA256 完整性與檔名、本人 PDF/Super/他人拒絕。歷史 seed 依新 actor 契約修正，舊 schema 測試用 migration 界線隔離。

### 028-08 驗證紀錄（整合 73f18f8 後）

- 核心 server unit 128 suites／1309 tests、root build/lint、client test（4項）及 check:bundle 通過；合 07 後 root build/client test/bundle 再驗通過。最後提交 hook 重跑整合 lint/unit。
- 真 HTTP/worker 定向 6 suites／23 tests 全綠。完整 security 首輪 28/31 suites、202/211 tests，失敗僅舊外部 PDF seed 與舊 migration rollback 界線；整合 07 revertAfter 並補新 actor 後，受影響套件已包含在上述定向全綠。
- 完整 schema 9/10 suites、48/49 tests，唯一舊 schema-constraints 外部 PDF seed 漏 actor；補 explicit external_signer 後定向 1 suite／3 tests 全綠，其餘 9 suites 保留完整通過證據。沒有宣稱本輪單次完整 security/schema 全綠；09 執行最終整合全套。
- 最終 schema.sql 由全新短名隔離庫 feastogether_intranet_test_j 套完 25 migrations 後 dump，相對 07 只新增匯出 actor／CHECK／註解，沒有覆蓋 lifecycle 欄位。長名測試庫曾被安全長度檢查拒絕，已改短名；沒有降低保護。測試設定僅在 ignored 檔，沒有操作正式/UAT資料。


## 028-09 最終切換與驗收

- HTTP 在 `app.init()` 完成／listen 前掃描 DiscoveryService 的完整 controller 方法，拒絕未分類、空能力、未知權限或不合法 runtime metadata。AuthorizationGuard 同時移除暫時放行，啟動後不合法宣告仍503。
- HTTP與worker都精確比對已執行及compiled migration集合（含拒絕未知未來版本）並唯讀核對完整catalog。Worker以async provider於InstanceLoader阻擋，早於BullRegistrar及排程onModuleInit；console不掛gate，可於缺目錄時明確sync。沒有新env、cookie、flag、fallback、排程或DB表。
- `authorization-routes` 擷取Fastify實際註冊77條業務路由，與獨立清單比對，逐路由驗401、同仁缺能力403、公開入口各自HTTP狀態，並驗資源404。框架自動HEAD／OPTIONS與開發Swagger不當成額外業務入口；HEAD沿GET handler。DELETE session沿027 Public＋Origin，匿名／失效cookie可信Origin登出200，非可信Origin403；GET session仍AuthenticatedOnly。
- `authorization-cutover` 以027版本全合成資料做所有表邏輯備份／第二隔離庫還原，向前套25 migrations、重跑migration、兩次sync及合成核定指派。比較user ID、document/signer關聯、證據與舊session；歷史建立者不自動升權、客製角色不覆寫，舊OAuth cookie免重登、下一請求撤權。真實核定名單與正式檔案儲存一致備份仍待維運。
- `authorization-privacy` 以真HTTP、Pino輸出邊界與MySQL audit檢查員編body、cookie、簽名sentinel、Portal raw error皆不外洩；403／目標422後原會話仍有效。既有027隱藏入口與外部簽署憑證回歸另外包含於完整security套件。
- Legacy business e2e明確授予建立者，登入helper本身不升權；PDF歷史正向案例改為實際本人並保留他人404。發起工作授權改用既有瘦投影，維持輕量重播／查詢不讀大型signing payload；原SQL斷言保留。
- 029仍使用 `/forms`→`esign.document.read`、`/my-signature`→`esign.signing.read`、`/export-history`→`esign.export.read`。本人回應沿027 actor union與no-store；管理ID為string，HTTP401實際code為UNAUTHORIZED，403/422不能觸發登出。沒有新增授權管理UI，既有mock forms功能未提升為正式完成。

| 成功標準 | 隔離驗收證據 |
| --- | --- |
| SC-001 | authorization-schema、authorization-revocation、authorization-role-management；第二子功能只存在測試DB |
| SC-002 | authorization-baseline、routes、cutover；全部同仁基線與無歷史升權 |
| SC-003 | authorization-revocation、assignments、lifecycle-actor、exports、cutover；原session下一請求重驗 |
| SC-004 | authorization-role-management、assignments、catalog、privacy；API/REPL共用服務、交易與no-op audit |
| SC-005 | authorization-document-management、lifecycle-actor、exports；真HTTP／Bull worker與本人邊界 |
| SC-006 | authorization-cutover、readiness；合成備份完整還原及合成核定名單驗證，正式核定與切換仍屬外部待辦 |

本次沒有部署UAT／正式環境，沒有使用真實員工名單。FR-018／SC-006的正式名單核定與切換、027代理／CDN／APM日誌遮罩及來源網段前置，必須依[operations](contracts/operations.md)在維護窗口完成，不能以本機測試代替。


### 028-09 最終實測紀錄（2026-11-07）

以 `caffeinate -is` 綁定各驗證程序，使用ignored `.env.test`：隔離MySQL `127.0.0.1:13328`／`feastogether_intranet_test_z*`、Redis `127.0.0.1:16328` DB10。完整e2e、安全、schema依序執行，沒有碰UAT／正式資料。

| 指令／範圍 | 實際結果 |
| --- | --- |
| `pnpm -C server test --runInBand` | 129 suites／1310 tests 通過 |
| `pnpm -C server test:e2e` | 56 suites／569 tests 通過，1組1項既有reconnect專用環境案例依守門條件skip；292.8秒 |
| 專用reconnect驗收 | `DB_MYSQL_DB=feastogether_intranet_test022_reconnect REDIS_PORT=16322 REDIS_DB=9 NODE_ENV=test pnpm -C server test:e2e esign-initiation-reconnect`：1 suite／1 test 通過。真Redis故障注入，暫時容器已移除，沒有降低安全守門條件 |
| `pnpm -C server test:e2e:security` | 修正公開Swagger描述後完整重跑，38 suites／226 tests 通過；136.3秒 |
| `pnpm -C server test:schema` | 10 suites／49 tests 通過；124.9秒，含25 migrations、actor CHECK、FK、歷史資料保留／反向保護與schema drift |
| `pnpm build` | server與client完整build通過；Swagger文字修正後再次完整build通過 |
| `pnpm lint`／server `lint:check` | server 0 errors／271既有warnings，client lint通過。07新增3項warning已收斂，09沒有增加warnings |
| `pnpm -C client test` | 4 tests 通過 |
| `pnpm -C client check:bundle` | 最後build產物檢查通過，公開靜態檔沒有隱藏維護登入痕跡 |
| 建置版Swagger | 直接以dist/AppModule產生63條path文件，description/example/enum掃描隱藏入口提示0命中；actor wire union保留 |

安全首輪37/38 suites、225/226 tests，唯一失敗為08加入的公開Swagger「Super user」說明；保留027原嚴格隱匿測試，改中性說明並確認compiled Swagger，再完整重跑全綠。legacy正向本人PDF、Actor DTO與明確grant已修正，未放寬正式資源政策；輕量重播SQL紅測試保留並修正式投影。FR-001～FR-021對應見[tasks需求覆蓋表](tasks.md#requirements-coverage)及上述SC證據；FR-018／SC-006正式名單與部署前置仍依上一節留待維運，不以合成資料冒充上線。

### 2026-11-07 最終雙軸 review 與重構驗證

- Standards review：硬性違規 0 項；唯一低優先建議為角色／指派服務重複的模組鍵驗證，已收斂至既有 DTO 的 `parseAuthorizationModuleKey()`。Spec review：確認缺陷 0 項。
- 保留原格式驗證、編譯目錄檢查、錯誤碼與驗證順序；純重構沿用既有行為測試，沒有新增抽象層、契約、migration 或設定。
- server build、lint:check 通過（0 errors／271 既有 warnings）；authorization unit 5 suites／9 tests 通過；角色管理、員工指派及管理併發 e2e 3 suites／12 tests 通過。以 `caffeinate -is`、隔離 MySQL `feastogether_intranet_test_l` 與 Redis DB13 驗證。
- 規格 metadata 同步為整合分支及 repository 實作／隔離驗收完成；真實核定名單與正式部署兩項前置維持未完成。
