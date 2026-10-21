# Contract：Email 簽署與通知

狀態：以下路徑已存在，**支援內部員工的擴充尚未實作**。外部名稱沿用，代表 Email 受限通道，不把 user signer 改成 email signer。JSON envelope 同 [員工契約](employee-email-api.md)；HTML 表單及 PDF 不包 JSON。

## 邀請及 OTP（無須員工登入）

| 方法與路徑 | 輸入 | 成功 | 預期失敗 |
| --- | --- | --- | --- |
| GET `/api/external-signature-invitations/:token` | 43 字元 base64url 邀請 token | 200 HTML 確認頁；不查 DB、不寄碼、不建存取 | 格式錯 400 HTML |
| POST `/api/external-signature-otps` | form token | 200 HTML OTP 輸入頁、遮罩信箱 | 400 格式錯、401 無效、409 尚未開始、429 冷卻／限額、503 寄送失敗 |
| POST `/api/external-signature-session` | form token、code（6 位數字） | HttpOnly cookie＋303 `/external-signatures/:signerPublicId` | 400 格式錯、401 錯碼／失效、409 尚未開始 |
| DELETE `/api/external-signature-session` | 既有 cookie（若請求有攜帶） | 204 清除 cookie；有 credential 時撤銷 | 不作本次前端完整登出的依賴，見 plan 已知限制 |

POST 套 OriginGuard／既有 IP 限流。HTML 表單回應，不讓前端把它們當成 Axios JSON API。token 只留邀請橋接與表單，不轉寄給前端 analytics，不放一般錯誤訊息。成功頁跳轉不含 token。

`FT_ESIGN_EXTERNAL_ACCESS` 沿用 Path=`/api/external-signing-task`、HttpOnly、SameSite=Lax、現有環境 Secure 規則；session cookie 不設持久期限，Redis credential 8 小時失效，與邀請 token 不同。一次有效瀏覽器階段可持續操作，過期重新從邀請驗證；不能用 employee cookie 替代。

OTP 6 位／10 分鐘／一次性／錯滿 5 次失效；同指派 60 秒冷卻、每小時最多 5 封，新碼取代舊碼。按 signerId 計數，同 email 不共用。邀請失效或尚未開始不寄碼，SMTP 失敗不建立存取。

## 本人任務與簽署

以下端點須攜帶 Email credential cookie；內外部指派皆套相同伺服器驗證，寫入另有 OriginGuard。

| 方法與路徑 | 成功與語意 |
| --- | --- |
| POST `/api/external-signing-task` | 200 task，記錄 opened |
| GET `/api/external-signing-task` | 200 同形狀 task，唯讀、no-store，供副本狀態輪詢 |
| GET `/api/external-signing-task/source-file` | 200 application/pdf inline；已拒者不可取原檔 |
| POST `/api/external-signing-task/signatures` | 首次 201，重送同 requestId 200 既有結果 |
| POST `/api/external-signing-task/rejection` | 首次 201，同 requestId 重送 200；需 allowReject=true |
| GET `/api/external-signing-task/completed-file` | 已簽且副本 ready → 200 PDF attachment，完整性驗證與建立人下載相同 |

Task data 仍為 `{signerPublicId,allowReject,document,signer,fields,consent,pendingCount,signedCount}`，沿用既有 DTO shape。`signer.type` 保持 user／email；本人 employeeNo／department／title 在此受限通道回 null，不回 userId、管理 note、建立人資料或其他人名單。簽署後依 signer.status 與 signer.completion 判斷畫面，不能依 type 決定認證方式。

```ts
type SignatureRequest = {
  signerPublicId: string; // 頁面所屬 UUID v4
  requestId: string; // UUID v4，同一次提交的網路重試沿用
  consentVersion: string; // 1–50 字元
  accepted: true;
  signatures: { fieldId: string; pngDataUrl: string }[]; // 1–200
};
type RejectionRequest = {
  signerPublicId: string;
  requestId: string;
  reason?: string; // trim 後最多 200 Unicode code points；null 非省略
};
```

fieldId 為正整數字串，pngDataUrl 沿用 image/png 前綴、400,000 字元上限與後端內容檢查；日期由 Server 寫入。簽署結果 data `{signerPublicId,signedAt,documentStatus,completion,verificationUrl}`；副本狀態沿用 pending／processing／ready／failed。拒簽回既有本人結果，不產製 PDF。

一般失效 401 `ESIGN_EXTERNAL_UNAUTHORIZED`；頁面 signerPublicId 與 cookie 不同 409 `ESIGN_EXTERNAL_SIGNER_MISMATCH`；副本未就緒 409 `ESIGN_PERSONAL_COPY_NOT_READY`；尚未開始依現有 409 與 details.startAt。前端錯位時不可用 cookie 的另一個身分靜默替換原頁並提交。

