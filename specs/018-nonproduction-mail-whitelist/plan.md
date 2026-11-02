# Implementation Plan: 非 production 寄信白名單

**Branch**: `docs/spec-018-mail-whitelist` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Spec 018；setup-plan feature 識別為 `018-nonproduction-mail-whitelist`，實際 Git 分支如上。

**Status**: 依已確認的本機 tickets 01–05 實作；01–04 已整合，05 完整驗證與 code review 進行中。未部署或寄送真實郵件。

## Summary

新增使用者確認的七欄白名單表。只有 production 略過政策，其餘合法環境在每次 send／sendOtp／sendInternalGroup 前讀有效規則並核對實際信箱。以一個具體共用寄信入口套住既有 SMTP／fake adapters，不建立泛用授權框架。規則使用可信 HR 員編／部門與信箱，與文件部門權限及 Spec 017 無相依。

blocked 明確跳過、不重試；資料來源故障屬確定未寄送的檢查失敗；SMTP 已開始後仍沿既有不明結果與防重寄語意。OTP blocked 不存新碼、不回報 sent。

## Technical Context

**Language/Version**: 既有 TypeScript、NestJS 11／Fastify server；Next.js 16／React 19 client 僅更新通知原因文案。

**Primary Dependencies**: TypeORM、MySQL 8.4、Nodemailer、BullMQ、既有 Feastogether HR client；不新增 dependency。

**Storage**: 新增 mail_recipient_whitelist；沿用通知 logs、Redis OTP 與批次租約，不新增其他表或 Redis 快取。

**Testing**: server Jest、隔離 MySQL／Redis E2E、安全與 schema tests；SMTP mock 檢查實際 envelope，fake adapter 經同一政策。

**Target Platform**: HTTP server 與獨立 worker，development／test／staging／production。

**Project Type**: pnpm workspace 的 Web／worker 系統。

**Performance Goals**: 每次寄送呼叫讀一次有效規則；同次群發共用解析，不為每個地址重抓組織樹；staff_emails 每批最多 100 員編。授權查詢不得跨呼叫快取，避免撤銷無法立即反映。

**Constraints**: 僅七個核准欄位；無管理 API／頁、無 env 開關、無自動同步或排程、無測試轉寄；production 不執行僅為白名單新增的 DB／HR 查詢。

**Scale/Scope**: 三個精確部門與一位額外員工起步，可隨時增刪；涵蓋邀請、催簽、群發與 OTP，不假設員工已建立本地 User。

## Constitution Check

| Gate | Phase 0／Phase 1 結果 |
|---|---|
| KISS/YAGNI | 通過：使用者明確要求一張白名單表；一個必要共用 sender、一個政策 service，無泛用框架 |
| Server 權威 | 通過：可信 HR 身分／信箱與寄送當下規則，不信任 client、文件建立部門或寄件人 |
| 最小揭露 | 通過：白名單不存信箱，log 不輸出名單／OTP／邀請；信箱只在必要寄送記憶體使用 |
| 證據完整性 | 通過：不改文件、簽署資格、簽署證據或 Spec 017 |
| 清楚邊界 | 通過：單一公開寄送 token、內部 adapters 不提供旁路，OTP／worker 明確消費結果 |
| 驗證 | 通過：env、撤銷、混合群發、來源故障、OTP、retry 與 migration 皆有驗收設計 |

全部需求已確認，無待釐清的產品決策。未知上游真實容量以合成負載驗證，不新增未經確認的 SLA。

## Project Structure

### Documentation

```text
specs/018-nonproduction-mail-whitelist/
├── spec.md
├── impact-analysis.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/mail-whitelist.md
├── quickstart.md
└── checklists/requirements.md
```

### Source Code

