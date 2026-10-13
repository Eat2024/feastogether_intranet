# Quickstart: WebView SSO 與員工 Session 驗收

## 1. 前置條件

- Node.js >= 20.19.0 與 pnpm 11
- MySQL 8.4 測試 DB（名稱以 `feastogether_intranet_test` 開頭）
- 可控 FGAPI stub／UAT endpoint，支援 `/api/v1/hr/staff_lookup?person_empid=...`
- 僅用於開發／驗收的 RSA key pair；不使用或提交正式私鑰

```bash
pnpm install
pnpm -C server db:test:create
```

## 2. 建立臨時測試金鑰

```bash
TEST_KEY_DIR="$(mktemp -d)"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$TEST_KEY_DIR/private.pem"
openssl pkey -in "$TEST_KEY_DIR/private.pem" -pubout -out "$TEST_KEY_DIR/public.pem"
base64 < "$TEST_KEY_DIR/public.pem" | tr -d '\n'
```

將最後輸出放入本機 `.env.test` 的 `WEBVIEW_SSO_PUBLIC_KEY_B64`；私鑰只供測試簽發器讀取，不放 repository。依 [main-platform-jwt.md](./contracts/main-platform-jwt.md) 設定：

```dotenv
WEBVIEW_SSO_ISSUER=feastogether-main-platform-test
WEBVIEW_SSO_AUDIENCE=feastogether-esign-test
WEBVIEW_SSO_PUBLIC_KEY_B64=<base64-public-pem>
WEBVIEW_LAUNCH_ORIGIN=http://localhost:3001
AUTH_TRUSTED_ORIGINS=http://localhost:3000
```

FGAPI／MySQL 仍使用現有 `.env.test` 命名；不在文件放 API key 或 DB 密碼。Spec 2 認證不使用 Redis，但測試應額外確認 Redis 不可用時流程不受影響。

## 3. Migration 與自動化驗證

```bash
pnpm -C server migration:run
pnpm -C server lint:check
pnpm -C server test
pnpm -C server build
pnpm -C server test:e2e
pnpm -C server test:e2e:security
```

必須驗證：

- 正常 JWT + FGAPI 唯一精確員工可建立／白名單更新 User，回 `201` 與最長 60 秒的 `launchUrl`，但此時尚未設定 session cookie。
- WebView GET `launchUrl` 只回 `200` no-store 同源 bridge，不讀寫 launch/session；bridge POST 後才回 `303`、8h HttpOnly cookie 與固定 `Location: /`。
- 相同 code 的序列與並發 POST 消耗最多一個成功，且過期 code 失敗；重複 GET bridge 不得消耗 code。
- `GET /api/auth/session` 還原正確 User，body／query／header 假員編不能覆寫。
- `DELETE /api/auth/session` 後同 cookie 無法再用；重複登出冪等。
- 錯誤簽章、`alg`、`typ`、`iss`、`aud`、`sub`、`jti`、`iat`、`nbf`、`exp` 均被拒絕，不呼 FGAPI、不寫 User 或可用 session。
- 同 `jti` 序列與並發重放最多建立一筆 `auth_sessions` claim，且最多回傳一個 launch。
- FGAPI 只有模糊結果、無結果、多筆精確、欄位無效與 timeout 均 fail closed。
- 同員編並發首登只有一筆 User。
- soft-deleted／本地 inactive User 不自動 restore／啟用。
- Redis 停止或連線設定無效時，launch 建立、code 消耗、session 驗證與登出仍成功。
- MySQL 不可用時 fail closed，不發 launch code 或 session cookie。
- log 不含 JWT、Authorization、cookie、API key、code/query、`sub`、`jti`、姓名、FGAPI 完整 response 或 `person_empid` query。

## 4. 介接 smoke test

由主平台測試簽發器依契約產生 JWT 後，先模擬主平台後端：

```bash
curl --include \
  --request POST \
  --header "Authorization: Bearer $LAUNCH_JWT" \
  http://localhost:3001/api/auth/webview-launches
```

預期：`201`、`Cache-Control: no-store`，body 包含電子簽固定 origin 的 `launchUrl` 與最長 60 秒的 `expiresAt`；沒有 `Set-Cookie`。

從回應取出完整 launch URL，模擬 WebView 開啟：

```bash
curl --include \
  "$LAUNCH_URL"
```

預期：`200`、`Cache-Control: no-store`、`Referrer-Policy: no-referrer` 與嚴格 CSP；HTML 包含同源 `/api/auth/session` form 及自動提交 script，但沒有 `Set-Cookie`，DB 狀態也不變。

`curl` 不執行 HTML script，因此再以從 `launchUrl` 取得的 code 模擬 bridge POST：

```bash
curl --include \
  --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "code=$LAUNCH_CODE" \
  --cookie-jar /tmp/ft-esign-cookie.txt \
  http://localhost:3001/api/auth/session
```

預期：`303`、`Location: /`、`Cache-Control: no-store`、`Referrer-Policy: no-referrer`，以及 `Set-Cookie: FT_ESIGN_SESSION=...; Max-Age=28800; HttpOnly; SameSite=Lax`。

```bash
curl --include \
  --cookie /tmp/ft-esign-cookie.txt \
  http://localhost:3001/api/auth/session

curl --include \
  --request DELETE \
  --header 'Origin: http://localhost:3000' \
  --cookie /tmp/ft-esign-cookie.txt \
  http://localhost:3001/api/auth/session
```

登出後重試 session GET 預期 `401`。

## 5. 主平台聯合驗收

1. 主平台用已登入 session 的 `person_empid` 作 JWT `sub`，可選填 `person_name` 作 `name`。
2. 每次開 WebView 建立新 UUID v4 `jti`，`exp - iat <= 120`。
3. 私鑰只在主平台後端簽發；JWT 只經 server-to-server POST，不交給 WebView 或放入 URL。
4. 主平台後端取得 `launchUrl` 後立即交給 WebView 作 GET 導航，不把取得 launch 誤判為登入成功。
5. 主平台不需要呼叫第二個 POST；WebView 載入 bridge 後由電子簽頁面同源自動 POST，收到 cookie 與 `303` 後進入固定首頁，不執行 access-token exchange。
6. 確認 JWT、完整 launch URL 與 code 不出現於主平台／電子簽 access log；電子簽 WebView GET access log 不含 query，session POST access log 不含 body。
7. 同 JWT 與同 code 重放皆失敗；重新由主平台開啟時必須用新 JWT 取得新 launch URL。

## 6. 不屬於本次驗收

- OAuth authorization code／access token endpoint
- JWT payload 加密或雙向金鑰
- Redis session 或 Redis／MySQL fallback
- Session 自動清理／封存排程與最終資料保留年限
- 離職／停職通知、排程重驗、既有 session 立即撤銷
- 主平台 back-channel logout
- MFA、OTP、WebAuthn 或文件綁定重新驗證
- 多 issuer、JWKS discovery、自動金鑰輪替
- Email 外部簽署人 session
- 文件與簽署業務 API
