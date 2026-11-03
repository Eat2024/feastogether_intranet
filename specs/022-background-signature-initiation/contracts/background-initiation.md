# 022 背景發起 API 契約

> **最新範圍優先**：本輪只改後端 worker 與文件／簽署人異動保護；前端工作暫緩。原本必填 Idempotency-Key 改選填以相容既有 client。具體覆寫與已知限制見 [後端範圍決策](../backend-only-scope.md)。

狀態：待實作設計。Base path `/api`。實作時以 Nest Swagger DTO／annotations 產生 OpenAPI，並驗證本文案例；不宣稱端點已存在。

## 共通規則

- 所有端點要求有效員工 session；寫入沿用 OriginGuard。每次操作都確認當前使用者是文件建立人，不能以同部門唯讀權限讀工作內容。
- 不存在、工作不屬於該文件或非建立人統一 404；未登入依既有 401。停用／刪除員工不能藉先前受理繼續查詢，worker 正式發起前也重新驗證資格。
- 沿用 `{success,data,timestamp}`／`{success:false,error,timestamp}` envelope。下列 JSON 範例僅為 data 或 request body，不重複包裝。
- `x-request-id` 是每次 HTTP trace；`Idempotency-Key` 是 client 保存的 UUID 請求識別，兩者不可混用。Idempotency-Key 不是憑證，仍需授權。
- 日期用 ISO UTC；ID 為字串；回應 `Cache-Control: private, no-store`。不記錄 request body／key 對應的完整名單、cookie、token、信箱或 PDF。

## 1. POST /esign/documents/{documentId}/initiations

每次有效提交皆背景化。必須帶 `Idempotency-Key: <UUID>`；不得透過人數、mode、userId 格式或前端 count 要求同步。沒有 key 回 400 與繁中「請重新整理頁面後再提交」，不建立工作。

### 輸入

```json
{
  "signers": [
    { "type": "employee", "employeeNo": "SYN00001" },
    { "type": "email", "name": "合成外部簽署人", "email": "signer@example.invalid" }
  ],
  "fields": [
    { "type": "signature", "page": 1, "xPercent": 10, "yPercent": 60, "widthPercent": 20, "heightPercent": 10, "sortOrder": 0 }
  ],
  "signStartAt": "2026-12-01T00:00:00.000Z",
  "signEndAt": "2026-12-31T15:59:59.000Z",
  "watermark": true,
  "allowReject": false
}
```

- 新增「發起專用」signer DTO：employeeNo 為完整英數字串 1–20 字，保留前導零／大小寫，不以顯示 label 當身分。
- 接受既有 `{type:"user",userId:"123"}` 內部表示法；同請求內部項目必須全部 employee 或全部 user，不能混用以製造重複身分。外部可與任一內部表示混合。
- 外部沿用既有姓名／email 正規化、唯一性與檢核。不接收內部 email/name 作主檔覆寫；employee 與 user 不得同時附兩種識別。
- 完整名單、1–200 共用欄位、既有 page/percent 驗證、合法且 start<end 的時間；受理時 end 必須在未來。0 人拒絕，不新增 100／6,000 人上限。
- frontend 組織展開去重後提交，server 再檢查重複；非法重複輸入回 400，不靜默少發幾人。總數由 server 計算。無效／找不到本機人員則背景失敗，不在受理逐人查核。
- 原檔 hash／版本從 DB 取得，不相信 client 傳入。HTTP body 超過既有限制回 413，不截斷或部分受理。

### 成功與重播

首次持久受理回 202，`Location` 指向該工作的 GET。不返回文件詳情或名單。

```json
{
  "jobId": "00000000-0000-4000-8000-000000000001",
  "documentId": "123",
  "status": "queued",
  "stage": "queued",
  "totalCount": 2,
  "processedCount": 0,
  "attemptCount": 0,
  "acceptedAt": "2026-11-03T10:00:00.000Z",
  "updatedAt": "2026-11-03T10:00:00.000Z",
  "deadlineAt": "2026-11-03T12:00:00.000Z",
  "nextAttemptAt": null,
  "completedAt": null,
  "errorCode": null,
  "retryable": false,
  "issueCount": 0,
  "detailsExpired": false,
  "reused": false
}
```

- 同 document+key、同正規化請求：200，回原工作當下狀態，`reused:true`；已 failed 仍回 failed，不能默默重試，已 succeeded 不再發起。
- 合法重播在目前授權及 request hash 確認後直接回原工作；不因原 signEndAt 已過或明細已清理而拒絕。未來截止時間與可發起狀態只驗證新受理。
- 同 key 改內容：409 `ESIGN_INITIATION_REQUEST_CONFLICT`。
- 不同 key 且同文件有 queued／processing 工作：409 `ESIGN_INITIATION_IN_PROGRESS`，details 僅建立人可見 existingJobId。
- 不同 key 且文件已非 draft：沿用文件狀態衝突 409。舊 key 的合法重播先於 draft 狀態拒絕處理。
- 不存在／越權 404；格式 400；可靠保存失敗 503。若 commit 結果無法確認，client 保留 key、先查 latest 或用原 key 重送，不能當作確定未受理。已 commit 後 Redis enqueue 失敗不能回「未受理」。

## 2. GET /esign/documents/{documentId}/initiation-jobs/latest

200 data 為最新工作摘要，無工作則 `null`。只讀，不觸發補列、重試或修改。用於重整、換裝置與網路回應遺失後找回；以工作 id 排序，排除不了解的 client timestamp。

## 3. GET /esign/documents/{documentId}/initiation-jobs/{jobId}

