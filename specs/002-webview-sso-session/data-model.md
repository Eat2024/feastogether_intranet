# Data Model: WebView SSO 與員工 Session

## Overview

Spec 2 沿用 `users`，新增一張 MySQL `auth_sessions` 表，統一承載 JWT replay claim、待啟動 WebView launch 與啟用後 session。Redis 不屬於此認證流程的權威或必要依賴。

## 1. WebView Launch Assertion（只在 POST 傳輸）

| 欄位       | 必要 | 驗證                                   | 用途                   |
| ---------- | ---: | -------------------------------------- | ---------------------- |
| JOSE `alg` |   是 | 精確為 `RS256`                         | 固定演算法             |
| JOSE `typ` |   是 | 精確為 `FT-ESIGN-LAUNCH+JWT`           | 限定 token 用途        |
| `iss`      |   是 | 固定 issuer                            | 簽發者                 |
| `aud`      |   是 | 固定 audience                          | 接收者                 |
| `sub`      |   是 | ASCII alphanumeric，1–32；值即 `empid` | FGAPI 與 User 唯一識別 |
| `name`     |   否 | string，1–100；驗證後丟棄              | 非權威介接資訊         |
| `jti`      |   是 | UUID v4                                | JWT 一次性識別         |
| `iat`      |   是 | NumericDate                            | 簽發時間               |
| `nbf`      |   是 | NumericDate                            | 生效時間               |
| `exp`      |   是 | NumericDate，`exp - iat <= 120`        | 交換到期時間           |

JWT 是 JWS 簽章資料，不做解密。原始 JWT、claims 與原始 `jti` 不寫 DB、log 或回應。

## 2. User（既有 MySQL `users`）

| 欄位              | Spec 2 寫入規則                                      |
| ----------------- | ---------------------------------------------------- |
| `id`              | DB 產生的本地 principal ID                           |
| `empid`           | 首次建立寫入 JWT／FGAPI 精確相符員編；unique 防重複  |
| `name`            | 只寫 FGAPI `person_name`                             |
| `person_status`   | 只寫 FGAPI `person_status_name`                      |
| `is_active`       | 新 User 為 `true`；既有 `false` 不自動開啟           |
| `department_id`   | 本版不由 staff lookup 改寫                           |
| `department_name` | FGAPI `department_name`（nullable）                  |
| `title_name`      | FGAPI `title`（nullable）                            |
| `last_login_at`   | 成功完成員工查驗與 User resolve 時的 server UTC time |
| `deleted_at`      | 非 null 即 fail closed，登入不 restore               |

FGAPI 陣列只能有恰好一筆正規化後與 `sub` 完全相同的合格員工。上游 `department_id` 是字串代碼，只驗證、不寫入本地 BIGINT FK。

User 並發規則：

1. transaction 內以 `empid` 查詢 `withDeleted + FOR UPDATE`。
2. active User：更新白名單欄位。
3. inactive／soft-deleted User：拒絕。
4. 不存在：建立 User。
5. 並發 insert 觸發 `uq_users_empid`：resolve 最多重試一次。

## 3. AuthSession（新增 MySQL `auth_sessions`）

