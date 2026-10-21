# Implementation Plan: 內部員工 Email 邀請與 OTP 簽署

**Branch**: `feat/010-internal-email-signing` | **Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)

**Input**: `specs/010-internal-email-signing/spec.md`，含已確認的 grilling 決策。

**Status**: 規劃已由八張 tickets 實作；migration 僅在隔離測試庫驗證，未部署。任務對照見 [tasks.md](tasks.md)，實際品質門檻見 [quickstart.md](quickstart.md)。

## Summary

沿用組織樹與 Redis 7,200 秒快取，提供已選員工的身分解析與信箱檢查；發起時重新查詢 fgapi `staff_emails` 並固定收件地址。內部指派保留 `signerType=user`，經既有 Email 邀請、OTP、受限存取完成簽署／拒簽與本人副本下載。人工催簽及補簽通知支援混合名單。

實作僅 server 及必要 schema migration；client 透過 [前端交接](contracts/frontend-handoff.md) 移交。不建立第二套簽署 API 或登入。

## Technical Context

- **Language/Version**: TypeScript 5.7、Node.js >=20.19，依 server/package.json。
- **Primary Dependencies**: 現有 NestJS 11、Fastify 5、TypeORM 0.3、class-validator、BullMQ、Nodemailer；無新依賴。
- **Storage**: MySQL 8.4 保存指派／證據／通知；Redis 7 保存組織快取、OTP、credential 與 queue；沿用受控 PDF storage。
- **Testing**: Jest unit、HTTP／MySQL／Redis e2e、schema tests；僅合成資料與隔離測試資源。
- **Target Platform**: 現有 HTTP server 與獨立 worker。目前沒有 UAT、PRD，不包含部署。
- **Project Type**: pnpm workspace 後端功能與 API 契約交付。
- **Performance Goals**: 支援 6,000 人信箱核對；每批最多 100 人、同次最多 4 批併發、每批 10 秒逾時。上游等待不持有文件鎖，不自動重試。容量驗收記錄耗時，不宣稱目前未量測的 SLA。
- **Constraints**: 無新表／環境變數／排程／fallback／email cache；修改既有 signer 約束與索引。缺信箱擋整份發起，同信箱逐人照寄，發起後地址固定。
- **Scale/Scope**: 後端選人、信箱、發起、邀請、OTP、簽署／拒簽、下載、催簽及補簽；前端不實作。

## Constitution Check

| 原則 | 設計前與 Phase 1 再檢核 |
| --- | --- |
| I. KISS／YAGNI | 沿用服務與 worker，只新增必要 POST 資源及 schema 約束調整；無新表／排程／依賴。通過。 |
| II. Server 權威 | 後端查 userId→員編→email，交易內重驗身分映射；地址在 snapshot/hash 前固定，不重算歷史證據。通過。 |
| III. 最小權限 | 1.4.0 外部限定與需求衝突；已依使用者明確的內部 Email＋OTP 決策修訂 1.5.0。仍一人一文件、不得授予一般 session。公開 task 裁切內部資料。修訂後通過。 |
| IV. 邊界／REST | 身分解析用 POST；candidate GET 改唯讀，不隱性建帳。來源在 infrastructure、業務在 esign、Controller 只負責 HTTP。通過。 |
| V. 驗證 | 計畫涵蓋 migration、來源、交易、OTP／跨人／重放、worker、外部回歸；後續實作已執行 unit、schema、HTTP／security與容量，結果及未驗證代理界線見quickstart。通過。 |

憲章修訂依本次需求及 Q4／Q6 的既有核准，不增加一般登入或管理授權。實作交付仍須重新執行品質門檻。

## Project Structure

### Documentation (this feature)

```text
specs/010-internal-email-signing/
├── spec.md
├── plan.md
├── tasks.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── contracts/
    ├── employee-email-api.md
    ├── signing-notifications-api.md
    └── frontend-handoff.md
```

