# 01: 安全產生與驗證 Super user 專用帳密設定

**What to build:** 維護者透過不連外的互動工具產生 Super user 專用密碼雜湊；服務只接受符合契約的唯一 Super user 帳密設定，並能穩定辨識設定版本。這組設定與 OAuth 無關，不用於員工登入或 OAuth client 驗證。

**Status:** resolved

**Blocked by:** 無（可直接開始）

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T005、T011、T027。

## Acceptance Criteria

- [x] 離線工具以 TTY 無回顯輸入及二次確認取得密碼，只輸出 hash；不接命令列密碼、不載入 Nest／DB、不留密碼歷史。
- [x] 僅使用 server-only 的 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH` 驗證 Super user；不讀取、修改或共用 OAuth 員工帳密、client ID／client secret，不將這組帳密送往 OAuth 專案。一般員工保留 OAuth／WebView，後續僅共用 intranet 會話機制。
- [x] 僅接受兩個 Super user 專用 server-only 帳密設定與固定 scrypt 格式：N=32768、r=8、p=1、salt 16 bytes、derived key 64 bytes、maxmem 64 MiB；缺漏或格式錯誤明確失敗，沒有預設密碼或 fallback。
- [x] 帳號及密碼不 trim／normalize；非同步 KDF、固定長度安全比較，錯帳號仍執行相同 KDF 工作量。
- [x] fingerprint 使用契約既定 domain separation 與序列化；同一 hash 穩定，新 salt 視為新版本；本張不自動啟用 DB 版本。
- [x] 使用合成 fixture 驗證合法／非法設定、輸入邊界與 fingerprint 行為；不提交真實 secret、不新增密碼 dependency。

## Comments & Implementation Results

### 2026-11-05 實作結果（分支 `027-01-super-user-credential-config`，commit `afe2b10`）

**變更摘要（只有 server，無 client／migration 變更）**

- `server/src/features/auth/helpers/super-user-password.ts`：固定格式 `scrypt:32768:8:1:<salt-base64url>:<derived-key-base64url>`（salt 16 bytes、derived key 64 bytes、maxmem 64 MiB）。`hashSuperUserPassword` 產生新 salt；`parseSuperUserPasswordHash` 只接受固定參數、恰好兩段且長度正確的正規 base64url（以「解碼後重新編碼相同」排除 padding、標準 base64 字元與非正規尾端位元），不符回 `undefined`；`verifySuperUserPassword` 用非同步 `crypto.scrypt` 加固定長度 `timingSafeEqual`；`superUserCredentialFingerprint` = SHA-256(`super-user-credentials-v1` + NUL + `JSON.stringify([account, encodedHash])`)，輸出 hex 64 字元。另匯出 `SUPER_USER_PASSWORD_MAX_BYTES = 1024`。
- `server/src/features/auth/services/super-user-config.service.ts`：`@Injectable() SuperUserConfigService`，透過 `ConfigService` 只讀 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH`。建構時驗證，缺漏或空字串丟出 `環境變數 <KEY> 為必填`，hash 格式錯誤丟出含變數名與產生指令的訊息，兩者都不含設定值。對外提供 `readonly fingerprint` 與 `verify(account, password)`：先跑 KDF 再以 SHA-256 digest 加 `timingSafeEqual` 比對帳號，錯帳號與錯密碼工作量相同。帳密都原樣比對，不 trim／normalize。不讀寫 DB，也不啟用 DB 版本。
- `server/src/console/hash-super-user-password.ts` 與 `server/package.json` 的 `super-user:hash-password`（`node --conditions=development -r ts-node/register ...`）：stdin 不是 TTY 就拒絕；readline 的輸出導向丟棄 stream，所以不回顯，`historySize: 0`；密碼須為 1～1024 UTF-8 bytes 且二次輸入一致；stdout 只印 hash，提示與錯誤走 stderr。只 import Node 內建模組與上述 helper，不載 Nest、不讀 .env、不連 DB／Redis，也不讀命令列參數。
- 測試：`super-user-password.spec.ts`（固定參數 known-answer fixture、密碼不 trim／不 normalize、新 hash 格式與新 salt、13 種非法格式、fingerprint 契約字面值與新版本）、`super-user-config.service.spec.ts`（合法設定、4 種缺漏、格式錯誤訊息不含值、帳號不 trim／不 normalize（含設定端）、錯帳號／錯密碼／正確帳密都以相同參數跑一次 scrypt、fingerprint 穩定與新 salt）。fixture 全為合成值。
- `specs/027-super-user-access/tasks.md` 勾選 T005、T011、T027。

