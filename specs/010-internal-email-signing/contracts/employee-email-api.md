# Contract：員工解析、信箱檢查與發起

狀態：Ticket 01 已實作候選搜尋唯讀與員工解析；信箱檢查及發起擴充仍待後續 tickets。路徑包含 `/api` prefix。管理 API 使用既有員工 session；寫入及 POST 檢查套 OriginGuard。JSON 成功 envelope `{success:true,data,timestamp}`；錯誤 `{success:false,error:{code,message,details?},timestamp}`。ID 均以字串傳遞。

## 組織樹（已存在，沿用）

`GET /api/esign/signer-candidates/org-chart` → 200 `data: OrgDepartment[]`。沿用 Spec 006；員工欄位為 person_empid／person_name／title，不含 userId 或 email。Redis 7,200 秒、讀不續期，來源失敗 502、Redis 失敗 503，無登入 401。不得讓前端指定 refresh 或直連 fgapi。

## 候選搜尋與解析

`GET /api/esign/signer-candidates?q=...` → 200 `data: [{id,employeeNo,name,department,title}]`。**變更**：只查本機有效帳號，不再隱性匯入；查無回 []。

**新增** `POST /api/esign/signer-candidates/resolutions` → 200。

```json
{"employeeNos":["00115001","11501001"]}
```

- 1–100 個、每個 1–20 碼 ASCII 英數字串；不轉數值。按員編去重並保留首次出現順序。格式錯誤 400。
- 批讀本機；有效帳號直接 resolved，停用／刪除回 unavailable。不存在者經既有 HR lookup 精確比對與資格驗證後建帳，不從 client 姓名／組織樹直接建帳。
- staff_lookup 只接受 5–8 碼英數片段；本機缺少且長度不符者回 unavailable，不發無效上游請求。這不同於 staff_emails 的 20 碼上限。
- 缺少／不符資格逐人 unavailable；上游不可用整次 502 `ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE`。並發匯入同員編只保留一個帳號，重試可復用先前成功建立者；不宣稱帳號解析整批原子性。

```json
{
  "items": [
    {"employeeNo":"00115001","userId":"42","name":"測試員甲","department":"測試部門","title":null,"status":"resolved"},
    {"employeeNo":"11501001","userId":null,"name":null,"department":null,"title":null,"status":"unavailable"}
  ]
}
```

以上是 data 內容。此 API 不回 email、不建立文件指派。前端大量選取可自動分批解析；不要求人手拆名單。單一員編解析也走同一端點。

## 所選員工信箱檢查

**新增** `POST /api/esign/documents/:documentId/employee-email-checks` → 200。

```json
{"userIds":["42","43"]}
```

- 1–6,000 個正整數字串，必須可安全解析為本機 ID；去重後按輸入順序輸出。
- 僅該草稿建立人可呼叫；非建立人／不存在文件 404，非草稿 409。userId 不是有效帳號回 422 `ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE`，details.userIds 列出原請求中不可用 ID，不洩漏額外帳號資料。
- 來源以完整員編分批查詢，最多 100／批，後端負責拆批。不得提供 employeeNo、email、上游 URL 作為可覆寫來源。
- 查無、空白／不合法 email 為 unavailable；不推測是否離職。不同員工相同信箱皆 ready，逐人回傳、不警告。

```json
{
  "items": [
    {"userId":"42","status":"ready","maskedEmail":"s***@example.com"},
    {"userId":"43","status":"unavailable","maskedEmail":null}
  ]
}
```

回應 `Cache-Control: private, no-store`；不保存結果、不修改 signer/user、不寄信。上游失敗或 malformed 整次 502 `ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE`，不回部分結果或假空清單。身份／權限檢查在上游請求前完成。

## 草稿與發起（既有路徑，擴充後端行為）

- `PUT /api/esign/documents/:id/draftSave` → 200，回 signer 清單。
- `PATCH /api/esign/documents/:id/draft-settings` → 200，回建立人詳情。日期省略保留、null 清空；名單提供則整批取代。缺 email 可暫存，內部地址不由前端填入。
- `POST /api/esign/documents/:id/initiations` → 201，回建立人詳情。

```ts
type SignerInput =
  | { type: 'user'; userId: string }
  | { type: 'email'; name: string; email: string };

type Initiation = {
  signers: SignerInput[]; // 非空，容量至少支援 6,000 位
  fields: FieldPlacementDto[]; // 沿用既有 DTO，1–200
  signStartAt: string; // ISO8601
  signEndAt: string;
  watermark: boolean;
  allowReject: boolean;
};
```

內部 signer 若額外傳 email 不得作為收件依據。既有 type=user 欄位檢查／白名單應拒絕不允許的輸入；不能因額外欄位透傳改寄信箱。

發起每次重新查所有內部 email；缺漏／不合法 → 422 `ESIGN_EMPLOYEE_EMAIL_UNAVAILABLE`，details `{userIds:[...]}`，整份維持草稿。來源失敗 → 502；查詢後 userId→empid 改變或帳號失效 → 409 `ESIGN_EMPLOYEE_IDENTITY_CHANGED`，不提交。非草稿等既有錯誤維持現有碼。

成功時固定 email、原員工身分快照、邀請及通知，提交後背景寄送。creator detail 中 user signer 的 email 可為固定地址，invitationDelivery 兩種類型皆適用；不得因通知尚未送達把 201 當寄信失敗。發起沒有新增 requestId；回應遺失先重新 GET 文件確認狀態，不盲目重發。

## fgapi 私有契約

`POST /api/v1/hr/staff_emails`，`{person_empids:string[]}`，1–100 個完整員編，最多 20 碼 ASCII 英數。Server 使用既有 X-API-KEY／baseUrl，不送員工 Bearer。必須 success=true 且 data 為陣列，元素 `{person_empid,email}`；僅接受請求中員編，每個最多一筆。

上游缺人是合法稀疏結果；空白／無效 email 對應 unavailable。欄位型別錯誤、重複或額外員編、失敗 envelope 為 502。失敗日誌只含端點、狀態、耗時、錯誤類型與彙總數，禁止 request/response body 與員工資料。

## 新增錯誤碼（規劃）

| code | HTTP | 用途 |
| --- | --- | --- |
| ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE | 502 | 員工資格來源不可用 |
| ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE | 422 | 所選本機帳號不可用，details.userIds |
| ESIGN_EMPLOYEE_EMAIL_SOURCE_UNAVAILABLE | 502 | 信箱來源不可用／結構錯誤 |
| ESIGN_EMPLOYEE_EMAIL_UNAVAILABLE | 422 | 發起名單有無有效信箱的人員，details.userIds |
| ESIGN_EMPLOYEE_IDENTITY_CHANGED | 409 | 查信箱前後員工對應或有效性改變 |

實作集中定義於 AppErrorCode／AppErrors，繁體中文訊息不附員編、完整信箱或上游 body；前端依已選名單把 details.userIds 對應顯示姓名。
