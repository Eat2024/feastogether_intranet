# 07: 明確啟用新帳密並跨實例撤銷舊維護會話

**What to build:** 維護者準備新設定後，以 REPL 明確啟用該版本；提交生效後所有舊維護會話失效，舊配置實例不能恢復舊憑證，而員工會話繼續運作。

**Status:** resolved

**Blocked by:** [04-hidden-login](04-hidden-login.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T045、T046、T047、T048、T049。

## Acceptance Criteria

- [x] activateCredentials 僅讀本機已驗格式的設定，要求 expectedGeneration CAS；不接受任意帳密參數，不在啟動時自動覆寫 DB 版本。
- [x] 新 fingerprint 增加 generation、更新生效時間、撤銷全部 active 維護會話及寫事件同交易；錯 expectedGeneration 拒絕，相同 fingerprint no-op，故障整筆 rollback。
- [x] 每次登入及驗會話沿用本機／DB active／session 三方版本檢查，不另加快取；再啟用舊設定也必須增加 generation，舊會話不復活。
- [x] 使用兩個共享 DB／Redis、載不同設定的真實測試實例，證明未啟用新設定登入 503，啟用後舊會話兩側拒絕、舊實例不能新登入，新設定可登入。
- [x] 原員工會話在兩側仍有效；相同設定單純重啟不撤維護會話。測試不得以單一程序改 env 代替雙實例。
- [x] 記錄 commit 生效點、混跑期間維護 503 與全實例更新的完成條件，不宣稱零中斷或只更新部分實例便完成。

## Comments & Implementation Results

### 2026-11-05 實作結果（分支 `027-07-credential-activation`，實作 commit `ba59653`）

**變更摘要（只有 server，無 client／migration／schema 變更）**

- `server/src/features/auth/services/super-user-credentials.service.ts`：新增 `SuperUserCredentialsService.activate({expectedGeneration})`，回傳 `{activated}`，在一個交易內依序：
  1. 以 `findForUpdate` 鎖 singleton；未初始化回 503 `AUTH_SUPER_USER_UNAVAILABLE`。
  2. 比對 `expectedGeneration`，不符回 409 `AUTH_SUPER_USER_GENERATION_CONFLICT`。即使本機設定已是啟用版本，也先比對版本。
  3. 本機 fingerprint 已是啟用版本時回 `{activated:false}`，不寫入。
  4. 否則把 fingerprint 換成本機設定，generation 加 1，`credential_activated_at` 設為取得鎖後的時間，以 `save` 寫回。
  5. 撤銷全部 active 維護會話，寫入 `credentials.activated`（actor `operator`、outcome `succeeded`、新 generation）。
  - 只讀 `SuperUserConfigService.fingerprint`（啟動時已驗格式），沒有任何帳密參數，也沒有任何啟動 hook。交易維持預設隔離等級。
- `AuthSessionRepository.revokeActiveSuperUser`：先以非鎖定讀取取得 active 維護會話的 id，再依主鍵加 `status='active'` 條件更新為 revoked。
  - 若直接以 `actor_kind／status` 條件 UPDATE，InnoDB 會經含 status 的次要索引先鎖索引列再等主鍵，與「Super user → 員工」切換或登出互相等待而 deadlock。這兩條路徑都不鎖 singleton，會先鎖舊會話的主鍵再改 status。
  - 改成依主鍵更新後就不會 deadlock，等待期間已被撤銷的列也不會被覆寫 `revoked_at`。
  - 在 singleton 鎖住期間，新的維護會話無法建立，所以先讀 id 不會漏撤。
- `SuperUserAccessRepository.save`：更新已鎖定的 singleton（AuditableEntity 依規定用 save）。
- `SuperUserAccessModule` 加入 provider；`server/src/console/repl.ts` 的 `createAuthConsole` 新增 `activateCredentials`。
- `app-error-code.ts`／`app-errors.ts` 新增 `AUTH_SUPER_USER_GENERATION_CONFLICT`（409），訊息「expectedGeneration 不是目前的帳密啟用版本，請以 credentialStatus() 確認後再啟用」。只有 REPL 會用到，client 沒有對應。
- `SessionService` 的本機／DB／會話三方版本檢查原樣沿用，沒有修改，也沒有加快取。
- 測試：
  - `super-user-credentials.service.spec.ts`：9 tests。
  - `test/super-user-console.e2e-spec.ts`：helper 清單加入 `activateCredentials`，並在檔尾新增 `describe('activateCredentials')`，共 4 tests。
  - `test/security-super-user-credentials.e2e-spec.ts`：6 tests，已在 `jest-e2e-security.json` 白名單內。
  - `test/helpers/run-auth-console.ts`：讓子程序載入指定設定，執行一個 REPL helper。
- 文件：`specs/027-super-user-access/tasks.md` 勾選 T045～T049 並註明偏差；`quickstart.md` 新增「027-07」小節，含生效點、混跑 503、完成條件與驗證紀錄。

**改到的共用檔案（與 06 序列整合時注意）**

- `server/src/console/repl.ts`：`createAuthConsole` 加一個 import、一個 `app.get` 與一個 helper。
- `server/test/super-user-console.e2e-spec.ts`：
  - 頂部加 `node:crypto` 與 `AppException` type 的 import。
  - helper 清單測試的標題由「三個」改成「受控的」，清單加入 `activateCredentials`。
  - 檔尾新增一個 describe。
- `server/src/common/errors/app-error-code.ts`、`app-errors.ts`：各新增一個條目。
- `server/src/features/auth/super-user-access.module.ts`：providers 多一項。
- `server/src/features/auth/repositories/super-user-access.repository.ts`：檔尾新增 `save`。06 若也新增同功能的方法，保留一個即可。
- 沒有修改 `super-user-access.service.ts`。

**驗證（實際指令與結果）**

- 先寫測試：
  - 實作前，unit spec 因找不到模組而失敗。
  - 只還原 `repl.ts` 與 module 時，`test:e2e -- super-user-console` 為 5 failed／9 passed，`test:e2e:security -- security-super-user-credentials` 為 4 failed／2 passed。通過的 2 個是啟用前的既有行為。
- 實作後：
  - unit spec 9 passed。
  - console e2e 14 passed，連跑 5 次相同。
  - 雙實例 e2e 6 passed，約 8 秒；結束後 3030／3031 沒有 listener，也沒有殘留程序或測試列。
- Mutation 檢查（都已還原）：
  - 改回單一條件 UPDATE：死鎖競態 2/2 次 `Deadlock found`。第一版實作是 READ COMMITTED 加單一條件 UPDATE，同樣 deadlock。
  - 拿掉撤銷：console e2e 2 failed，雙實例 e2e 3 failed。
  - 事件改用非交易 manager：console e2e 3 failed。
  - UPDATE 拿掉 `status='active'` 重驗：1 failed，`revoked_at` 被覆寫。
- `pnpm -C server lint:check`：0 errors、276 warnings，與本張前相同；變更與新增的 11 個檔案單獨跑 eslint 為 0 problems。
- `pnpm -C server test`：127 suites／1279 tests 通過。
- `pnpm -C server build`：成功。
- `pnpm -C server test:e2e:security`：17 suites／123 tests 通過。
- `pnpm -C server test:e2e`：51/52 suites 執行，556 passed、1 skipped、1 failed（50 suites passed）。新增的 console 4 tests 都通過。唯一失敗是 027-02 已記錄的既有 `api-coverage`「GET /api/esign/documents/1/history」（期望 401、實得 404），與本張無關。
- 雙實例：兩個獨立 HTTP 程序以 `src/main.ts` 啟動，A 是舊設定（3030），B 是新設定（3031），共用 `feastogether_intranet_test_c` 與 Redis DB 11。REPL 是另起、載入指定設定的程序。驗證結果：
  - 新設定實例啟動不改 DB；啟用前，B 的維護登入與 A 簽出的會話在 B 都回 503。
  - 舊設定實例以相同設定重啟，會話仍有效。
  - 錯誤的 expectedGeneration 回 409。
  - 新設定啟用後：舊會話在兩側都回 401；A 不能登入，重啟後也改不回 DB 版本；B 可以登入，B 的會話在 A 回 503。
  - 相同設定再啟用為 no-op。
  - 再啟用舊設定：generation 變成 3，先前會話都不復活，A 可以重新登入，B 回 503。
  - 員工會話全程兩側都是 200。
- REPL 實際展示：開發庫 `feastogether_intranet_027c`，`repl:dev` 與建置後 `repl` 都操作過，並以 3030／3031 兩個 HTTP 程序實測撤銷與 503。詳見 quickstart「027-07」小節。展示後已刪除 singleton、事件、會話與暫存密碼，兩個 HTTP 程序都已停止。

**未驗證／限制**

- 沒有在 UAT／正式的負載平衡多實例實測。
- 雙實例測試的員工會話是 SQL 建立的合成列，沒有走 OAuth／WebView。
- 未跑 `test:schema`（沒有 schema 變更），也未跑 client 與 root build／lint（沒有改 client）。
- 開發庫展示的 HTTP 程序用 `NODE_ENV=test`：`.env` 是 development 加 smtp，會連真實 SMTP。展示也補了 `.env` 缺少的開機必填合成值，Portal 指向不存在的庫。
- REPL 的 `credentialStatus()` 是唯一能看出某個執行環境設定是否已生效的管道，沒有 HTTP 診斷，這是契約設計。
- 單元測試另外驗證了字串 `'1'` 等非數字的 expectedGeneration 一律當成版本衝突，回 409，沒有另寫型別驗證。

**待決（規格未寫，未自行決定）**

1. 啟用時只寫一筆 `credentials.activated`（依 T047），不替每個被撤的會話寫 `session.revoked`。被撤的會話可以由 `revoked_at` 加 `credential_generation` 與事件的 generation 對應追查。若稽核要求逐筆事件，需要決定。
2. `contracts/operations.md` 沒有寫 `activateCredentials` 的回傳形狀，`api-behavior.md` 的錯誤碼表也沒有 REPL 用的 409 `AUTH_SUPER_USER_GENERATION_CONFLICT`。建議 T055 以實作為準補上。
3. `SessionService` 在「Super user → 員工」替換與 Super user 登出時都不鎖 singleton。data-model 的鎖序寫的是「涉及維護身分時」才鎖，這兩條路徑是否算在內並不明確。本張改在啟用端避開 deadlock，沒有動 `SessionService`。若 05 或之後要調整那兩條路徑的鎖序，請保留 console e2e 的死鎖競態測試。

**給 ticket 08 的備註**

- 生效點是 `activateCredentials` 的交易 commit：DB 版本切換、全部 active 維護會話撤銷與 `credentials.activated` 同時成立。
- commit 前：已換新設定的實例，維護登入與既有維護會話都回 503，員工照常。
- commit 後：
  - 舊維護會話在所有實例都回 401。
  - 仍是舊設定的實例，維護登入與新會話都回 503，直到它也換成新設定並重啟。
- 混跑期間，負載平衡後面只要還有舊設定實例，維護操作就會間歇 503，不能寫成零中斷。
- 部署文件（T052）的順序：
  1. 準備新設定的部署（新 env 與程式）。
  2. 在新設定的 REPL 執行 `credentialStatus()`，確認 `localConfigMatches:false` 並記下 generation。
  3. 執行 `activateCredentials({expectedGeneration})`；回 409 時重查 generation。
  4. 更新並重啟所有 HTTP 與 worker。
  5. 在每個執行環境的 REPL 確認 `localConfigMatches:true`。
  6. 在實際入口完成一次維護登入，才宣告完成。只更新部分實例不算完成。
- 任何實例啟動都不寫 DB 版本。要回復舊設定，必須在舊設定的 REPL 明確 activate，會得到更高的 generation，舊會話不會復活。
- 目前 worker 沒有載入 `SuperUserAccessModule`。06 若讓 worker 載入，worker 也需要合法的 `SUPER_USER_*`。worker 的設定新舊不影響維護登入，但操作契約要求 HTTP 與 worker 都要更新。
- `security-super-user-credentials` 會以 ts-node 啟動 `src/main.ts` 子程序並佔用 port 3030／3031，執行環境需要這兩個 port 可用；它只在 `test:e2e:security` 中執行。
- `server/.env` 留下展示用的合成 hash，對應密碼已丟棄；開發庫 `feastogether_intranet_027c` 已套用 21 支 migration，沒有 singleton、會話或事件。

### 整合紀錄

已合入整合分支 `027-super-user-access`（2026-11-05，fast-forward）：
- `51be9c9 feat(auth): 以 REPL 明確啟用 Super user 帳密並跨實例撤銷舊維護會話`
- `0d27992 docs(tickets): 記錄 027-07 實作結果、雙實例驗證與帳密啟用部署條件`

由 ticket 分支（ba59653、7cf40c4）rebase 到已含 06 的整合分支。衝突處理：`repl.ts` 兩邊 helper 都保留；`SuperUserAccessRepository.save` 兩邊重複新增，保留 06 的 `Promise<void>` 版本（呼叫端都不用回傳值）；`super-user-console.e2e-spec.ts` 保留兩邊的 import、helper 清單與測試區塊；`quickstart.md` 兩節都保留。合併後 lint、unit、build、security e2e 與相關 e2e 通過。
