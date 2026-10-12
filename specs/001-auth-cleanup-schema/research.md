# Phase 0 Research：舊授權清理與電子簽資料基礎

## R1. Auth 清理邊界

**Decision**: 移除 RBAC、permission、API permission registry、authorization cache、使用者管理及其專用 audit；保留員工身分、OAuth/SSO、Redis session、登出、cookie、origin/rate-limit 與非正式環境 dev login 核心。

**Rationale**: 這些保留能力是未來移回主平台可復用的 authentication 邊界；role/permission 與員工管理則是驗收系統的 authorization／administration 責任，Stage 1 沒有使用情境。

**Alternatives considered**:

- 整個 Auth feature 一起刪除：會失去已驗證的 SSO、session 與登出資產。
- 保留 RBAC 但不使用：仍保有 tables、seed、啟動同步與執行期耦合，不符合零依賴驗收。

## R2. 受保護 endpoint 的 default-deny

**Decision**: 刪除 `@RegisterApi`、API key metadata、DB registry 與 permission lookup。全域 `AuthGuard` 只辨識 `@Public()` 例外；其他 endpoint 一律要求有效員工 session 與 active、未刪除的 User。

**Rationale**: 本系統的一般 API 全部限定登入後存取。採「非 Public 即需員工 session」可讓新增 endpoint 漏加 decorator 時仍安全，並完全移除已無用途的 API registry 語意。

正式 runtime 會註冊精簡 AuthModule 的 global guard，但不註冊 AuthController／OAuthController；因此啟用的是 session enforcement，不是登入入口。SSO 流程仍只由獨立 testing module 驗證。

**Alternatives considered**:

- 保留縮減後 `@RegisterApi`：仍留下錯誤名稱與多餘 metadata，可能讓維護者誤認為存在 API registry。
- 新增 `@Authenticated()`：每支一般 API 都要重複標註，漏標處理仍需 default policy；在預設需登入的系統中沒有額外價值。

外部 Email 簽署不使用 `@Public()` 直接放行，也不偽造成 User；後續規格必須使用綁定 signer/document 的獨立外部 session 與專用 guard。邀請／驗證流程不在 Spec 1 實作。

## R3. 員工與 SSO subject

**Decision**: `AuthUser` 併入 `User`；唯一 `empid` 是本地對應鍵，`users.id` 是 session/JWT 主體。OIDC `sub` 只在當次已驗證 token／UserInfo 流程使用，不持久化，也不建 identity-binding table。

**Rationale**: 現行身分對應只依受信任的員工編號；保存 `oauth_sub` 不參與識別、授權或 session 驗證，增加 schema 與文件漂移而沒有 Stage 1 價值。

**Alternatives considered**:

- 保留 nullable `oauth_sub`：改動較少，但它不是識別鍵，也沒有目前查詢需求。
- 建 identity binding table：目前只有單一 provider，違反 YAGNI。

## R4. Migration strategy

**Decision**: 以一個乾淨 baseline migration 取代兩支舊 Auth/RBAC migrations，不提供舊資料向前轉換；已使用舊 baseline 的環境一律 reset。

**Rationale**: 使用者確認所有現有 DB 均可重建。這是移除舊 tables、避免相容包袱與確保乾淨 schema 的最小做法。

**Alternatives considered**:

- 新增 drop/rename migration：只服務不存在的資料保留需求，且保留無用歷史。
- 每張表一支 migration：增加排序與中間狀態，無法帶來獨立部署價值。

## R5. MySQL DDL failure model

**Decision**: 明確接受 MySQL DDL auto-commit；`up()` 使用有序 DDL、不以 `IF NOT EXISTS` 掩蓋 drift，失敗時 best-effort 清理由本次建立的表，驗證以乾淨 DB apply/revert/reapply 為準。

**Rationale**: TypeORM transaction 無法讓 MySQL 12-table DDL 真正原子。誠實揭露 reset 路徑比宣稱安全交易回滾可靠。

**Alternatives considered**:

- 假設 migration transaction 能保證原子：不符合 MySQL 行為。
- 為每一步寫複雜復原狀態機：只用於可重建的 baseline，成本不成比例。

## R6. 循環 FK 與刪除政策

**Decision**: 先建立 departments，再建立 users，最後 ALTER 加上 department 的 user actor FK；其餘依依賴順序建立，file objects 最後。所有歷史／證據 FK 使用 RESTRICT/NO ACTION，不使用 cascade delete。

**Rationale**: `departments` 的 audit actor 與 `users.department_id` 形成真實循環；延後加 FK 可保留雙向完整性。歷史資料不能因主檔刪除連鎖消失。

