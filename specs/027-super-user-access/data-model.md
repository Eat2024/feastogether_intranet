# Data Model：Spec 027

狀態：計畫，未新增 migration 或改 DB。所有時間以 UTC 保存；台北週期只在計算邊界使用。entity／migration／schema dump 需一致；沿用 MysqlModule repositories，Service 傳 EntityManager。

## 1. auth_sessions（增量延伸）

| 欄位 | 型別／限制 | 規則 |
|---|---|---|
| actor_kind | varchar(20), NOT NULL, default employee | employee／super_user |
| user_id（既有） | nullable bigint FK users | employee 啟用會話必須有有效員工；super_user 必須 NULL |
| source（既有） | varchar(20) | 新寫入 webview／oauth／super_user；歷史保留原值，不猜測回填 |
| credential_generation | nullable unsigned bigint | 僅 super_user 必填，對應 singleton 當前 generation |
| replacement_session_id | nullable unsigned bigint self FK RESTRICT, unique | 舊列成功替換後指新列，辨識已被替換的舊 token，並發第二次不得再簽發 |
| 其餘既有欄位 | 保留 | opaque token 原值不入 DB，只存 SHA-256；原狀態與期限保持 |

CHECK：actor_kind 枚舉；super_user 時 user_id IS NULL、credential_generation IS NOT NULL、source=super_user；employee 時 credential_generation IS NULL 且 source IN(webview,oauth)。employee 的 validating／failed 可無 user_id；pending／active／revoked 必須有 user_id。super_user 不使用 validating／pending。所有 active 列必須有 session_token_hash、activated_at、expires_at。

不假設 nullable 欄位的 CHECK 會自動拒絕 NULL，必須明寫 IS NOT NULL。新增索引 `(actor_kind,credential_generation,status)` 供整批維護撤銷；replacement FK 不刪歷史列。既有員工 backfill actor_kind=employee、generation=NULL、replacement=NULL。

`findActive` 改 LEFT JOIN user，先驗 session 時效及 revoked/deleted，再依 actorKind 驗員工狀態或維護版本。兩種 actor 都沿用固定八小時、不滑動。source_jti_hash 與 assertion_expires_at 沿既有 local issueSession 相容做法，新本地維護 session 用獨立隨機來源摘要，不能假裝為上游 JWT。

### 狀態與替換

- WebView：validating → pending → active；驗證失敗 → failed；activation 交易內一起撤銷舊 session。
- OAuth／Super user：完成各自驗證後直接 active。
- 登出／版本輪換／身分替換：active → revoked，寫 revoked_at；替換才設定 replacement_session_id。
- 到期依 expires_at 判斷，不新增過期清理排程。
- 固定鎖序：維護 singleton（涉及維護身分時）→ 舊 session（若存在）→ 待啟用 WebView 列／新列。憑證啟用用同鎖序；所有競態測試覆蓋 deadlock／rollback。
- 有舊 token：若已被其他登入替換（replacement_session_id 非空），回 409；已過期或一般登出撤銷可作無有效舊身分處理。仍有效才撤銷。新列與 replacement 關聯在同交易完成。

## 2. super_user_access（新增 singleton，AuditableEntity）

| 欄位 | 型別／限制 | 用途 |
|---|---|---|
| id | tinyint unsigned PK，CHECK id=1 | 唯一維護身分設定，不是員工 ID |
| entry_key | char(43), ascii_bin, NOT NULL | randomBytes(32) base64url；受控 DB 原值保存，供 REPL 回查 |
| entry_generation | bigint unsigned, >=1 | 每次有效入口輪換增加 |
| rotated_at | datetime(6), index | 目前入口生效時間 |
| period_start_at | datetime(6), index | 最近已處理的週一台北 04:00，UTC 保存 |
| active_credential_fingerprint | char(64), ascii_bin | SHA-256(domain separator + canonical JSON [account,passwordHash])，不儲存帳密 |
| credential_generation | bigint unsigned, >=1 | 明確啟用新帳密時增加，不因網址輪換改變 |
| credential_activated_at | datetime(6), index | 帳密生效點 |
| created_at／updated_at／deleted_at | 繼承，日期單欄索引 | 不暴露刪除；soft-deleted 亦拒絕維護登入 |