| 欄位                   | 型別／約束                               | 說明                                                   |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `id`                   | BIGINT unsigned PK                       | 本地稽核識別                                           |
| `user_id`              | BIGINT nullable FK → `users.id`          | 沿用既有 `users.id` signed 型別；FGAPI／User resolve 完成後綁定 |
| `source`               | VARCHAR(20), non-null                    | Session 身分來源；本流程明確寫入 `webview`             |
| `status`               | VARCHAR(20)                              | `validating`、`pending`、`active`、`failed`、`revoked` |
| `source_jti_hash`      | CHAR(64), unique                         | SHA-256(`issuer + NUL + jti`)                          |
| `launch_code_hash`     | CHAR(64), unique nullable                | SHA-256(raw launch code)                               |
| `session_token_hash`   | CHAR(64), unique nullable                | SHA-256(raw cookie token)                              |
| `assertion_expires_at` | DATETIME(3)                              | 上游 JWT 最後有效時間                                  |
| `launch_expires_at`    | DATETIME(3) nullable                     | pending code 到期，建立後最長 60 秒                    |
| `verified_at`          | DATETIME(3) nullable                     | JWT、FGAPI 與 User 完成時間                            |
| `activated_at`         | DATETIME(3) nullable                     | WebView 成功消耗 code 時間                             |
| `expires_at`           | DATETIME(3) nullable                     | active session 到期，`activated_at + 8 hours`          |
| `revoked_at`           | DATETIME(3) nullable                     | 登出撤銷時間                                           |
| `failure_code`         | VARCHAR(50) nullable                     | 不含個資的內部分類                                     |
| `created_at`           | DATETIME(3)                              | 建立時間                                               |
| `updated_at`           | DATETIME(3)                              | 最後狀態變更時間                                       |
| `deleted_at`           | DATETIME(3) nullable                     | 基底欄位；認證流程不得 soft-delete session 紀錄        |

必要索引：

- unique `source_jti_hash`
- unique `launch_code_hash`
- unique `session_token_hash`
- index `(status, launch_expires_at)`
- index `(status, expires_at)`
- index `(user_id, created_at)`
- index `deleted_at`

原始 launch code 及 session token 只存在回應／cookie 與單次 request memory；DB 不保存原始值。雜湊欄位不得寫入一般 log。

## 4. 狀態轉換

```text
JWT verified
    |
    v
validating -- FGAPI/User failure --> failed
    |
    | FGAPI + User success; issue code
    v
pending -- code expires ---------> logically expired (status remains pending)
    |
    | bridge POST atomic consume code
    v
active -- session expires -------> logically expired (status remains active)
   |
   +-- logout -------------------> revoked
```

- 建立 `validating` row 時以 `source_jti_hash` unique claim JWT；衝突即重放。
- WebView GET 只回傳 bridge，不查詢或修改 AuthSession。
- pending → active 只能由 bridge POST 執行，且必須以單一 transaction／條件更新檢查 `status=pending` 且 `launch_expires_at > now`。
- 同一 transaction 產生 `session_token_hash`、設定啟用及到期時間；commit 後才回 Set-Cookie。
- 到期由查詢條件判定，第一版不需排程改狀態。
- 登出只允許 active 且未到期 row 設定 revoked；重複登出對 HTTP client 保持冪等。

## 5. 憑證產生

```text
launch code:   32 CSPRNG bytes -> base64url without padding
session token: 32 CSPRNG bytes -> base64url without padding
stored hash:   lowercase hex SHA-256(raw value)
```

Launch URL：

```text
https://<fixed-esign-origin>/api/auth/webview?code=<raw-launch-code>
```

- 不接受 client 提供的 redirect URL。
- WebView GET endpoint 回傳自動提交至 `/api/auth/session` 的同源 bridge；不得寫入。
- Session POST 成功後固定 `303 Location: /`。
- code 最長 60 秒且只能成功消耗一次。
- session 最長 8 小時且不滑動。

## 6. 跨步驟一致性

- JWT 驗證失敗：不建立 AuthSession、不查 FGAPI／User。
- `source_jti_hash` unique conflict：拒絕重放，不查 FGAPI／User。
- FGAPI／User 失敗：AuthSession 標成 failed，不建立 code 或 session。
- pending launch 回應丟失：JWT 已消耗；主平台需新 JWT。
- GET bridge 不消耗 code；重整 GET 只會再次取得相同 bridge。
- POST 時 code 過期或重放：不建立 session token 或 cookie。
- code 已啟用但 cookie／redirect 回應丟失：code 不恢復；主平台需新 JWT。
- MySQL 不可用：fail closed；不發 code 或 cookie。
- Redis 不可用：不影響 Spec 2 launch、session 驗證或登出。

## 7. 保留與稽核

第一版保留過期、撤銷及失敗 row，不加自動清理排程。正式上線前需另定資料保留政策；未來清理只能刪除已超過政策期限且非 active／pending 的紀錄，不得影響 session 正確性。
