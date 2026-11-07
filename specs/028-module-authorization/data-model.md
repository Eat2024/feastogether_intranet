# Data Model：多子功能授權

設計階段；未執行migration。所有business entity繼承AuditableEntity，DB snake_case、TS camelCase、繁中文註解。所有時間UTC datetime(6)，created_at／updated_at／deleted_at各自單欄索引；repository由MysqlModule統一註冊。module_key與code/key用ascii_bin，避免大小寫混用。

## 1. authorization_roles

| 欄位 | 限制 |
|---|---|
| id | bigint unsigned PK |
| module_key | varchar(50), NOT NULL；僅compiled module catalog |
| role_code | varchar(80), NOT NULL；模組內穩定且不可改 |
| role_name | varchar(100), trim後1～100字；同模組未刪除角色名稱不可重複，使用下述generated unique鍵 |
| is_active | boolean NOT NULL default true |
| version | unsigned int NOT NULL default1；每次實質更動加1 |
| 共用時間 | AuditableEntity欄位 |

UNIQUE(module_key,role_code)、UNIQUE(module_key,id)。新增generated active_role_name = CASE WHEN deleted_at IS NULL THEN role_name ELSE NULL END，UNIQUE(module_key,active_role_name)，以utf8mb4_0900_bin精確比較，防止並發同名建立；inactive但未刪除也保留名稱。code跨soft-delete不重用，避免歷史指派指向新意義；roleName可在原角色刪除後重用。protected狀態不落DB欄位，由compiled initial role catalog依module_key／role_code判定；protected角色無管理寫入入口，權限定義以程式為準。

## 2. authorization_permissions

id bigint unsigned PK；module_key varchar(50)；permission_key varchar(100)全域唯一；permission_name varchar(100)；共用時間。UNIQUE(module_key,id)。資料是compiled catalog投影，只能catalog sync寫入；可否指派不落DB欄位，由compiled permission catalog判定，platform.authorization.manage不可指派、其他esign能力可指派。移除目錄項soft-delete，執行期再與compiled catalog交集，舊關聯不能授權。

## 3. authorization_role_permissions

id bigint unsigned PK；module_key varchar(50) NOT NULL；role_id bigint unsigned NOT NULL；permission_id bigint unsigned NOT NULL；共用時間。UNIQUE(role_id,permission_id)。複合FK `(module_key,role_id)→roles(module_key,id)`、`(module_key,permission_id)→permissions(module_key,id)` 均RESTRICT；同scope由DB保障。FK不保障active或compiled catalog的可指派規則，service在同交易核對。

覆寫角色權限時只對差異soft-delete或恢復原列（save），不得插入與歷史唯一鍵碰撞的新列；不可復活已移出compiled catalog的權限。protected同仁內容由受控sync保持，但effective authorization直接採程式固定集，不採可變關聯擴權。

## 4. authorization_user_roles

id bigint unsigned PK；user_id bigint NOT NULL FK users.id RESTRICT；module_key varchar(50) NOT NULL；role_id bigint unsigned NOT NULL；共用時間。UNIQUE(user_id,role_id)，FK `(module_key,role_id)→roles(module_key,id)` RESTRICT；索引(user_id,module_key,deleted_at)。不存在全域users.role_id。

不保存同仁隱含指派；有效employee的查詢輸出包含 implicitRoles，管理寫入roleIds只允許一般角色。撤銷soft-delete，重授恢復同列；inactive role關聯可保留但不授權。刪除role先鎖role並檢查有效user_roles，仍有指派則409；所有指派服務同樣鎖目標role，避免檢查後插入。

員工角色覆寫以鎖定users列後比較該module目前一般roleIds是否等於expectedRoleIds；不同回409。若目標集合本就等於目前集合，回no-op結果、不重複audit。roleIds去重後最多50筆，expectedRoleIds同規則。固定鎖序：users（如涉及指派）→ role id升冪 → permission id升冪 → relation rows。角色自身編輯不回鎖users；角色刪除可檢查關聯但不取得反向user鎖。

## 5. authorization_events（BaseEntity，append-only）

id unsigned bigint PK；occurred_at datetime(6)及created_at各index；actor_kind varchar(20)=super_user|operator|system；source varchar(10)=http|repl|migration；module_key varchar(50)；event_type varchar(64)白名單；target_kind varchar(20)=role|user|catalog；target_id bigint nullable；request_id varchar(64)nullable；before_json／after_json JSON nullable。

