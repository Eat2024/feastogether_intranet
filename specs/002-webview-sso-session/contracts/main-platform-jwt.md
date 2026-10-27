# 主平台 WebView JWT 與 Launch 介接契約

## 介接流程

1. 使用者已在主平台登入。
2. 主平台後端以私鑰簽發短效且一次性的 RS256 JWT。
3. 主平台後端以 HTTPS POST 將 JWT 交給電子簽 launch endpoint。
4. 電子簽以公鑰驗簽，完成 FGAPI 與 User 查驗後建立待啟動紀錄，回傳最長 60 秒的 `launchUrl`。
5. 主平台用 `launchUrl` 開啟 WebView。
6. 電子簽 GET endpoint 只回傳 no-store 的同源自動提交 bridge，不修改狀態。
7. Bridge 立即 POST code 至 `/api/auth/session`；電子簽原子消耗 code，建立 MySQL session、設定 HttpOnly cookie，並以 `303` 導向固定首頁 `/`。

`launchUrl` 回傳成功不代表 WebView 已登入；必須由實際 WebView 完成第 5、6 步。

## 金鑰與 token 語意

- JWT 是 JWS 簽章資料，不是加密資料。
- 主平台只保管 RSA 私鑰；電子簽只配置對應 RSA 公鑰。
- 電子簽用公鑰驗證 JWT，無須也不能「解密」JWT。
- Launch code 由電子簽自行產生及消耗，不向主平台交換 access token。
- Launch code 與本地 session token 都是獨立的密碼學安全亂數，不從 JWT 衍生。

## 1. 主平台後端建立 launch

```http
POST /api/auth/webview-launches HTTP/1.1
Host: esign.example.internal
Authorization: Bearer <compact-JWS>
Accept: application/json
```

- 必須是主平台後端 server-to-server HTTPS request。
- JWT 只允許在 `Authorization` header 的 Bearer scheme。
- 不接受 query、fragment、cookie、request body 或其他自訂 header 中的 JWT。
- 不依賴 browser Origin 或 WebView cookie context。

### JOSE header

```json
{
  "alg": "RS256",
  "typ": "FT-ESIGN-LAUNCH+JWT"
}
```

第一版只使用預先配置的單一公鑰，不使用 `kid`、`jku`、`x5u` 或 token 指定的金鑰來源。

### JWT payload

```json
{
  "iss": "feastogether-main-platform",
  "aud": "feastogether-esign",
  "sub": "00123",
  "name": "王小明",
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "iat": 1791763200,
  "nbf": 1791763200,
  "exp": 1791763320
}
```

| Claim  | 必要 | 規則                                                            |
| ------ | ---: | --------------------------------------------------------------- |
| `iss`  |   是 | 部署前固定約定，精確比對                                        |
| `aud`  |   是 | 固定單一字串 audience                                           |
| `sub`  |   是 | 員工編號 `empid`；1–32 字元 ASCII 英數字                        |
| `name` |   否 | 主平台 session 的姓名；最長 100；不是身分因素，不用於 User 寫入 |
| `jti`  |   是 | 每次啟動的新 UUID v4，不得重用                                  |
| `iat`  |   是 | JWT NumericDate（UTC epoch seconds）                            |
| `nbf`  |   是 | JWT NumericDate；通常與 `iat` 相同                              |
| `exp`  |   是 | JWT NumericDate；`exp - iat <= 120`                             |

時鐘誤差最多允許 ±30 秒，不因此放寬 120 秒簽發壽命。

### 成功回應

```http
HTTP/1.1 201 Created
Cache-Control: no-store
Content-Type: application/json
```

```json
{
  "success": true,
  "data": {
    "launchUrl": "https://esign.example.internal/api/auth/webview?code=<opaque-one-time-code>",
    "expiresAt": "2026-10-12T08:01:00.000Z"
  },
  "timestamp": "2026-10-12T08:00:00.010Z"
}
```

- `launchUrl` origin 與 path 由電子簽固定，主平台不得提供 redirect URL。
- 主平台不得記錄、重用、修改或長期保存 `launchUrl`。
- 主平台應在取得後立即用它開啟 WebView。

### 失敗回應

