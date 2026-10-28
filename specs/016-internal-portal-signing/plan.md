# 實作計畫：員工 Portal 登入與我的電子簽

**Branch**：`feat/016-internal-portal-signing`（PR #34）  
**Date**：2026-10-28  
**Spec**：[spec.md](spec.md)  
**狀態**：程式與本機整合驗證完成；真實 Portal／iframe 環境驗收及部署尚待進行。驗證及 FR 對應見 [validation.md](validation.md)。

## Summary

Email 使用 `http://portal.feastogether.com.tw/portal/login?redirect_to=hr/esign/mine`。依使用者最新決策，電子簽 UAT 與 PRD 都先連 Portal 正式機，不分環境、不新增網址設定。Portal 保留允許的目的地，在登入及必要改密碼後開啟既有電子簽 iframe。

內部指派以有效員工 session 授權，直接在「我的電子簽」閱讀、簽署、拒簽及下載本人副本；外部維持 OTP。內部邀請、催簽及補簽以同一文件／通知批次 BCC 群寄，每封最多 50 個不同地址；外部維持逐人。重用既有 API、交易、PDF、批次與逐人 log，無 Email 記 skipped，由人資另行通知。無新資料表、migration、套件、環境變數、登入方式或排程。

## Technical Context

| 項目 | 決策 |
| --- | --- |
| 語言／版本 | TypeScript、Node >=24.22.1；Portal PHP 沿用現有語法，部署 PHP 版本列入執行環境驗收 |
| 主要框架 | Next.js 16、React 19、MUI 9、NestJS 11／Fastify、TypeORM；Portal CodeIgniter 3.1.13 |
| 儲存 | 既有 MySQL、Redis、private file storage；Portal 既有 session |
| 測試 | server Jest／e2e／security；client lint/build + 瀏覽器；Portal PHP syntax、隔離目的地邏輯測試及手動整合 |
| 平台 | 桌面與窄螢幕瀏覽器、Portal WAMP |
| 專案形式 | 此 pnpm workspace 加獨立 `../portal` repository；分開交付 |
| 效能 | 延續既有最高 6,000 人名單與每批 100 人信箱查詢，不新增逐人遠端呼叫；無新延遲 SLA |
| 約束 | 身分、期限、文件完整性及重送由 server 驗證；敏感資料不進 URL/log |
| 範圍 | 本人任務、發起信箱檢查、通知／補簽、Portal 導頁；不實作 Spec 014 或人資通知系統 |

## Constitution Check

初始 gate：1.5.0 Principle III 禁止員工 session 替代 OTP，與使用者已確認的 Q1/Q2 衝突。本計畫同步修訂至 2.0.0，授權依本人指派，外部保留 OTP。記錄決策來源及歷史證據保護，不忽略舊規則。

| Gate | Phase 0 → Phase 1 結果 |
| --- | --- |
| KISS/YAGNI | 通過：重用端點、entity、worker、iframe；固定 Portal 正式機網址單一常數 |
| Server 權威與證據 | 通過：鎖內重驗身分與狀態；新證據 `internal_session`，不回填歷史 |
| 最小權限 | 通過：OTP 僅授權外部，員工 session 僅本人指派，保留副本完整性 |
| 系統邊界與 REST | 通過：開啟事件仍用 POST，GET 不新增業務寫入 |
| 驗證 | 設計通過：quickstart 定義必要測試；實際測試尚待實作 |

Phase 1 後沒有未解的設計 gate。Portal 部署版本、選單權限及 iframe cookie 為執行環境驗收事項，不宣稱已通過。

## Project Structure

```text
specs/016-internal-portal-signing/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── tasks.md
└── contracts/
    ├── internal-signing-api.md
    ├── portal-login.md
    └── notifications-and-cutover.md

client/src/features/signing-tasks/      本人任務 UI
client/src/features/external-signing/  共用表單參考與外部回歸
client/src/features/my-signature/sign/ PDF／簽名元件
client/src/features/esign-documents/   無 Email 發起提示
client/src/api/                        本人操作契約
server/src/features/esign/             授權、簽署、通知資格
server/src/infrastructure/mail/        內外部信件
server/src/worker/esign/                通知租約與重試
server/test/                          整合與安全測試
../portal/application/controllers/    Login、Account、hr/Esign
../portal/application/core/           WebController 登出清理
../portal/application/views/admin/account/modify_password.php
```

