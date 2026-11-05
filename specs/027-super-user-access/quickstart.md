# Quickstart：Spec 027 實作後驗證指南

本文件描述實作完成後要執行的流程。各 ticket 實際執行的驗證只記在文末「驗收記錄」；1～6 節仍是待執行流程，不是已通過的測試紀錄。

## 前置

- 使用現有pnpm workspace與Node >=24.22.1，MySQL／Redis可用；整合測試只用 `feastogether_intranet_test*`，保留既有fail-closed防護。
- 按 [operations](contracts/operations.md) 產生專用密碼hash並填測試／本機設定；不要把帳密或入口原值寫進測試快照、PR或log。
- OAuth／WebView fixtures沿現有測試，外部OAuth成功流程使用現有受控測試環境；本plan未操作上游。
- DB migration先在隔離空庫及帶既有員工session／文件關聯的測試庫執行；正式環境不得照抄測試命令。

## 建置與自動驗證

```bash
pnpm -C server lint:check
pnpm -C server test --runInBand
pnpm -C server build
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm -C server test:schema
pnpm -C client lint
pnpm -C client build
pnpm build
pnpm lint
```

root lint可能包含server自動修正，執行前確認工作目錄；不能藉此覆蓋其他任務變更。client無test script，不宣稱跑過client自動測試。跨package變更需root build/lint；無外部服務時明確列出未執行項。

## 1. 初始化與登入（US1、US3）

實作後啟動：

```bash
pnpm -C server repl:dev
```

REPL依序 `await auth.initialize()`、`await auth.credentialStatus()`、`await auth.currentEntry()`。首次一列／一組初始化事件；再次initialize不換網址、不改版本。以同源瀏覽器開回傳path、輸入帳密；成功顯示Super user、cookie為HttpOnly。登入後URL回 `/`，頁面不殘留密碼。

測試錯密碼、未知帳號、無效／舊入口、超限、8KiB超限、缺Origin／跨站、缺trusted IP、Redis不可用、DB不可用。預期狀態見 [API契約](contracts/api-behavior.md)；錯密碼不撤原員工會話，不將登入401當成全站員工過期。

## 2. 會話相容與替換（US2）

- OAuth與WebView同員編取得同一本地user，user欄位仍可供EmbedBridge比對。
- employee→super→employee雙向切換；保存舊cookie僅在測試記憶體，直接重放應401。另一瀏覽器獨立會話不受影響。
- 同一有效舊cookie同時提交兩次登入，只有一次成功，另一409且無Set-Cookie；新session與舊revoked關聯一致。
- KDF／OAuth／Portal失敗或DB rollback不得撤原會話；commit後網路丟失重新登入，不回復舊token。
- 共用cookie正式環境SameSite=None+Secure，本機Lax；八小時不滑動。iframe舊流程仍可用。
- Super user session不依賴users列；user:null、actor.kind明確。員工業務在028前403，不能用任何假員工ID。
- 登出清目前cookie、撤session，不恢復舊身分。移除的POST auth/login及dev入口不得發session。

## 3. 入口輪換與並發（US3）

以測試注入時間（不新增production時間env）覆蓋週一03:59:59／04:00、跨年、停機兩週。worker job與startup catch-up並發，entryGeneration只加一次，舊GET／POST皆404；既有super session仍有效。重啟同週不換網址。

清除測試Redis的該queue排程再啟動worker，仍依DB補一次。輪換DB失敗保持舊key；retry成功只有一個新週期。純REPL查詢不改row、啟動不出現queue consumer／mail／S3／Portal連線。

驗證舊表單提交與輪換競態：輪換先commit則登入404；登入先commit則session有效。HTTP／console兩種啟動均不得註冊週排程。

## 4. 跨實例帳密輪換（US4）

兩個測試server共享DB／Redis但載不同帳密設定。舊設定已active時新設定登入503；以新設定REPL activate一次後，舊session於兩實例皆不能用，舊實例不能新登入且不能改回DB版本。新實例可新登入，員工session兩側仍有效。

same fingerprint activate no-op；錯expectedGeneration拒絕；同設定重啟不撤會話；再啟用舊設定也要新generation，之前舊session不能復活。版本啟用與舊super revoke／安全事件須同交易，故障注入驗證rollback。

## 5. UI與紀錄邊界