200 回同款摘要（省略 reused）。HTTP 200 不等於發起成功；以 status 判斷。

- queued：等待／重試等待；nextAttemptAt 可有值。
- processing：resolving／validating／committing；processedCount 僅指本 attempt 已查核人數。committing 不顯示偽造的完成百分比。
- succeeded：completed；文件與初邀紀錄已提交，不保證郵件送達。
- failed：failed；errorCode、retryable、issueCount 提供下一步。status failed 是工作結果，不回 HTTP 500。

client 每 3 秒輪詢，終態停止；401／403／404 停止並提示。網路／503 顯示暫時無法更新進度，不改判業務失敗，也不重建工作。進度頁不呼叫完整 detail 作為輪詢替代品。

## 4. GET /esign/documents/{documentId}/initiation-jobs/{jobId}/input

建立人按需取得當次確認的 signers／fields／signStartAt／signEndAt／watermark／allowReject，形狀同 request。只用於檢視／失敗後編輯還原，不能放在 polling 或列表。

不回 file object key、內部 version JSON、token、主檔 email 或未提交的管理欄位。外部簽署人輸入的 name/email 為還原必要資料，可向建立人回傳。來源組織樹已無該員工時仍保留原員編為可移除項目。

終態滿 30 天明細清理後回 410 `ESIGN_INITIATION_INPUT_EXPIRED`；不能回空名單假裝成功。

## 5. GET /esign/documents/{documentId}/initiation-jobs/{jobId}/issues

只在 failed 終態讀取不可變問題清單；非 failed 回 409 `ESIGN_INITIATION_ISSUES_NOT_READY`。`offset` 預設 0、非負整數；`limit` 預設／最多 100、最少 1。200 data：

```json
{
  "total": 1,
  "items": [
    { "inputIndex": 0, "employeeNo": "SYN00001", "code": "EMPLOYEE_UNAVAILABLE", "message": "員工資料尚未同步或帳號不可使用，請確認後重新提交。" }
  ],
  "nextOffset": null
}
```

外部項目只用 inputIndex 對應已持有輸入，不重傳 email。全為系統故障可 total=0；inputIndex 是零起算且穩定，不使用全域 employee 查詢。清理後回 410；摘要 issueCount 保留。

## 6. POST /esign/documents/{documentId}/initiation-jobs/{jobId}/retries

必帶新的 Idempotency-Key，body 空。僅「最新工作 failed、retryable=true、輸入仍保留、原檔／草稿版本相同、目前仍 draft、建立人有效、截止尚未到」允許建立新 job，保存 parent_job_id 並複製確認輸入。首次 202、同 key 重播 200；冪等請求 hash 包含 parent job ID 與原 request hash，不能與 initiation 的 key 混淆。

重播先於新工作資格驗證：先依 document+key 查既存子工作並核對 parent/hash，再返回該子工作。即使子工作已成功、parent 已非 latest 或 parent 明細已清理，合法重播仍回 200；沒有既存 key 才驗以下新受理條件。

有其他進行中工作、舊 job 已被新提交取代、非可重試狀態或版本已改回 409；input 已清理回 410。需要改人員／欄位／期限時使用新的 initiation 請求，不讓 retries 接受覆寫 body。

## 7. 文件列表與既有草稿 API

列表新增 nullable `initiationSummary`（jobId/status/stage/totalCount/processedCount/attemptCount/updatedAt/errorCode）。只對文件建立人提供；其他同部門人為 null，不擴張原文件可見範圍。摘要批次取小欄位，禁止 join/select 工作 JSON 進 filesort。

queued／processing 期間，PATCH 文件、DELETE 草稿、draftSave、draft-settings、PUT fields、其他草稿寫入及重新發起都回 409 `ESIGN_INITIATION_IN_PROGRESS`。查詢工作不套用部門唯讀授權捷徑。

## 穩定背景錯誤分類

預計新增代碼集中在 AppErrors／AppErrorCode；下列是契約名稱，不能任意回傳 DB message。

| errorCode | 自動重試 | 建立人下一步 |
| --- | --- | --- |
| ESIGN_INITIATION_EMPLOYEE_UNAVAILABLE | 否 | 查 issues，先同步或修正人員再重新提交 |
| ESIGN_INITIATION_DOCUMENT_CHANGED | 否 | 重新開啟草稿確認內容 |
| ESIGN_INITIATION_CREATOR_UNAVAILABLE | 否 | 確認建立人帳號，停用者不得讀取工作 |
| ESIGN_INITIATION_DEADLINE_PASSED | 否 | 修正已過的簽署期限並重新提交 |
| ESIGN_INITIATION_INPUT_INVALID | 否 | 修正欄位／原檔／身分重複等問題 |
| ESIGN_INITIATION_TRANSIENT_FAILURE | 最多 3 次 | 耗盡後 failed 且 retryable=true，若仍符合條件可人工 retry |
| ESIGN_INITIATION_PROCESSING_TIMEOUT | 否 | 120 分鐘界線；仍未過簽署截止且輸入有效時可人工 retry |
| ESIGN_INITIATION_INTERNAL_ERROR | 否 | 非預期錯誤先維運核對，不盲目無限重試 |

寄送缺信箱／白名單／SMTP 結果沿用通知模組，不作為發起 job 的 failed 原因。

## 相容與發布

這是發起 API 的明確契約變更：不再回 201／EsignDocumentDetail，且新增必填 key。legacy userId 只代表輸入形狀可接受。更新 client API 型別為工作摘要，禁止沿用 mutation onSuccess=published。前後端與 worker 需協調發布；舊開啟頁面須重新整理。不得新增 production 同步捷徑來讓舊測試繼續通過。