**驗證（實際指令與結果）**

- 先寫測試：實作前跑 `npx jest <兩個新 spec>`，兩個 suite 因模組不存在而失敗；實作後 2 suites／34 tests 通過。Node 24.22.1 與 26.4.0 都通過。
- Mutation 檢查：暫時把 `verify` 改成帳號不符就提早 return，「錯帳號都執行一次相同參數的 scrypt」測試失敗（1 failed／13 passed），還原後 14 passed。
- `pnpm -C server lint:check`：0 errors、276 warnings。5 個新檔單獨跑 eslint 時 0 errors、0 warnings，276 個都是既有 warning。
- `pnpm -C server test --runInBand`：120 suites、1222 tests 全部通過。
- `pnpm -C server build`：成功，產出 `dist/console/hash-super-user-password.js`。
- commit 時 pre-commit hook（`pnpm lint` 含 client lint，加 `pnpm -C server test --runInBand`）通過。
- 離線工具以 Python `pty` 模擬終端機實測：
  - 成功路徑：輸出中沒有密碼回顯，只有 hash；該 hash 用 helper 驗證時，正確密碼為 true、錯誤密碼為 false。
  - 兩次輸入不一致、空密碼、1025 bytes：都回 1，沒有 hash。
  - Ctrl-C／Ctrl-D：readline 以 AbortError 中止，回 1，沒有 hash（Node 24.22.1 與 26.4.0 都實測過）。
  - 管線輸入：回 1 並提示須在互動式終端機執行。
  - 帶命令列參數執行：參數被忽略，產生的 hash 只對應 TTY 輸入的密碼。
  - 建置後的 `node dist/console/hash-super-user-password.js` 同樣可用。
- lockfile 與 client 都沒有變動；新程式碼沒有引用 OAuth 設定或 client。

**未驗證／限制**

- `SuperUserConfigService` 還沒有註冊到任何 Nest module，本張範圍內沒有 consumer。「缺漏或格式錯誤即啟動失敗」目前只在建構層由單元測試證明，要等後續 ticket 註冊後才會變成 HTTP／worker／REPL 的實際開機行為。
- 工具未做 TTY 的自動化測試（專案沒有 pty 測試基礎設施，也不新增 dependency），以上述手動 pty 實測為證據。
- Ctrl-C／Ctrl-D 時終端機會出現 Node 的 AbortError 堆疊。內容不含密碼，屬 fail-closed，所以沒有另加 catch 美化訊息。
- 部署硬體上的 scrypt 延遲未量測；本機每次約 45 ms。

**給後續 ticket 的備註**

- 介面：`SuperUserConfigService.fingerprint`（hex 64，對應 `super_user_access.active_credential_fingerprint`）與 `verify(account, password): Promise<boolean>`。設定錯誤一律用一般 `Error`（屬啟動錯誤，不是 AppException）。
- 027-02／027-03 把 service 註冊進 module 後，缺設定就無法開機：要在 `server/test/setup-e2e.ts` 用合成值設定 `SUPER_USER_ACCOUNT`／`SUPER_USER_PASSWORD_HASH`（可用 `hashSuperUserPassword` 產生）；本機 `.env`、UAT 部署設定及 `server/.env.example`（T052，027-08）也要在合併到 dev 前補上。
- `verify` 不檢查輸入長度。027-04 的登入 DTO 必須先限制帳號 1～128 字元、密碼 1～1024 UTF-8 bytes（可引用 `SUPER_USER_PASSWORD_MAX_BYTES`）與 body 8 KiB，再呼叫 `verify`。設定端的帳號只檢查非空，不檢查 128 字元上限。
- hash 格式與 fingerprint 序列化都由測試的字面值固定；改動會讓 DB 已啟用的 fingerprint 失配，必須換 domain 版本並走明確啟用流程。
- 027-08 寫文件時要注意：`pnpm` 不加 `-s` 會在 stdout 先印一行 `$ node ...` banner，要只取 hash 請用 `pnpm -s -C server super-user:hash-password`。這支指令從原始碼以 ts-node（devDependency）執行，建置後也可用 `node dist/console/hash-super-user-password.js`。hash 可在維護者本機離線產生。

### 整合紀錄

已合入整合分支 `027-super-user-access`（2026-11-05，fast-forward）：
- `afe2b10 feat(auth): 驗證 Super user 專用帳密設定並提供離線 hash 工具`
- `6b6360f docs(tickets): 記錄 027-01 實作結果與驗證`
