# 外部 Email 簽署邀請契約

## 1. 用途與信任邊界

外部簽署人從指定 Email 信箱開啟專屬 URL，視為能控制該信箱，不再輸入 OTP。此邀請只授予一名 `email` signer 對一份 document 的讀取與簽署能力，不建立 User，不授予內部列表、其他文件或管理功能。

## 2. Token 格式與保存

- 每名 external signer 在 document initiation transaction 生成獨立 token。
- Token 是 32 random bytes 的 base64url，無 padding，固定 43 字元；不包含 signer、Email、document ID 或可解碼 claims。
- 授權查詢只使用 `SHA-256(token)`，不將原值明文寫入 DB。
- 為了 transaction 後寄信與 provider 重試，待寄送期間可在 signer 保存 AES-256-GCM 密文；金鑰只由 `ESIGN_INVITATION_ENCRYPTION_KEY_B64` 注入。寄送成功後必須清除密文。
- Token 原值、digest、密文與完整 invitation URL 都不進 application/access/error/audit/analytics log。

## 3. Email 內容

Invitation-only mail 包含：

- 電子簽服務固定品牌與用途。
- 文件名稱、建立人姓名、簽署截止時間（台北時間）。
- 完整 HTTPS invitation URL：`<EXTERNAL_SIGNING_ORIGIN>/api/external-signature-invitations/<token>`。
- 提醒收件者不轉寄 URL，並說明簽署完成、文件停止或到期後連結失效。

不附上 PDF，不列出其他簽署人，不包含簽名、session 或內部系統網址。Spec 03 不寄催簽、完成通知或其他通知。

## 4. 瀏覽器流程

```text
Email client
  GET /api/external-signature-invitations/<token>
    → 200 no-store/no-referrer HTML bridge（不驗證或寫入 DB）
  bridge form POST /api/external-signature-session { token }
    → Server 以 digest 驗證 signer/document/expiry/status
    → Set-Cookie: FT_ESIGN_EXTERNAL_ACCESS=<token>; HttpOnly; Secure; SameSite=Lax
    → 303 /external-signatures/<signer-public-id>
  GET clean client route
    → Client 透過同源 /api/external-signing-task 操作，JavaScript 不取得 token
  POST signature success
    → invitation 立即失效，清除 access cookie
    → 另設文件限定的 FT_ESIGN_EXTERNAL_RECEIPT HttpOnly cookie
    → 僅可查終止狀態與取得 completed PDF
```

Bridge response 必須包含：

```http
Cache-Control: no-store
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'none'; script-src 'nonce-<random>'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
```

- Bridge 為 `no-referrer`，瀏覽器送出表單時依 Fetch 規範帶 `Origin: null`；OriginGuard 僅在同時帶有瀏覽器產生的 `Sec-Fetch-Site: same-origin` 時接受 `Origin: null`，沙箱與跨站來源仍拒絕。
- GET 只做 token 字元與長度格式驗證及 HTML escaping，不搜尋 DB、不記開啟紀錄。
- POST 驗證成功才 append `external_invitation.opened`；失敗對外使用相同錯誤，不揭露 Email/document/signer 是否存在。
- Reverse proxy 與 application access log 必須將 invitation path 正規化成 `/api/external-signature-invitations/:token`，不記實際 segment。

## 5. 每次授權的條件

`FT_ESIGN_EXTERNAL_ACCESS` 不是內部 session，也不建立另一張 session table。每個 external API request 都必須全數通過：

1. Cookie 格式正確且 digest 精確命中一名 `email` signer。
2. `now <= invitation_expires_at` 且 `now <= document.sign_end_at`。
3. Signer 仍為 `pending`。
4. Document 仍為 `active`；`finalizing/completed/stopped` 皆無效。
5. Resource 必須屬於該 signer 同一 document，回應只含本人欄位與必要文件資料。

任一條件失敗，回通用 401，並清除 external cookie。不回傳過期、已簽、已停止或 token 不存在的可區分細節。