```text
server/src/infrastructure/mail/
  mail-recipient-whitelist.entity.ts
  mail-recipient-whitelist.repository.ts
  mail-recipient-policy.service.ts
  guarded-invitation-mail-sender.service.ts
  mail-recipient-policy.errors.ts
  invitation-mail-sender.port.ts
  mail.module.ts
server/src/infrastructure/database/{mysql,migrations,schema.sql}
server/src/infrastructure/http-client/feastogether/
server/src/config/app.environment.ts
server/src/worker/esign/external-invitation.processor.ts
server/src/features/esign/services/{external-access,external-otp}.service.ts
client/src/features/esign-documents/notificationLabels.ts
```

**Structure Decision**: Entity／repository 屬 mail 基礎設施責任；repository 依既有規則由 MysqlModule 註冊／匯出、service 傳入 manager。MailModule 匯入 MysqlModule 與既有 FeastogetherModule，不從業務文件／簽署 service 反向取部門。保留一個 INVITATION_MAIL_SENDER 對外 token；其 provider factory 建立包覆 SMTP 或 fake 的具體 sender，底層 adapter 不另 export 成可繞過政策的 provider。

## 實作順序

1. **Schema／維護**：七欄、唯一鍵與 constraint、schema.sql、up/down；獨立一次性四筆初始資料步驟，不能每次啟動 seed。缺表或查詢失敗不得放行。
2. **環境／解析政策**：明確 NODE_ENV 必填；production 直接走原 sender，其他合法值查 DB／HR；取得允許信箱集合，與實際地址比對。
3. **共用寄送入口**：send／sendOtp 保留 Promise<void>，blocked／檢查故障用型別化錯誤；group 增加 blocked／check-failed 結果，過濾後才交 adapter，再合併逐人狀態。
4. **結果整合**：worker 三條通知路徑補 skipped／failed 與租約清理；OTP 補 recipient-blocked 結果與對外一般失敗頁，成功語意不變。
5. **初始資料與 UI**：受控一次性維護步驟加入三部門、一員編；既有通知畫面顯示原因。無新增維護 UI/API。
6. **驗證**：產生假 HR／SMTP 的合成環境與故障案例，所有非 production E2E fixtures 需經政策，不用全域 mock 成允許；完成 lint／單元／schema／E2E／build。

## Seed 與部署

- Schema migration 不綁環境也不預設 production 以外的任一特例；應用環境 DB 各自維護。
- 初始四筆規則以單次、可審查的資料腳本／操作文件套用，與 schema 分離；不在啟動、重試或發信時自動補資料。
- 停止相關寄送工作後先加表與初始資料，確認規則，再部署政策 sender 與 worker 結果處理一起上線；舊 worker 未更新前可能繞過政策，切換窗口不能混跑新舊版本處理郵件。
- production 只略過政策，不改 SMTP TLS／認證／正常收件人驗證；非 production 不用假 production 設定測試。
- 回滾舊程式會移除保護，必須先停止非 production 寄送；保留表與規則供修復，不直接刪表恢復無限制寄送。

## Phase 1 產物

- [research.md](research.md)：可信身分解析、sender／OTP 結果及無跨呼叫快取決策。
- [data-model.md](data-model.md)：七欄、四筆初始資料與維護語意。
- [contracts/mail-whitelist.md](contracts/mail-whitelist.md)：內部寄信介面、worker、OTP 與 HTTP 行為。
- [quickstart.md](quickstart.md)：可執行驗證指南，不代表已通過。

## Complexity Tracking

無違反 constitution 的例外。新增具體共用 sender 是三種寄信方法與兩種 driver 共享同一安全邊界的最小必要實作，不擴充成 registry／plugin／策略框架。

## 實作追蹤

本功能未另外建立 tasks.md；使用者確認後採 `.scratch/018-nonproduction-mail-whitelist/issues/` 的五張 tickets 追蹤相依與驗收。01 維護 → 02 共用政策／單人邀請 → 03 群發／催簽與 04 OTP → 05 整合驗證。正式環境操作依 [maintenance.md](maintenance.md)，驗證紀錄見 [quickstart.md](quickstart.md)。
