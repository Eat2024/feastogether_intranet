# Phase 0 Research: 部門文件可見與唯讀權限

**日期**：2026-11-02
**狀態**：Phase 0 完成；使用者已確認 FR-010 同部門匯出限制，可進入 Phase 1。

## 1. 發起人沿用既有建立人

- **Decision**：以 `esign_documents.createdByUserId` 決定修改權，不新增 initiator／owner 欄位。
- **Rationale**：`EsignInitiationService.initiate()` 用建立人檢查與草稿鎖保護發起；現有文件沒有獨立的發起人授權模型。符合使用者「只有發起人能修改」而不新增轉移所有權功能。
- **Alternatives considered**：另加發起人欄位會產生草稿尚未發起時誰能修改等第二套規則，當前需求不需要。

## 2. 建立部門快照與目前員工部門分離

- **Decision**：users 增加上游字串代碼，文件增加建立部門代碼與名稱；部門查詢使用登入者最近同步的代碼與文件快照比對。
- **Rationale**：目前 `User.departmentId` 指本機 bigint，`StaffLookupDto.department_id` 是上游字串；現有登入只同步名稱。文件快照可避免調職搬移舊文件。
- **Alternatives considered**：用建立人目前部門 JOIN 會改變歷史歸屬；用部門名稱無法區分同名部門；完整同步部門表增加不必要資料維護。
- **Evidence**：`users/entities/user.entity.ts`、`auth/services/auth.service.ts::findOrCreateUser`、`auth/services/oauth-identity.service.ts`、`esign/services/esign-draft.service.ts::createDraftDocument`。

## 3. 唯讀與修改檢查必須分開

- **Decision**：在既有 `EsignAccessPolicyService` 增加建立人或同部門可讀的判斷；不放寬 `checkEsignCreator()`／`checkAndLockDraftDoc()`。詳情、來源 PDF 及裁切歷程使用唯讀政策；文件修改／通知 mutation 與邀請憑證取得沿用建立人政策；匯出工作另採同部門政策。
- **Rationale**：同一建立人檢查已被多個寫入入口使用，直接替換會放寬編輯、發起、停止、補簽與通知操作。
- **Alternatives considered**：只藏按鈕無法阻止直接 HTTP；新增第二套平行詳情 API 並非必要，可先沿用原路徑與依權限裁切的 DTO。

| 現有方法 | 規劃處理 |
|---|---|
| `EsignDocumentQueryService.creatorDetail` | 允許建立人或同部門讀取；名稱於實作調整成符合共用讀取責任；回傳 isCreator 與對應資料 |
| `creatorSource` | 允許同部門來源文件預覽，保留內容完整性驗證與現有回應標頭 |
| `history` | 加同部門只讀分支，只給文件層級事件，不直接給建立人的完整逐人稽核事件；保留指定簽署人既有範圍 |
| `reopeningInvitations` | 維持建立人限定；雖是 GET，但會解密回傳有效邀請 URL，不是一般瀏覽 |
| `EsignReminderService.list/detail/create` | 保持建立人管理範圍；同部門唯讀頁不載入通知歷史元件 |
| draftSave／draft-settings／fields／employee-email-checks／initiations／reopenings／stoppages／note／delete | 保持建立人與原文件狀態限制 |

## 4. 同部門詳情必須裁切

- **Decision**：唯讀頁提供文件標題、狀態、簽署期間、來源預覽、簽署進度及必要姓名／狀態／時間。預設不提供 Email、內部備註、個別拒絕理由、驗證連結、邀請資訊、個人副本下載資訊與催簽資格；定稿契約見 contracts/department-access.md。
- **Rationale**：`creatorDetail()` 現有輸出含 `mapper.signer()`、`reminderSummary()` 與 note，不是可直接分享的純摘要。瀏覽權不自動等於憑證、個資與下載權。
- **Alternatives considered**：直接回完整 DTO 再讓 UI 隱藏會讓敏感資料仍傳給非建立人。

## 5. 前端需包含直接路由與內嵌操作

- **Decision**：列表及詳情根據後端 isCreator 區分唯讀／管理；所有寫入仍由後端保護。
- **Rationale**：放寬 detail API 後，原本只看狀態的 editor 可能讓同部門員工直接開編輯頁。不能只改 DocumentRowActions。
- **Evidence**：
  - `DocumentRowActions.tsx`：草稿目前沒有檢視入口，需提供唯讀入口；管理按鈕僅建立人。
  - `DocumentDetailView.tsx`：草稿設定、停止、補簽與補簽邀請按鈕；簽署人表及通知元件需要權限分支。
  - `DocumentSignerTable.tsx`：備註 mutation、催簽、個人副本下載不能無條件提供。
  - `DocumentEditView.tsx`／`DocumentSignersEditor.tsx`：目前主要檢查 draft，須另檢查建立人並導回唯讀頁。
  - `NotificationHistory.tsx`：元件 mount 會查詢管理 API；非建立人不 mount，不能一開頁就觸發 404。

## 6. UAT 舊文件統一歸 IT策略本部系統開發部

- **Decision**：依使用者明確指示，切換前既有 UAT 電子簽文件統一回填 IT策略本部系統開發部代碼與名稱。回填與一般 schema migration 分離，先唯讀確認正式代碼及舊文件清單，停寫窗口中執行並核對筆數。
- **Rationale**：建立時歷史部門不存在；這是指定歸屬，不是重建歷史。名稱不能直接當授權鍵；使用者已提供代碼 `1029030000`，以此字串精確比對。
- **Alternatives considered**：按建立人目前部門回填、保持無歸屬或刪除重建皆未採用。不可把所有 User 改為 IT，也不可給文件建立欄位 IT 預設值。
- **Operational prerequisite**：使用者已提供 `department_id: "1029030000"`、`department_name: "IT策略本部系統開發部"`。尚未連線驗證 UAT；部署前核對這組對應，若不一致則停止回填，不自行改選同名或上層部門。

## 7. 匯出與歷史統一採同部門限制

- **Decision**：使用者確認 Excel／PDF／ZIP 與匯出紀錄均限同部門；所有相關入口依文件快照驗證，包含計數、產生、重試與直接 ID 存取。更新 Spec 015 契約，不保留全公司旁路。
- **Rationale**：只限制列表不能阻止既有匯出與下載直接存取。匯出工作會寫紀錄但不修改原電子簽，因此同部門可匯出，不能修改文件。
- **Alternatives considered**：只限制列表並保留全員匯出，已被使用者否決；另設部門管理員或新的角色系統沒有需求。
- **邊界**：一般匯出需要同部門，不加建立人跨部門例外；發起人調職仍能依原規則管理文件，但不能從一般匯出入口下載原部門文件。內部本人簽署副本及外部本人副本仍依原指派／憑證，不能讓部門新限制破壞既有簽署義務與留存。
- **資料**：歷史表 JOIN 文件取得部門，不再新增匯出部門欄位，避免文件與匯出快照雙重歸屬。
- **Gate**：FR-008／009／010 皆已確認，無未解決需求；部署前核對 IT 部門代碼與 UAT 清單屬執行前驗證，不是未決產品規則。

## 研究方法與限制

- 以本機程式、現有 spec 及使用者決策作為證據，依 speckit-plan 使用一個唯讀研究代理檢查讀取／寫入邊界。
- 未連線 UAT，未查詢正式人資個資，未執行 migration、回填、程式修改或部署。
- .specify/extensions.yml 不存在，無 before_plan／after_plan hooks 需執行。