初始化是受控 REPL transaction，並發以固定 PK 仲裁後重讀；重複 initialize 不覆寫現值。不存在時 HTTP 503，worker 記未初始化且不偷偷建帳。rotateIfDue 鎖列後比較最新已到期週期，大於 storedPeriod 才生成一個新 key，連同安全事件一次 commit。

activateCredentials：以本機已驗證設定算 fingerprint，鎖列並核對操作者提供的 expectedGeneration；相同 fingerprint no-op，不撤 session。不同則 generation+1、更新 fingerprint、撤銷所有 active super_user sessions、寫安全事件一次 commit。只由 REPL 呼叫，不允許舊 HTTP／worker 啟動自動同步。

每次 Super user 驗證都讀 DB，不快取入口／啟用版本。判定：local fingerprint = active fingerprint AND session generation = active generation。舊實例即使還拿舊密碼也無法重新登入。移除／缺少設定屬啟動錯誤，不設預設值。

## 3. auth_security_events（新增 append-only，BaseEntity）

| 欄位 | 型別／限制 | 用途 |
|---|---|---|
| id | unsigned bigint PK | 事件流水號 |
| event_type | varchar(64) | login.succeeded／login.rejected／session.replaced／session.revoked／credentials.activated／entry.initialized／entry.rotated |
| actor_kind | varchar(20) | employee／super_user／operator／system／anonymous |
| actor_user_id | nullable bigint FK users RESTRICT | 只有 employee 事件有值 |
| session_id | nullable unsigned bigint FK auth_sessions RESTRICT | 成功登入／撤銷可關聯；不可包含 token |
| occurred_at／created_at | datetime(6)，各單欄 index | 事件與建立時間 |
| outcome_code | varchar(64) | 白名單結果碼，不存任意例外訊息 |
| credential_generation／entry_generation | nullable unsigned bigint | 可追溯版本；不存 fingerprint／key |
| request_id | nullable varchar(64) | 已正規化追蹤識別；REPL／worker 可無 |

不得保存輸入帳號、密碼、IP、UA、任意 body、完整入口或文件資料。成功登入／登出／輪換與此表同交易；invalid login 的 rejected 事件另短交易，不影響原會話。若 DB 不可用則拒絕登入，既有結構化 logger 只記故障類別與 requestId，不假裝 DB 事件成功。限流／無效路徑避免每次猜測無限寫表，沿既有安全 log 記拒絕結果；登入已進入 credential 驗證才寫 login.rejected。

紀錄不提供任意 update/delete，不設新清理排程，不與已移除的 esign_audit_events 混用。028 的授權異動稽核另行設計，不預先擴充泛用 metadata。

## 4. 操作者與相容層（非資料表）

`Actor = {kind:employee,userId:number} | {kind:super_user}`。request.actor／CLS_ACTOR 保存此聯集；只有 employee 設 request.user、CLS_AUDIT_USER_ID。employee-only guard 缺明確許可時對 super_user 回 403；session read/logout 明確允許。不可讓 requireClsUserId 對 super_user 回傳 0、1 或假的員工 ID。

027 不新增「可指派 Super user role」或通用 principal 表；028 根據 actor kind 設計業務操作者／建立人關聯。現有 users 與文件 FK 完全不動。

## 5. Migration 與回復

一份增量 migration：先加 nullable／default 欄位、回填既有 actor、檢查資料後加 CHECK／FK/index，建立兩表；不把真實入口或帳密寫在 migration，初始化另做。schema dump 由工具生成，不手改。

先停止舊版 HTTP／worker，備份，migration，再部署新版＋初始化／啟用，再開流量；舊版 INNER JOIN 與登入替換規則不支援混跑。down 只允許沒有維護事件／維護 session 的空測試資料；有正式資料時拒絕破壞性 down，採保留 schema 的程式回復或經審核備份復原。不得因回退重新開放已移除員工帳密入口。
