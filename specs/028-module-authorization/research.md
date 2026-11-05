# Phase 0 Research：多子功能授權

日期：2026-11-04。依本機原始碼及已確認 Spec 027／028 設計；不讀 secrets、不啟動服務、不執行 DB 操作。所有決策都是預計實作。

## R1 — 角色與權限正規化，子功能無動態管理表

**Decision**：新增 authorization_roles、authorization_permissions、authorization_role_permissions、authorization_user_roles、authorization_events；module_key 是程式目錄中的穩定字串，不新增可動態建立子功能的管理表。角色／權限各有 `(module_key,id)` 唯一鍵，關聯帶 module_key 並用兩側複合 FK，資料庫也拒絕跨範圍綁定。

**Rationale**：CKS 單一 role_id 不適用多角色；只在角色加欄位無法保證關聯範圍。權限表是程式目錄的受控投影，管理 API 只可引用，不可自行創造權限。API 與 REPL 同用 service。

**Alternatives**：把所有權限放 JSON 會失去關聯約束；每功能一組獨立表重複管理規則；純字串角色權限無法以 FK 檢查目錄。五張窄表分別承擔角色、目錄、兩種關聯與必要授權異動紀錄。

來源：[CKS role](../../../CKS_Acceptance_System/server/src/features/auth/entities/auth-role.entity.ts)、[CKS user](../../../CKS_Acceptance_System/server/src/features/auth/entities/auth-user.entity.ts)、[Spec 028](spec.md)。

## R2 — 同仁用受保護內建角色，指派為唯讀推導

**Decision**：保留 `esign/colleague` 內建角色紀錄與顯示名稱；有效 employee 的 effective roles 永遠加此角色，其 permission set 由當前程式目錄固定定義。不要替全部員工逐筆插入user_role，也不在GET時補資料。其他角色照一般關聯讀取。管理 API／REPL 拒絕改／刪／停同仁，亦拒絕指派或撤銷此隱含角色。

**Rationale**：同仁不能撤銷，實際user_role列反而產生冗餘與回補競態；唯讀推導自然涵蓋既有session與新員工，不需要新增同步排程。employee仍先通過027 session與本地啟用狀態，不能僅由角色得知員工資格。

**Alternatives**：每次登入才補會讓既有session暫時無基本資格；把同仁變成可編輯預設角色可一次提升全員，違反已確認範圍。

## R3 — 直接讀 DB，避免跨實例快取撤權

**Decision**：不引入 CKS authorization-cache。每次請求以獨立最新授權查詢取得有效角色／permission與compiled catalog交集；permission資料不在session或cookie保存。寫入service在業務交易進行授權核對，不沿用先前請求的權限快照；採目前讀／READ COMMITTED以避開長交易舊快照。提交前已受理的背景工作不追溯取消，但結果查詢／下載重新驗權。

**Rationale**：目前沒有量測證據需要授權快取；DB是最低複雜度且滿足下一請求生效的來源。已有 [EsignAccessPolicy](../../server/src/features/esign/services/esign-access-policy.service.ts) 每次重查員工可信部門的先例。

**Concurrency**：管理寫入鎖role／user及關聯，角色version與指派expectedRoleIds避免lost update；所有寫入與authorization_events同交易。撤權commit後才開始的請求不能讀到舊授權；已在途交易按其核對／受理時點完成，不宣稱可取消已送出的資料或工作。

## R4 — actor 聯集必須延伸到業務資料，不只是 Guard

**Decision**：沿027 employee／super_user actor。documents、initiation_jobs、export_jobs與notification_batches新增對應actor_kind，原user FK按需要改nullable。欄位／簽署人編輯的稽核欄亦加actor_kind，但不改signer.user_id與簽署證據。所有歷史員工欄位值保留，只有新Super user操作使用kind=super_user、userId=NULL。

**Evidence**：[document](../../server/src/features/esign/entities/esign-document.entity.ts) 與 [initiation job](../../server/src/features/esign/entities/esign-initiation-job.entity.ts) 建立人NOT NULL；[export job](../../server/src/features/esign/entities/esign-export-job.entity.ts) 的CHECK要求一般匯出有員工；[notification batch](../../server/src/features/esign/entities/esign-notification-batch.entity.ts) 有notifiedByUserId。 [AuditSubscriber](../../server/src/infrastructure/database/audit.subscriber.ts) 只懂員工CLS，不能把NULL靜默當未知操作者。

**Alternatives**：dummy employee或選別人當建立人會污染稽核；全面principal表會重構不相關功能。採局部actor欄位，精確列出受影響表與CHECK。

Super user建立文件需顯式departmentCode，透過既有Portal部門來源 exact-match驗證，部門名稱由可信來源保存；employee不接受自報部門。更改他人文件保留原建立人與部門。worker從job持久化actor取操作人，不拿document creator代替發起管理者。

## R5 — 授權與資料政策分離，明確管理例外

**Decision**：Guard驗功能能力，EsignAccessPolicyService驗資源與狀態。manage-all只放寬建立人／部門，不能代簽、代拒簽、修改不允許狀態或取得他人個人副本。read-all／export.all分開；一般匯出仍要export.read或export.create及合法資料範圍。

**Evidence**：[policy](../../server/src/features/esign/services/esign-access-policy.service.ts) 現在creator與department硬限制；[completion access](../../server/src/features/esign/services/esign-completion-access.service.ts) 的departmentFile允許同部門任意signer副本，與新spec限制不同，必須明確收緊為本人資格，不可只加角色Guard。

**Alternatives**：`if(super) return true`會跳過狀態／證據；只加Guard會讓管理員仍卡在舊creator條件。新增明確capability參數與actor-aware policy，不信任client傳來可見範圍。

## R6 — 本人能力供029使用，管理僅Super user

**Decision**：GET `/api/me/authorization` 回027 actor與按module分組的permissions，no-store；員工只有有效聯集，Super user列出所有目前登錄能力。無roles／其他員工資料／入口／token。角色管理API先檢查actor.kind=super_user，不讓可編輯的role_permissions授予平台管理權。

**Rationale**：前端不應解析角色名稱；platform.authorization.manage在目錄可見但不可指派，維護身分是唯一來源。029的選單權限契約見 [permissions](contracts/permissions.md)。

## R7 — 預先指派與稽核

**Decision**：POST employee-role-assignments body傳員編（不放URL），沿 [EligibleStaffService](../../server/src/features/auth/services/eligible-staff.service.ts) exact-match有效員工查核，再與user建立／授權寫入及audit同交易；並發empid唯一鍵仲裁。已停用／軟刪除本地員工不自動復活。

稽核只記角色設定、權限集合及角色指派變更，含actor、source、module、target與裁切前後差異。不得恢復026簽署歷程。源碼目錄sync／初始角色seed只由明確REPL執行，HTTP啟動不寫；缺目錄或不相容版本以readiness失敗阻止啟用，無fallback。

## 尚未驗證

本次只確認靜態可行性。實作後需MySQL複合FK、軟刪除還原、schema差異、兩實例撤權、actor所有worker分支與文件DTO兼容測試。Portal部門與員工真實連線未測，不把來源查核描述為已完成。