### Source Code (repository root)

```text
server/src/
├── common/errors/
├── infrastructure/http-client/feastogether/
│   ├── feastogether.client.ts
│   ├── services/feastogether-hr.service.ts
│   └── types/
├── infrastructure/database/migrations/
├── features/esign/
│   ├── controllers/
│   ├── dto/
│   ├── entities/esign-signer.entity.ts
│   ├── repositories/
│   └── services/
└── worker/esign/external-invitation.processor.ts
server/test/
```

**Structure Decision**: 在現有責任位置實作。可新增 feature 內 `EsignEmployeeEmailService` 共用預覽／發起的批次核對；不建立跨 feature 抽象。保留現有 External 類別及路徑名稱，它表示 Email 存取通道而非 signer 類型。同步 `server/src/infrastructure/database/schema.sql`。

## Phase 0 — Research

詳細依據與替代方案見 [research.md](research.md)。已收斂：組織快取沿用、選人建帳改 POST、信箱稀疏回應逐筆核對、schema 修改、Email 通道共用、舊內部操作封閉，以及補簽自動寄信與通知世代檢查。

## Phase 1 — Design

### 1. 選人及信箱檢查（FR-001～004、015）

- org-chart 保持 Spec 006 行為。新增 POST resolutions 只解析已選員編並建立必要帳號，GET candidates 改純本機查詢，不匯入整棵樹。
- 新增文件範圍的 POST employee-email-checks，僅草稿建立人可查 input.userIds；不保存預覽、不修改草稿。只回員工對應、狀態及遮罩信箱。
- `FeastogetherHrService` 經既有 client 查 staff_emails；強制 success envelope 與 runtime parser。缺人／不合法 email 為 unavailable；結構錯誤、重複或請求外員編、來源失敗回 502。上游 401/403 不轉成員工登入錯誤。
- `FeastogetherClient` request／unwrap 的兩份 omitBody 清單均加入此端點；不得記錄員編清單或來源信箱。

### 2. 發起與固定快照（FR-004～006）

1. 驗證 input、建立人及草稿，查此次 request 的 userId→empid；無內部人員不查信箱。
2. 交易外每 100 人拆批、最多 4 批併發；全部完成再往下。缺信箱回 422 列出 userId；任一來源失敗回 502。失敗停止派新批次並收束已派請求，不產生部分發起。
3. 開交易鎖文件，重驗建立人／草稿／本機帳號有效性及同份 input 的身分映射；異動回 409，不套用查詢前的錯誤映射。
4. 維持 initiation 接完整名單／欄位並整批取代草稿的現行語意，不新增 revision。將地址套入 user signer 後才建 snapshot/hash；schemaVersion 2 已有 email，不改歷史 payload。
5. 所有 signer 各建 token、expiry、通知 batch/log，與 active／audit 同交易；提交後入既有 queue。不依 email 去重。

查信箱失敗時文件仍為草稿；SMTP 失敗則文件已發起，沿用既有持久通知與重試／補償。不得把寄信失敗回報成未發起並引導重建文件。

### 3. Schema 與證據（FR-005、017）

見 [data-model.md](data-model.md)。保留 user unique；放寬 user email／邀請欄位 CHECK，增加 derived external_email 唯一性替代全體 email unique。無新表、無資料回填。rollback 遇不相容新資料須在 DDL 前拒絕，不得清空資料以湊回舊 schema。

### 4. Email 存取及舊入口（FR-007～013、016～017）