已簽者不受簽署期限、停止、完成影響，可重新 OTP 下載；刪除後不可。已拒者可讀結果，不能讀 source／completed-file 或再次簽署。補簽只使待簽者舊邀請世代失效，不影響已簽者原邀請。

## 舊內部個人入口（變更）

以下只持有員工 session 的入口，驗證本人指派後回 **403 `ESIGN_EMAIL_OTP_REQUIRED`**，訊息「請從邀請信開啟文件並完成驗證碼驗證」。即使同時存在 Email cookie，也不在這些舊路徑建立第二條操作流程。

- POST `/api/esign/signing-tasks/:signerPublicId`
- GET `/api/esign/signing-tasks/:signerPublicId/source-file`
- POST `/api/esign/signing-tasks/:signerPublicId/signatures`
- POST `/api/esign/signing-tasks/:signerPublicId/rejection`
- GET `/api/esign/signing-tasks/:signerPublicId/completed-file`

未登入仍 401，非本人仍既有 404，不以 OTP_REQUIRED 暴露別人的指派。`GET /api/esign/signing-tasks` metadata 列表不改；建立人原始檔／個別副本與既有管理匯出權限不受影響。Service 層亦拒絕 internal principal 執行簽署／拒簽及重送，不保留舊文件例外。

## 人工催簽（既有契約擴充對象）

`POST /api/esign/documents/:documentId/notification-batches`，建立人 session＋OriginGuard，202。

```json
{"requestId":"UUID-v4","selection":"selected","signerPublicIds":["UUID-v4"]}
```

selection=selected 時名單非空最多 6,000；selection=all_pending 不提供 signerPublicIds。改納入內部 pending；同 email 不去重。非本文件人員仍 404，同 requestId 不同 payload 409，原請求重送回同批結果，不重複入列。

回應沿用 `{batchId,kind,requestedBy,status,selectedCount,queuedCount,notSentCount,createdAt,items,nextCursor}`；items 含 `{signerPublicId,name,status,reasonCode,attemptCount,completedAt,attemptHistory}`。202 表示受理，不代表送達。逐筆 status 沿用 pending／processing／delivered／failed／skipped／unknown。

`GET .../notification-batches?kind=invitation|reminder&cursor=...&limit=20` 與 `GET .../notification-batches/:batchId?cursor=...&limit=20` 沿用，limit 1–100，只有建立人可查。初次、補簽均可由 invitation kind 查結果。

移除 `INTERNAL_REMINDER_UNSUPPORTED`；沿用 `SIGNER_ALREADY_COMPLETED`、`SIGNING_WINDOW_CLOSED`、`REMINDER_IN_PROGRESS`、`REMINDER_DAILY_LIMIT`、`RECIPIENT_UNAVAILABLE`。全部不可寄時沿用既有無合格對象錯誤及 details.items。台北日曆日一次、00:00 重置，pending／processing／待重試與當日 delivered／unknown 仍阻止重複通知；與 OTP 額度獨立。

## 補簽（新增自動寄送行為）

`POST /api/esign/documents/:id/reopenings`，建立人 session＋OriginGuard，201。

```ts
{ expectedSignEndAt: string; signEndAt: string; reason: string }
```

時間帶時區，reason trim 1–500；沿用過期、舊期限比較及新期限規則。回應 `{documentId,status:'active',originalSignEndAt,signEndAt,isReopened:true,reopenedAt,pendingCount}` 不變。

變更：全部 pending 須已有固定 email／邀請，否則 409 **ESIGN_REOPEN_RECIPIENT_UNAVAILABLE**，details `{signerPublicIds:[...]}`，整次不變更。成功為所有 pending 建立新邀請通知，提交後背景寄送；不重查 HR，不改 signed／rejected。SMTP 失敗查通知紀錄，不重做 reopening；舊期限不符仍 `ESIGN_REOPEN_STALE`。

補簽時已在途的舊信可能稍後送達，但舊 token 已失效，前端按通用失效頁處理；系統不承諾撤回在途郵件。舊 worker 結果不得覆寫新邀請的寄送狀態。

`GET /api/esign/documents/:id/reopening-invitations` 保留原 item `{signerPublicId,invitationUrl,expiresAt}`，擴充內部 pending，**僅回傳仍具有效可解密密文者**。已送達清密文正常省略，全數送完回 []；存在但損壞密文仍 503。此列表不是待簽總表，也不表示未列入者未寄信；前端應改查通知狀態。

## Cookie、資料與紀錄

- 驗證、source／completed-file 皆 no-store；HTML 邀請採 no-referrer 與既有 CSP。
- 上游、server access／application logs、audit metadata 不含 email／員編清單、token、OTP、signature PNG。本人或建立人需用的地址只存在其授權回應。
- 新的內部 Email 簽署仍使用 email_invitation 證據方法；舊 employee_session 證據不修改。沿用 external_* audit event 名稱，前端不得據此把業務 signer.type 改成外部。
