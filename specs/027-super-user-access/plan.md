# Implementation Plan: Super user 登入、隱藏入口輪換與 REPL 基礎

**Branch**: `fix/main-routes-session-404`（實際工作分支，未切換） | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: `specs/027-super-user-access/spec.md`。setup-plan 回報 `BRANCH=027-super-user-access` 是依 feature 推導的工作標識，不是實際 git checkout。

## Summary

沿用現有 MySQL opaque session 與同一 HttpOnly cookie，加入 employee／super_user 操作者聯集。新增隱藏登入頁，移除一般員工帳密入口；OAuth 與 WebView 保留且成功切換時原子撤銷舊會話。DB singleton 保存隨機入口與目前帳密版本；專用 worker 每週輪換入口，REPL 負責初始化、查詢與明確啟用帳密。獨立 security events 保存低頻登入／維護事件，不恢復文件簽署歷程。

027 只完成維護身分，不直接放行既有員工業務端點；全業務角色及資料授權由 028 接入。前端只有隱藏登入、必要操作者顯示及登出，選單改造由 029 執行。

## Technical Context

**Language/Version**: TypeScript；Node >=24.22.1；pnpm workspace。

**Primary Dependencies**: 現有 NestJS 11／Fastify／TypeORM 0.3、Next.js 16／React 19／MUI 9、BullMQ 5／Redis、openid-client 6.8.8。新增密碼驗證使用 node:crypto，不新增 npm dependency。

**Storage**: 沿用 MySQL 8.4 auth_sessions；新增 super_user_access singleton、auth_security_events append-only。Redis 僅既有 OAuth transaction／限流及新週排程 queue；不保存第二套維護 session。

**Testing**: server Jest 單元、MySQL／Redis Supertest e2e、schema migration 驗證；client 目前無 test script，以 lint/build 與瀏覽器驗收為準，不新增測試框架。全程測試 DB 名必須以 feastogether_intranet_test 開頭。

**Target Platform**: 既有 HTTP server＋獨立 worker＋Next client；staging／production HTTPS，仍支援入口網 iframe。

**Project Type**: pnpm monorepo web application，這一階段僅設計文件。

**Performance Goals**: 每次維護 session 驗證查 DB 當前版本，確保下次請求撤銷；密碼 KDF 僅登入執行、非同步，不在每次業務請求重算。登入限流沿用 10/60秒與50/300秒，排程每週一台北04:00觸發；依既有服務規模驗證，不宣稱未量測吞吐。

**Constraints**: 不讀寫實際 env；不假造員工；不破壞八小時 cookie 或 WebView；跨實例憑證切換不能被舊程序回寫；REPL 不啟動 HTTP／worker／Portal/mail/storage；隱藏入口原值不進一般 log。

**Scale/Scope**: 一個維護帳號、一個有效入口、多個 HTTP／worker 實例；一般員工 session 沿用既有量級。無角色表、權限表、授權管理前端或 OAuth 前端。

## Constitution Check

| 原則 | Phase 0 檢查 | Phase 1 設計後檢查 |
|---|---|---|
| I KISS/YAGNI | Spec 明確授權週排程、DB 入口及 REPL | 通過：無新套件／外部服務；新增具體 session service 為三入口共用；兩張表分別滿足入口一致與可追查 |
| II Server 權威／證據 | Super user 不等於員工簽署人 | 通過：actor 聯集；未轉換路由拒絕 super；027 不動任何簽署證據 |
| III 最小權限／資料 | 隱藏位置不得授權 | 通過：GET 只檢查已知位置，POST 仍驗帳密；log 遮罩跨 app／proxy；不存假員工或揭露密碼 |
| IV 邊界／REST | API 與 UI 分離；GET 不寫業務資料 | 通過：POST entry sessions、GET entry validity、共用 session read/delete；初始化／輪換僅受控寫入；worker／console 不載 AppModule |
| V 驗證 | auth／schema／並發風險需自動驗證 | 通過設計：quickstart 覆蓋失效、重放、並發、切換、部署版本、schema 與 iframe；尚未執行 |
| 工程限制 | 不碰使用者已有修改或實際 secrets | 通過：僅產出本 feature 文件；後續 migration／env.example 有明確需求來源 |

沒有未解決的憲章違反。既有憲章描述「未標 Public 驗員工」的落地規則須於 implementation 更新 server/AGENTS 相應段落：預設驗 actor，未允許維護者的業務仍 employee-only；不是把所有 endpoint 改為 Super user 通行。

## Project Structure

### Documentation (this feature)

```text
specs/027-super-user-access/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.json
│   ├── api-behavior.md
│   └── operations.md
└── checklists/requirements.md
```

本次不產生 tasks.md；下一階段才用 speckit-tasks。