Portal 實作使用其 develop 衍生功能分支，保留既有 `index.php` 修改。本次僅唯讀調查 Portal，未切其分支。

## Phase 0：研究與決策

[research.md](research.md) 已確認登入協定、內部 API、證據欄位、可空 Email、通知 token 耦合、舊 OTP 封鎖與前端共用元件。無新技術依賴，採本機原始碼與使用者決策。原先考慮環境 URL 配置，因最新要求 UAT／PRD 均導 Portal 正式機，改採單一常數而不新增環境變數。

## Phase 1：設計與順序

1. **政策與契約**：憲章 2.0.0 與本次 contracts 為準；Spec 010 保留歷史，Spec 014 衝突規定指向 016；實作同步 Swagger、註解及測試。
2. **Portal**：新增 `application/config/login_redirect.php` 允許映射及薄的 `application/libraries/Login_redirect.php`，讓登入、改密碼與登出共用目的地管理。GET 驗證清單後保存 session，POST／失敗保留，成功取出時重驗映射並清除；需改密碼先完成待辦。初始只登記 mine，未來其他頁面只改清單，目的頁仍檢查權限。
3. **本人操作**：恢復 open/source/sign/reject/completed-file 內部 principal；查重前與交易鎖內都要驗證本人；新證據依 principal 分流。結果沿既有 GET 列表刷新，不新增單筆 GET。
4. **舊入口**：共用 external access 限 `signerType=email`。舊內部邀請只引導 Portal，不寄 OTP、不回文件；舊 cookie API 以固定錯誤與引導網址交接，不將 HTML 當 PDF。
5. **通知**：取消內部 Email 必要性，保留身分、上游故障與外部 Email 驗證。內部不產新邀請 token；producer／maintenance 以 batch 工作喚醒群寄，worker 將同組 log 原子領取、共用 lease，以一次 SMTP BCC 投遞。逐地址解析 accepted/rejected，映射回逐人 log；未明結果記 unknown、不自動重送。舊單人 queue 工作映射至同批群寄。補簽先 supersede 舊通知，無信箱記 skipped。細節以通知契約為準。
6. **前端**：重用既有 PDF／簽名／拒簽元件與最小共用表單，內外容器各自呼叫 API；移除返回 Email 提示。完成後刷新本人列表，副本以 GET 輪詢。建立文件頁信箱檢查不阻擋無 Email 員工發起。
7. **切換**：先完成 Portal 導頁，再協調 server/client/worker 同版切換，依 quickstart 驗收；plan 階段不部署。

## 資料、配置與驗收

[data-model.md](data-model.md) 定義欄位、狀態與不變量；無 schema migration。固定 Portal URL 集中於 server 既有 esign 常數位置，供 mail 與舊入口引導重用。不讀取 `AUTH_TRUSTED_ORIGINS` 推算路徑、不改外部 origin、不增環境變數。

[quickstart.md](quickstart.md) 定義驗收。主要風險：內部重送仍走 external policy、補簽仍要求 token、舊 worker 寄 OTP 信、前端或 snapshot validation 仍阻擋無信箱。Portal 正式機開啟哪一套電子簽由其既有配置決定；UAT 通知不會因此自動回到 UAT，也不跨環境同步文件。

Portal 與電子簽 session 獨立，本次不擴充跨系統全域登出；每次進入沿既有身分比對，電子簽 session 依既有期限與撤銷規則。

## Complexity Tracking

依使用者明確要求，共用回跳處理供 Login／Account／Logout 使用，新增一份非機密的版控允許清單及薄 library；不是新登入系統，也不新增環境變數或管理後台。它取代多個 controller 的電子簽專用判斷。憲章授權修訂由已確認需求支持；通知 generation 不再充當內部身分憑證。

Phase 1 後已依新增 BCC 決策更新本計畫，任務見 [tasks.md](tasks.md)。本次不實作、不提交或推送 PR。
