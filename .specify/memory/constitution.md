<!--
Sync Impact Report（審查用，commit 前由審查者確認後移除）
- Version change: 1.3.0 → 1.4.0（MINOR：Principle III 的外部 Email 簽署邀請例外擴充
  「簽署完成後讀取本人結果與下載本人副本」的範圍；未移除或重新定義任何原則）
- Modified principles: III. 最小權限與資料最小化（外部簽署邀請例外）
- Added sections: 無
- Removed sections: 無
- 修訂原因: 專案負責人於 2026-10-20 決定，簽署合約雙方都須能留存已簽署文件；外部簽署人
  簽署後須能以原邀請下載本人副本，且不設下載期限以避免爭議（Spec 008）。
- 影響: Spec 003 US3 驗收 6、FR-016、FR-026 與 contracts/external-invitation.md、
  Spec 004 相容更新中「外部簽完邀請失效」的記載，須標示由 Spec 008 取代。
- 遷移: 無資料遷移；已簽署 email 簽署人原本就保留邀請 digest。
- Templates: plan/spec/tasks templates 在執行時讀取 constitution，無需修改。
- Follow-up TODOs: 外部下載存取不設期限且不可撤銷，正式上線前由法務確認。
-->
# 饗賓內部電子簽署系統 Constitution

## Core Principles

### I. KISS 與 YAGNI（不可妥協）

- 實作 MUST 限於已確認的需求、驗收條件與目前使用情境。
- 不得預先建立尚未使用的抽象層、provider framework、feature flag、資料表、
  環境變數、fallback、排程或共用模組。
- 優先修改現有且最接近業務責任的實作；只有當前需求出現真實重複時才能抽象。
- 新增複雜度時，spec 或 plan MUST 記錄當前需求、較簡單方案不足的原因與
  日後移除成本。

本原則確保電子簽核心流程可理解、可驗證、可維護，不讓尚未存在的需求擴大
系統風險。

### II. Server 權威與簽署證據完整性

- 身分、權限、簽署資格、文件狀態、期限、Hash 與業務寫入 MUST 由 Server 重新驗證。
- Client 傳入的身分、狀態、權限或 Hash MUST NOT 作為最終可信依據。
- 文件、簽署參數、簽名產物、完成 PDF、manifest 與 audit chain MUST 可重新計算與
  驗證。
- 已成立的簽署證據 MUST NOT 透過一般更新、軟刪除或管理後台被改寫。

電子簽的可信性來自 Server 端可重現的證據鏈，而非 UI 呈現或 Client 的宣告。

### III. 最小權限與資料最小化

- API 回應與 Client props MUST 只包含完成當前操作必要的資料。
- JWT、access token、session token、cookie、OTP、簽名圖、文件內容與未遮罩個資
  MUST NOT 進入 URL、log、錯誤訊息或非必要的 Client payload。
- 唯一 URL 憑證例外是 feature spec 明確要求的外部 Email 簽署邀請。該邀請 MUST
  使用不可預測且不含身分或文件內容的 opaque credential，MUST 綁定單一簽署人與
  單一文件；用於簽署時 MUST 具有期限且可撤銷，並在簽署完成、文件停止或期限到達後
  不得再授權簽署。邀請原值 MUST NOT 寫入 access log、application log、analytics、
  錯誤訊息或 Referrer。
- 簽署完成後，外部簽署邀請 MAY 依 feature spec 繼續授權該簽署人讀取本人簽署結果與
  下載本人個人副本，以保障簽署雙方留存已簽署文件：此存取 MUST 唯讀、MUST NOT 授權
  再次簽署或存取其他簽署人資料；不設期限，且不因文件停止、到期或完成而撤銷，只在
  文件刪除時失效。
- 外部簽署邀請例外 MUST NOT 擴張為一般登入、內部員工 session、跨文件授權或可解碼
  的身分 token；Server MUST 在每次授權時重新驗證邀請狀態與文件狀態。
- 第二個明確例外是 feature spec 要求的公開簽章驗證，供公司內部稽核查驗已簽署文件：
  - 驗證網址 MAY 包含 Server 簽發、可證明來源且不含個資的驗證識別；該識別 MUST NOT
    授予登入、session、寫入、原始或完成文件下載，只能查詢單一簽章的驗證結果。
  - 驗證回應 MAY 揭露簽署人於發起時固定的完整姓名與文件標題，作為查驗必要資料；
    MUST NOT 揭露 Email、員編、部門、職稱、來源 IP、User-Agent、簽名圖、文件內容或
    其他簽署人資料。
  - 公開驗證 MUST 只讀並限制查詢頻率，不得設定 cookie、寫入業務資料或稽核事件。