## 6. 可重開與失效

- 開啟 invitation URL 不消耗 token，關閉後可再次開啟。
- 外部 cookie 最長存活到 invitation expiry，但 DB 條件才是最終權威。
- 簽署成功的 response 同時清除 access cookie；即使 cookie 沒有清除，signer status 也會使 invitation token 失效。
- 同一 response 另生成 random receipt token，DB 只存 digest，瀏覽器只存 HttpOnly `FT_ESIGN_EXTERNAL_RECEIPT`。Cookie `Path` 固定為 `/api/external-completions/<signer-public-id>`，同一瀏覽器可同時保留多份文件的同名cookie。Receipt 在文件 finalizing/active 期間不過期，文件 completed/stopped 後 30 日失效；只可查看終止/處理狀態與 completed PDF，不得重開原 PDF 或任何簽署寫入。
- 清除瀏覽器資料後不提供 receipt 復原；本規格不新增完成通知信或長期外部封存帳號。
- Creator stop、deadline stop 與 document completion 立即使所有該 document external tokens 失效，不需逐筆刪 digest。

## 7. Email 投遞與重試

- Worker 使用 notification log 的 `pending/failed -> processing` 條件轉換 claim 作業。
- local 透過 SMTP adapter 寄到 Mailpit；automated test 注入 in-memory fake；UAT/production 透過 SES adapter 寄送，但共用相同 mail sender contract、內容與 outbox 狀態機。
- 可重試失敗寫穩定 `error_code`、`attempt_count`、`next_attempt_at`，不寫 SMTP/SES response、body、recipient 或 token。
- 不可重試或超過最大次數後保留 failed，creator detail 只顯示「邀請寄送失敗」，不顯示 provider 細節。
- 成功 provider accept 後寫 delivered 並清除 ciphertext。若在 provider accept 後、DB update 前 crash，允許 worker 重寄同一連結；不會建立第二個 signer 或擴大權限。

## 8. 部署設定

```dotenv
EXTERNAL_SIGNING_ORIGIN=https://esign.example.internal
ESIGN_INVITATION_ENCRYPTION_KEY_B64=<base64-32-random-bytes>
ESIGN_MAIL_DRIVER=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=<optional-local-value>
SMTP_PASSWORD=<optional-local-value>
SMTP_FROM=no-reply@example.test

# UAT / production 使用 ESIGN_MAIL_DRIVER=ses
AWS_REGION=ap-northeast-1
SES_FROM=no-reply@example.internal
```

- `EXTERNAL_SIGNING_ORIGIN` 必須是固定 HTTPS origin（本機測試可 HTTP localhost），不由 request Host 或 forwarded header 自動推斷。
- local 使用 Mailpit SMTP，test 使用 in-memory fake；UAT 使用 SES sandbox，sender 與測試收件人都必須完成該 region 的身分驗證；production 使用已驗證 sender/domain，並須先在目標 region 移出 SES sandbox 才能寄送一般簽署人。
- UAT/production 的 AWS 認證使用 runtime IAM role/default credential chain，不在 `.env` 設定 access key。
- 環境與 driver 組合不符或缺少必要設定時，worker 啟動 fail fast；不得 fallback 到 log-only、SMTP 或其他 mailer。
- `.env.example` 只放名稱與 placeholder，不放正式收件者、密碼或金鑰。

## 9. Origin 與 frame 防護

- Bridge POST、簽署 POST 與清除 cookie DELETE 必須有精確命中 `EXTERNAL_SIGNING_ORIGIN` 的 `Origin`；缺少或不符一律 403，不進入 token/DB 查詢。
- External 簽署頁與 receipt 頁必須設 `Content-Security-Policy: frame-ancestors 'none'` 或等效 `X-Frame-Options: DENY`。
- SameSite cookie 、CORS 與 CSP 都不取代 Server-side Origin 驗證。