- Access policy 接受 user／email，但必須有固定 email、邀請世代與正確文件關聯；signed／rejected 只略過期限，不略過驗證。
- 沿用邀請→OTP→獨立 credential→cookie。`kind:'external'` 代表驗證通道，內部 signer.type/userId 不變，不以一般員工 session 生成此 principal。
- 舊內部個人 open／source／sign／reject／completed-file 先驗本人指派，再回 403 `ESIGN_EMAIL_OTP_REQUIRED`。service 的 internal principal 簽署／拒簽及重送路徑亦拒絕；不僅擋 controller。列表 metadata 與建立人管理權限維持。
- Email task 對員編／部門／職稱回 null，不回 userId 或建立人資訊；保留必要本人姓名、收件地址、狀態、欄位及副本狀態。OTP 前只顯示遮罩地址，不直接序列化 entity。
- 沿用 authenticationMethod=`email_invitation` 與現有 audit 名稱，歷史 employee_session 證據不改寫。

### 5. 通知與補簽（FR-014）

- 初次通知、worker claim、creator detail delivery、reminder eligibility／all_pending 改為支援所有具固定地址／邀請的指派。每日限額依 signerId，非 email。
- 補簽先確認所有 pending 指派具固定地址與原邀請；缺者整次 409，不回填。只輪替 pending，signed／rejected 不寄不輪替。
- 同交易作廢舊未完成通知、輪替、建立 invitation batch/log；提交後 enqueue。新初次／補簽 log 使用既有 invitationGenerationSha256；worker claim／finish 均比對世代，未 claim 的舊 log 不再寄送。已 claim 且在途的 SMTP 可能送達舊信，但舊 token 必須失效，完成／失敗回寫不得覆寫新通知、寄送狀態或清除新 token。沿用文件→通知→簽署人鎖序，不跨 SMTP 持有長交易。
- 補簽後 creator detail 顯示最新邀請寄送狀態，不再一律 null；沿用 kind=invitation，不新增通知種類。
- `reopening-invitations` 正常略過已寄送清除密文的項目，全部送完回 []；仍有密文卻損壞才回 503。清單不再保證涵蓋所有待簽者，前端改以通知紀錄追蹤。不得為永久複製連結而保留密文。

### 6. 契約及驗證交接

完整契約：[員工與發起](contracts/employee-email-api.md)、[簽署與通知](contracts/signing-notifications-api.md)。實作同步 Swagger／錯誤碼，未實作的新端點不得宣稱可呼叫。驗收依 [quickstart.md](quickstart.md)；前端畫面驗收由後續工程師執行。

## Complexity Tracking

無未解決的憲章違反；必要設計如下。

| 項目 | 必要性 | 未採方案 |
| --- | --- | --- |
| POST resolutions | 已選未建帳員工需本機 userId，建帳不能藏在 GET | 不匯入全公司、不把員編當 userId |
| POST email-checks | 已選名單預覽與逐人錯誤，名單不進 URL | 不信任 client 地址，不用 GET 傳全名單 |
| derived external_email＋unique | 保留外部 DB 去重，同時允許內部同信箱 | 移除 unique 失去 DB 保護；加 signer_type 仍阻擋同信箱 user |

## 已知限制與交付邊界

- 此次不修改 client；舊前端須接 POST 才能首次解析未建帳員工，個人操作須轉 Email OTP；不得宣稱畫面已完成。
- staff_lookup 只接受 5–8 碼英數片段；超出此長度且本機沒有帳號者無法解析，不以 org cache 作為建帳資格。
- 6,000 人已以真實 HTTP／MySQL／Redis 與合成來源量測，詳見 quickstart；未量測真實 HR、Next rewrite 或反向代理期限。60 批、4 併發、10 秒單批逾時可能累計約 150 秒來源等待，另加 DB／入列，不宣稱 SLA，不新增背景發起流程或環境變數。冷匯入帳號目前逐人查詢，不能以本機帳號命中容量推論冷匯入速度。
- 既有 DELETE session 路徑不在 cookie Path 下，瀏覽器可能不帶 credential。本次不依賴該操作授權或宣稱完整登出，8 小時到期維持；完整登出修正不擴入本次。
- setup-plan 時的邏輯 feature pointer 與原 dev 基準保留於歷史紀錄；使用者授權實作後改用功能整合分支，未更新 dev 部署。