JSON只允許role code/name/active/version、permission keys、一般role IDs與本地user ID；不放員編、個資、帳密、完整入口、文件或簽名。HTTP操作者是027 Super user；REPL是明確本機operator且需驗本機維護設定仍對應active generation。成功異動與event同交易，audit失敗整筆rollback。查詢只有Super user／受控REPL，無更新／刪除API，不新增保留期排程。

## 6. 電子簽業務操作者增量

不用全域principal表；既有users及signer.user_id均不重建。以下是可由管理者寫入的既有actor欄位，schema與DTO都須調整：

| 表／entity | 增量與歷史回填 |
|---|---|
| esign_documents / EsignDocument | 新created_by_actor_kind employee|super_user，既有全部employee；created_by_user_id改nullable，employee必非空、super必NULL；原FK保留。建立後兩欄與department快照不可因管理操作改寫 |
| esign_initiation_jobs / EsignInitiationJob | 新created_by_actor_kind，同規則；created_by_user_id改nullable，代表真正提交job的actor，不是原document creator。重試保留原job actor，另新job才記新操作者 |
| esign_export_jobs / EsignExportJob | 新created_by_actor_kind employee|super_user|external_signer；既有有user者employee、無user且pdf/signer_id者external_signer。一般excel/zip允許employee或super，不允許external；pdf本人下載只允許employee或external_signer且signer_id非空；super不能以pdf本人下載建立紀錄。更新既有export CHECK，不只放寬NOT NULL |
| esign_notification_batches / EsignNotificationBatch | 新notified_by_actor_kind employee|super_user|system；既有user非空employee、空system；新user依kind檢查 |
| esign_document_fields／esign_signers | 局部新增created_by_actor_kind／updated_by_actor_kind employee|super_user|system|legacy_unknown；有既有user回填employee、空回填legacy_unknown，不假稱歷史system。新寫入明確actor，super欄位NULL；既有signer_type/user_id/email與簽章證據不變 |

所有actor CHECK顯式處理NULL：employee→user_id IS NOT NULL；其他kind→user_id IS NULL。涉及歷史unknown只用於以上兩個既有可空稽核slot，不允許新HTTP使用。不要直接改UserAuditableEntity基底而波及Department；只在兩個esign子類增加actor欄位，AuditSubscriber對支援actor的entity明確寫入，department人事流程不動。

另為document加入最後管理操作者欄位 `updated_by_actor_kind`（employee|super_user|null）與`updated_by_user_id` nullable FK；歷史NULL表示當時未保存、不回填猜測。新管理寫入保存目前actor，此為目前狀態metadata，不是恢復文件事件時間軸。只保留最後操作者，不新增簽署audit chain。

## 7. 新文件歸屬與顯示

employee建立：departmentCode只能從現有可信員工來源，拒絕輸入覆寫。super建立：multipart fields DTO新增departmentCode（僅super必填，1～50字元、保留原碼），以Portal目前有效部門exact-match，名稱由來源取得；上游錯誤503、部門無效400，不能套用舊快照／任意名稱。文件建立人kind=super_user/userId=NULL，沒有假員工。

文件createdBy輸出保留既有name等顯示欄位，增加kind；employee維持原name/employeeNo形狀，super為 `{kind:'super_user',employeeNo:null,name:'Super user'}`。匯出人同理employeeNo/email可null，增加kind，姓名為Super user。既有client types／mapper只做nullable與顯示相容，不新增管理UI；所有employee-only操作不得把null強轉0。

## 8. 遷移與目錄seed

增量migration先加role表／actor nullable欄位、回填可證明的歷史kind，再建立CHECK／FK/index；不改既有ID或個人簽章內容。catalog sync及初始角色seed是明確REPL transaction，不在HTTP startup；same key重跑不覆蓋一般role已修改permission或active狀態，protected colleague由code固定。

首次有效目錄初始化後可查詢基本授權；舊會話由唯讀同仁推導立即取得基本資格。上線前停止舊HTTP／worker、備份、migration、sync catalog、核定名單指派、測試，再啟動新保護；不能新舊授權程式混跑。down遇super建立業務資料或authorization audit時拒絕破壞性回退；空測試庫可apply/down/reapply，正式採備份復原或前向修復。