### Source Code (implementation target，尚未建立)

```text
server/src/features/auth/
  auth.module.ts                         # HTTP composition，移除員工帳密依賴
  auth-session.module.ts                 # 無 controller/APP_GUARD 的 session service 組合
  super-user-access.module.ts            # 狹義登入設定、入口與版本 services
  controllers/super-user-access.controller.ts
  dto/session-view.dto.ts + super-user-login.dto.ts
  entities/auth-session.entity.ts         # actor、版本、替換關聯
  entities/super-user-access.entity.ts + auth-security-event.entity.ts
  repositories/                         # 仍由 MysqlModule 註冊匯出
  services/session.service.ts
  services/super-user-access.service.ts
  services/super-user-login.service.ts
  helpers/super-user-password.ts + rotation-period.ts
server/src/framework/guards/             # actor-aware AuthGuard、明確允許維護者 metadata
server/src/infrastructure/database/      # actor context、增量 migration、schema dump
server/src/worker/auth/                  # weekly scheduler/processor；只有 WorkerModule 載入
server/src/console/                     # ConsoleModule、repl.ts、離線 hash-password helper
server/src/framework/http/ + interceptors/ # 路徑、URL、body 遮罩
server/test/                            # auth、rotation、session replacement、schema e2e
client/src/app/ops-access/[entryKey]/page.tsx
client/src/features/super-user-login/    # MUI 表單、目前身分顯示
client/src/api/                          # 相容 session union、login request
client/src/proxy.ts                      # 隱藏頁 pre-render 驗證及目前 main route 防護相容
client/src/features/embed/EmbedBridge.tsx # 不以維護者冒充入口網員工
client/src/components/                  # 共用UserProfile身分顯示／登出，非管理頁
```

**Structure Decision**: 延用 feature→service→repository，不建新 workspace。ConsoleModule 自行組必要 config/logging/mysql，不 import 含 S3/mail 的 InfrastructureModule；worker 新 queue 只在 WorkerModule 註冊。重用舊 controller／cookie／錯誤框架，不複製 CKS AuthModule。

## Phase 0 結論

見 [research.md](research.md)：已完成本地 auth/session、CLS、cookie、proxy、EmbedBridge、worker、logging 盤點，並核對 Node crypto 與 BullMQ 官方資料。已解決 actor、跨實例撤銷、週期冪等與 REPL 副作用問題。

## Phase 1 設計與交付切片

1. **模型與共用會話**：增量 schema、actor union、SessionService，保留 employee 回應相容；三入口統一成功後替換交易。其餘員工業務在 028 前仍拒絕 super_user。
2. **維護登入與安全邊界**：環境設定格式驗證、scrypt、DB fingerprint/generation 驗證、Origin／rate limit、entry GET/POST、事件同交易。入口於密碼驗證後交易內重驗，不能把舊頁提交放行。
3. **維運與輪換**：專用 REPL、初始化、版本啟用、DB 周期鎖、worker cron/startup catch-up、failure retry（同周期冪等）；不在正常 HTTP startup 寫 DB。
4. **前端最小閉環**：proxy 在頁面渲染前檢查入口，Server Component no-store 再確認；MUI 帳密頁、登入後 replace `/`、employee與Super user共用UserProfile顯示／登出；EmbedBridge actor 分流。無效入口不得讓表單出現在 RSC payload。
5. **部署及回歸**：三層 log 遮罩、env.example／操作文件、schema apply/revert（僅空測試 DB）、資料保留、登入／輪換／並發／舊上游 regression。

每切片以 spec US 驗收，不把文件原型當成完成；前端會遇到尚未接入 028 的業務 403，需說明階段性限制，不為展示而放寬。

## 與 028／029 的契約邊界

- 027 提供 `actor` 與目前 session，維護身分沒有 employee id。028 接入全業務授權並設計非員工寫入歸屬；027 不新增 role schema。
- 028 沿用 SessionService、actor context 與 REPL context，增加權限 helpers；027 security events 不預先承接所有授權 audit。
- 029 使用 028 的能力契約；027 只維持身分切換後清空舊資料與必要標示。

## Complexity Tracking

無憲章違反。必要新增成本：一張 singleton（只靠 env／記憶體無法輪換及共用版本），一張窄 append-only 安全事件表（只靠可能失敗的 logger 無法保證成功維護操作可追查），一個既有 BullMQ queue（每週需求）。未加泛用管理框架、加密金鑰、額外人事表或登入 cookie。

## 驗證狀態

已完成靜態設計及文件／契約結構檢查，見 quickstart 的實作後清單。沒有執行服務、migration、真實 OAuth／Portal 或瀏覽器測試。extensions.yml 不存在，無前後置 hooks。可進入 speckit-tasks。
