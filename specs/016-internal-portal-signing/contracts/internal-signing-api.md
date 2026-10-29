# 內部簽署 API 與前端契約

以下為目標行為，取代現行本人操作回 403 OTP。沿用全域員工 session guard，寫入保留 OriginGuard；不得以外部 OTP cookie 代替員工登入。

基底 `/api/esign/signing-tasks`，JSON 沿既有 `{success,data}` envelope，資料型別以現有 DTO 為基礎。

| 方法／相對路徑 | 成功 | 行為 |
| --- | --- | --- |
| GET 空路徑，`status?=pending|signed|rejected` | 200 task[] | 本人非草稿任務；不分頁、無寫入 |
| POST `/:signerPublicId` | 201 task | 本人開啟任務，記既有開啟事件；不可作輪詢 |
| GET `/:signerPublicId/source-file` | 200 PDF inline | 本人合法閱讀，保留原檔完整性與 frame policy |
| POST `/:signerPublicId/signatures` | 首次 201、同 requestId 200 | 交易提交及回傳本人結果 |
| POST `/:signerPublicId/rejection` | 首次 201、同 requestId 200 | 依 allowReject 拒簽 |
| GET `/:signerPublicId/completed-file` | 200 PDF attachment | 已簽且 ready 的本人副本；未 ready 409 |

未登入／session 過期 401；非本人、外部指派、查無或刪除資源一律 404，不洩露存在性。輸入格式錯誤 400；不符合狀態、期限、聲明或完整性沿既有穩定錯誤碼與 app-errors 對應狀態，契約不任意重新編碼。簽署人身分先於業務狀態檢查。GET 原檔／副本保留 `private, no-store`、`nosniff` 及 PDF Content-Type，不回登入 HTML。

## 請求與回應

簽署 body 沿 `SignatureSubmissionDto`：

```json
{
  "requestId": "UUID-v4",
  "consentVersion": "目前聲明版本",
  "accepted": true,
  "signatures": [{"fieldId": "正整數字串", "pngDataUrl": "data:image/png;base64,..."}]
}
```

signatures 1–200 筆，各 PNG data URL 最長 400,000 字元且仍須 server 解碼驗證；field 必須符合文件必填簽名位置。身分取路徑與 session，不新增 body userId、Email 或 signerPublicId。拒簽為 `{requestId,reason?}`，reason trim 後最多 200 code points，null 不等於未提供。

簽署結果沿用 `signerPublicId/signedAt/documentStatus/verificationUrl/completion{status,readyAt}`；拒簽沿既有 service result。task 沿 `EsignSigningTask`，只含 document、本人 signer、共用 fields、consent、計數及 allowReject；不加入其他人的簽名或原始憑證。

## 授權與重送

內部 principal 由 server 建立 `{kind:'internal',userId}`，不要求 Email／邀請世代。任務與原檔排除草稿、刪除；待簽閱讀遵守簽署期間，已簽可查看結果與本人副本，已拒僅結果。停止／到期等不允許新簽署或拒簽。

簽署交易前與鎖內皆檢查本人、pending、有效期間、聲明、來源 PDF／payload hash、欄位與 PNG；重送先驗證本人再回既有成功結果，不因已完成或到期拒絕合法同 requestId 結果讀取。requestId 與 signer 唯一索引共同保護併發，其他人不能重送取得結果。內外部重送分支不能共用 external invitation 檢查。

## 前端接法

在 `api/endpoints → types → requests → queries` 補本人 open/sign/reject 與資源 URL，維持同源 cookie。進詳情 POST open 一次，使用 TermsStep、DocumentViewer、SignaturePadDialog、RejectDialog、useSignaturePad；將 ExternalSignForm 中必要的共用呈現／轉換抽到就近共用檔，由內外容器提供提交 callback，避免呼叫錯誤 API。

成功 invalidate 本人列表 query。副本處理中只輪詢既有 GET 列表，ready 顯示下載、failed 提供既有狀態提示，不重複 POST open。切換 signer 重置表單，重試沿用 requestId。內部 401 顯示 Portal 重登，不用外部邀請失效文案；保留鍵盤、焦點、pending 防連點與窄螢幕操作。

建立人選人／發起畫面的 `ready|unavailable` 表示能否 Email 通知，不等於員工能否簽署；無 Email 提示「由人資另行通知」，不阻擋發起。上游故障與身分無效仍阻擋，外部 Email 驗證不變。