**Alternatives considered**:

- 移除 actor FK：失去資料庫層完整性。
- cascade：可能刪除簽署或 audit 證據。

## R7. 員工／Email 簽署人完整性

**Decision**: 使用 `signer_type` VARCHAR + CHECK 實作 user/email XOR；兩個 nullable composite unique 分別防員工與 Email 重複；Email 在 server 正規化並搭配 case-insensitive collation。

**Rationale**: MySQL 允許 unique 中多個 NULL，兩組 unique 能自然套用到兩類簽署人；CHECK 阻止兩者皆有或皆無。

**Alternatives considered**:

- 共用文字 identity 欄：失去 user FK。
- MySQL ENUM：未來新增類型需改 column definition，VARCHAR + CHECK 較易明確遷移。
- 只靠 service 驗證：無法阻止其他寫入路徑建立矛盾資料。

## R8. Append-only enforcement

**Decision**: signature/audit entity 不含 update/delete 欄位，僅透過 insert/query-only repository 暴露；verification 只提供窄化 revoke。Stage 1 不加 DB trigger。

**Rationale**: 這能在既有 TypeORM/DataMapper 慣例內阻止正式程式碼誤用，且不引入難維護 trigger。Entity 本身無法阻止任意 raw SQL，因此驗收描述限於正式資料存取能力。

**Alternatives considered**:

- DB trigger／獨立 DB 權限帳號：更強但引入額外部署與維護負擔，現階段沒有要求。
- 暴露 raw TypeORM Repository：會直接提供 update/delete，違反證據邊界。

## R9. Audit columns

**Decision**: 將共用 actor 欄位改為 nullable BIGINT user FK，僅套用於資料字典明列 actor 欄位的 entities；其他 mutable operational entities 按字典定義 timestamps 與窄化更新方法。

**Rationale**: 目前 `created_by` VARCHAR 與新的共同員工主體不一致；同時不能為了繼承方便，偷偷在每張 table 新增未核准欄位。

**Alternatives considered**:

- 保留 VARCHAR actor：無 FK 完整性且不再對應正式主體。
- 所有 table 一律加 actor 與 soft-delete：造成資料字典外欄位與錯誤刪除語意。

## R10. Schema verification

**Decision**: 以真實 MySQL 8.4 e2e 驗證 apply/revert/reapply、約束與舊表不存在；TypeORM schema log 必須無 diff，`schema.sql` 由 migration 後的 DB 重新 dump。

**Rationale**: metadata unit test 無法證明 MySQL 真正執行 CHECK、collation、FK 或 DDL revert；目前也沒有 CI workflow 可替代本地驗證。

**Alternatives considered**:

- 只做 entity snapshot：無法發現 migration/entity drift。
- 手改 `schema.sql`：快照可能與真實 DB 不一致。

## R11. API contracts

**Decision**: 不建立 OpenAPI contract；`contracts/README.md` 明確記錄 Spec 1 沒有新介面，既有 SSO 也不在此規格啟用。

**Rationale**: 本規格是清理與 schema baseline，建立虛構 API contract 會誤導後續實作者與驗收者。

## R12. 日期與時間欄位索引

**Decision**: 12 張 Stage 1 tables 的每個 `DATE`／`DATETIME(6)` 欄位都建立具固定名稱的專屬單欄索引；欄位同時出現在複合索引時仍保留單欄索引。

**Rationale**: 使用者明確要求所有時間欄位加 index，並以「缺少專屬單欄索引數量為 0」驗收。這使任一時間維度都能直接作為查詢起點，不依賴特定複合索引的 left-prefix。

**Alternatives considered**:

- 只索引已知查詢使用的時間欄位：寫入與儲存成本較低，但不符合明確需求。
- 時間欄位出現在任一複合索引即視為已索引：當時間不是 left-most 欄位時無法獨立有效使用，也不符合專屬索引要求。

## Resolved source inconsistencies

- `internal-electronic-signature-platform.md` 原先殘留 `role_id`、本地備註與電子簽 RBAC 描述：規劃階段已依 Spec 1 修正。
- 現行 `AuditableEntity` 的 VARCHAR actor 欄位與員工 BIGINT FK 不一致：改為員工 actor 欄位，且不套用到 append-only entities。
- 現行 SSO 寫入但不使用 `oauth_sub`：不帶入乾淨 baseline，identity service 與測試同步移除持久化依賴。
- 資料字典若有重複的 signer snapshot 欄位列，實作文件整理時刪除重複列，不建立重複欄位。