| HTTP | code                   | 語意                                                                  |
| ---: | ---------------------- | --------------------------------------------------------------------- |
|  400 | `INVALID_REQUEST`      | HTTP 格式無法處理                                                     |
|  401 | `AUTH_EXCHANGE_FAILED` | 缺憑證、驗章／claim／期限錯誤、重放、查無唯一合格員工或本地帳號不可用 |
|  502 | `STAFF_LOOKUP_FAILED`  | FGAPI 無法完成查驗；需新 JWT 重試                                     |
|  503 | `AUTH_DB_UNAVAILABLE`  | MySQL 無法安全建立 launch                                             |

失敗內容不揭露員編是否存在、FGAPI 原回應、簽章失敗細節或本地 User 狀態。

## 2. WebView 載入 launch bridge

主平台直接用電子簽回傳的完整 `launchUrl` 開啟 WebView，例如：

```http
GET /api/auth/webview?code=<opaque-one-time-code> HTTP/1.1
Host: esign.example.internal
```

成功回傳一個不載入第三方資源的最小 HTML 頁面；頁面以 hidden input 承載 code，自動提交以下同源 form，並提供 JavaScript 無法執行時的提交按鈕：

```html
<form method="post" action="/api/auth/session">
  <input type="hidden" name="code" value="<opaque-one-time-code>" />
  <button type="submit">繼續進入電子簽</button>
</form>
```

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'none'; script-src 'nonce-<random>'; form-action 'self'; base-uri 'none'; frame-ancestors <trusted-portal>
Content-Type: text/html; charset=utf-8
```

- GET 不查詢、消耗或修改 launch/session 狀態。
- Application 與 reverse proxy access log 都不得記錄 query string。
- Code 必須經格式驗證並安全寫入 HTML attribute，不允許插入 markup。

## 3. WebView 建立 session

Bridge 自動送出：

```http
POST /api/auth/session HTTP/1.1
Host: esign.example.internal
Content-Type: application/x-www-form-urlencoded

code=<opaque-one-time-code>
```

成功：

```http
HTTP/1.1 303 See Other
Cache-Control: no-store
Referrer-Policy: no-referrer
Set-Cookie: FT_ESIGN_SESSION=<opaque>; Max-Age=28800; Path=/; HttpOnly; Secure; SameSite=None
Location: /
```

- Code 最長 60 秒，只能由此 POST 成功消耗一次。
- Endpoint 不接受 JWT、員編、User ID 或任意 redirect URL。
- Cookie 是 host-only，不設 `Domain`。
- Production／staging 必須帶 `Secure` 與 `SameSite=None`：主平台為 http 時，iframe 內的電子簽依 schemeful same-site 屬跨站，`SameSite=Lax` 會被瀏覽器擋下。本機 HTTP 測試不帶 `Secure`，維持 `SameSite=Lax`。
- 因 cookie 會隨跨站請求送出，以 cookie 認證的異動端點由 `OriginGuard` 擋下 `Sec-Fetch-Site` 為 `cross-site`／`same-site` 或 Origin 不在允許清單的請求。
- 瀏覽器封鎖第三方 cookie 時（例如 Chrome 無痕視窗的預設值）iframe 內仍無法建立 session，主平台會顯示錯誤。
- 8 小時為固定壽命，不因活動滑動延長。
- Application 與 reverse proxy access log 都不得記錄 request body。

Code 無效、過期或已使用時，回傳不含細節的錯誤頁，不設定 cookie；不得導向任意外部 URL。GET bridge 本身不代表 code 有效或登入成功。

## 4. 後續 session 操作

```http
GET /api/auth/session
Cookie: FT_ESIGN_SESSION=<opaque>
```

取得目前 User 與 session 到期時間。

```http
DELETE /api/auth/session
Origin: <allowed electronic-signature origin>
Cookie: FT_ESIGN_SESSION=<opaque>
```

在 MySQL 撤銷當前本地 session 並清 cookie；重複登出仍為冪等成功。本版不通知主平台登出。

## 5. 儲存與故障邊界

- MySQL `auth_sessions` 是 launch replay、code 與 session 的唯一權威來源。
- DB 只存 `jti`、code 與 session token 的 SHA-256 摘要，不存原始值。
- Redis 不可用時，建立 launch、消耗 code、驗證 session 與登出都必須維持可用。
- MySQL 不可用時 fail closed，回傳服務暫時不可用，不建立 code、cookie 或未受控 session。