- 每個內部或公開 endpoint MUST 明確界定身分來源、允許操作與資料揭露範圍。
- 檔案與簽署產物 MUST 存於受控儲存；資料庫只保存必要 metadata 與關聯。

電子簽處理身分、個資與簽名等敏感資料，預設少揭露能直接降低洩漏與誤用風險。

### IV. 清楚的系統邊界

- `client` 與 `server` MUST 只透過明確 API contract 交互，不得跨 package import source。
- HTTP API MUST 採用 RESTful、resource-oriented contract；URI MUST 使用可辨識的業務資源
  名詞與穩定階層，不得使用 `/do`、`/action`、`/process` 等無法表達意圖的通用路由。
- 每個 API 的 URI、HTTP method、status code、request 與 response MUST 共同表達單一且
  明確的業務語意；`GET` MUST NOT 產生業務寫入，寬等性必須與所選 method 一致。
- 無法直接表達為 CRUD 的業務動作 MUST 使用語意明確的子資源，並在 OpenAPI contract
  說明用途、授權、前置條件、成功與失敗回應，不得為追求形式上 CRUD 而隱藏業務語意。
- 業務規則 MUST 放在最接近業務責任的 feature；只有確實跨 feature 重用時才能移到
  共用層。
- Controller 只處理 HTTP 邊界；業務不變量、授權、交易與敏感資料裁切 MUST 在
  Server domain/service 層執行。
- Session、關係資料、檔案與背景工作 MUST 使用各自既定的 Redis、MySQL、
  object storage 與 worker 責任邊界。

清楚邊界讓權限、交易與敏感資料不會隨 UI 或部署形態而失效。

### V. 與風險相稱的驗證

- 每次變更 MUST 執行受影響 package 的 lint、test 與 build；無法執行時 MUST 明確記錄
  原因與未驗證風險。
- 身分驗證、簽署交易、Hash、migration、公開驗證與檔案存取變更 MUST 具備對應的
  自動化單元、整合或 e2e 驗證。
- 測試 MUST 覆蓋正常流程、授權失敗、重放、過期、並發與內容竄改等對應風險。
- Mock、UI 骨架、TODO 或尚未接上正式 API 的功能 MUST NOT 被描述為已完成。

驗證強度必須跟著失敗後果提升，但不得為低風險變更預先建立過度測試基礎設施。

## Engineering Constraints

- 專案 MUST 維持 pnpm workspace，不得建立 npm 或 yarn lockfile。
- 前後端 MUST 沿用既有 Next.js、React、MUI、NestJS、Fastify、TypeORM、MySQL 與
  Redis 邊界；更換或新增核心技術必須有已核准 spec。
- 文件、註解、UI 與可預期錯誤訊息 MUST 使用繁體中文。
- Secret、組織個資、簽名圖、正式文件與 generated artifacts MUST NOT 進入版本控制。
- Schema、dependency、環境變數、fallback、排程與額外抽象層只能在已核准 spec 明確需要時
  新增。
- 實作 MUST 保留使用者現有變更，不得因格式化或順手重構產生任務外差異。

## Workflow and Quality Gates

- 新功能依 constitution → spec → clarify → plan → tasks → implement → analyze 流程進行。
- Spec MUST 描述使用者價值、可驗收行為、範圍外項目與必要失敗情境，不預先設計尚未
  需要的延伸能力。
- Plan MUST 優先採用最少資料模型、最少 API 與現有元件；所有複雜度例外均需附理由。
- Tasks MUST 能獨立驗收且明確對應 spec，不得夾帶無關重構或未核准功能。
- Review MUST 檢查 KISS、REST semantics、Server-side enforcement、敏感資料邊界、
  migration 可回滾性與驗證結果。
- 交付摘要 MUST 分開說明 Client、Server、migration/config 變更、驗證結果與已知限制。

## Governance

- 本 Constitution 是專案的最高開發原則；spec、plan、tasks、code review 與實作 MUST 遵守。
- `AGENTS.md` 提供日常實作細則。若其與本 Constitution 衝突，MUST 先修訂其中一方，
  不得默默忽略。
- 修訂 MUST 記錄原因、影響與必要遷移方案，並由專案負責人核准後生效。
- 版本依 semantic versioning 維護：移除或重新定義原則為 MAJOR；新增原則或實質擴充治理
  範圍為 MINOR；不改變語意的澄清為 PATCH。
- 所有 feature spec 與交付前 review MUST 進行 Constitution compliance 檢查；不符合時不得
  進入實作或交付。
- Sync Impact Report 是修訂審查資料，commit 前 MUST 由審查者確認並移除。

**Version**: 1.4.0 | **Ratified**: 2026-10-12 | **Last Amended**: 2026-10-20