- 無效entry的HTML與RSC都不能含帳密表單，pre-render proxy檢查不可只放layout；entry驗證GET無Set-Cookie及DB寫入。
- 正常登入、401／404／409／429／503、guard及SSR例外，檢查Nest log、Next log、nginx access/error log沒有入口原值、密碼或cookie；REPL currentEntry是唯一指定主動揭露。
- 頁面no-store／no-referrer／noindex且不能iframe；此限制不得套到WebView或一般嵌入頁。
- 身分切換清舊query cache，Super user標示與登出可用；與入口網不匹配時按既有EmbedBridge流程重新launch。
- 安全事件只有白名單欄位；不新增簽署事件鏈、不碰既有證據。

## 6. Migration／回復

隔離測試庫驗證apply→down→apply；down僅空維護資料允許，有安全事件／維護session時應明確拒絕資料損失。既有employee session保持有效、users與文件FK未變、CHECK與entity一致；使用專案schema dump工具更新快照。部署／回復按operations，不在此指南提供正式刪表命令。

## 驗收記錄

各 ticket 實作者以獨立小節記錄：實際指令與結果、未跑原因、schema 變化、兩實例測試、iframe 瀏覽器結果、代理遮罩證據（不得包含敏感值）。未列出的 1～6 節項目尚未執行。

### 027-02 共用會話與 schema（T001～T014、T053）

範圍只有持久約束、repository、SessionService 與員工相容；隱藏登入頁、REPL、週排程與前端尚未存在，1、3～5 節不適用。

- schema（6 節）：`pnpm -C server test:schema` 6 suites／39 tests 通過，其中 `test/super-user-schema.e2e-spec.ts` 7 tests 在 `feastogether_intranet_test_a_<hex>` 臨時庫驗證：空庫 apply 後欄位型別／NULL／CHECK／FK／unique／索引與 entity 無 drift；既有員工 session（validating、failed、pending、active、revoked）回填 `employee`、其他欄位與 users／文件關聯不變；空維護資料 down 後 `SHOW CREATE TABLE auth_sessions` 與原定義相同，再 apply 無 drift；歷史 active 列缺 `expires_at` 時整個 ALTER 失敗、不留新欄位或新表；有安全事件、維護入口或 Super user 會話時 down 拒絕且資料不變。結束後無殘留臨時庫。
- 開發庫 `feastogether_intranet_027a`（只經 `server/.env`）：空庫 `pnpm -C server migration:run` 全部 21 支成功 → `migration:revert` 撤 `SuperUserAccess1793836802000` 成功（兩表與三欄消失）→ 寫入一筆合成員工 active session 後 `migration:run`，該列回填 `employee`／generation NULL／replacement NULL → 再寫入一筆合成 Super user 會話，`migration:revert` 以「無法回滾…」拒絕，migration 紀錄仍在 → 刪除合成列，保留已套用狀態。`pnpm -C server schema:dump` 更新 `server/src/infrastructure/database/schema.sql`：新增 `auth_security_events`、`super_user_access` 與 `auth_sessions` 三欄／兩索引／一 FK／兩 CHECK；`users`、`esign_export_jobs` 僅欄位順序與實際 migration 結果對齊，`esign_initiation_jobs` 由手寫格式改為 mysqldump 正規格式，結構相同。
- 會話（2 節中可在本張驗證的部分）：`test/security-actor-session.e2e-spec.ts` 7 tests 對真實 MySQL 驗證員工回應保留原 user 並新增 actor、Super user 會話 `user_id` NULL 且員工 guard 回 401、停用／soft-deleted 員工拒絕、DB 版本失配拒絕、本機 fingerprint 不符或入口 soft-delete 回 503、同一舊 token 並行替換一筆成功另一筆 409、替換中途失敗 rollback 保留舊會話、登出撤銷與事件倒序分頁。「兩個帶不存在 cookie 的登入都鎖定後才插入」一案在 REPEATABLE READ 下 2/2 次重現 deadlock，改用 READ COMMITTED 後通過。八小時不滑動、過期與撤銷另由 `session.service.spec.ts` 驗證。
- 員工回歸：`pnpm -C server test` 122 suites／1238 tests、`pnpm -C server test:e2e:security` 15 suites／91 tests、`pnpm -C server build`、`pnpm -C server lint:check`（0 errors；新檔無 warning）。
- `pnpm -C server test:e2e`：542 passed／1 skipped／1 failed；失敗為 `api-coverage` 的 `GET /api/esign/documents/{id}/history`（路由已在本張前由 `9344734` 移除，但 003 openapi 仍列出），與本張無關。`webview-session`、`oauth-login`、`password-login` 3 suites／36 tests 通過。
- 未執行：client lint／build 與 root build／lint（本張未改 client）；兩實例、iframe 瀏覽器、代理遮罩（尚無對應功能）。
