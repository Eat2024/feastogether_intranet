# Spec 009 資料模型與狀態

本文件為 migration 設計，尚未改 schema。沿用既有表，不先建通用角色／通知／匯出框架。所有業務時間以 UTC datetime(6) 存放；催簽 business date 才以 Asia/Taipei 算 YYYY-MM-DD。

## 文件／簽署人／證據

| 既有 entity | 變更與不變量 |
|---|---|
| EsignDocument | 使用既有 signStartAt、signEndAt、watermarkEnabled、allowReject。draft 日期允許任一端 null；皆有時 start<end。非草稿必須兩端完整。發起 payload 固定選項；後續保存不得改寫 |
| EsignSigner | status 增加 rejected；沿用 rejectedAt、rejectReason。新增 note（varchar(30)，utf8mb4；service 限30 code points、預設空字串）、rejectRequestId（nullable UUID） |
| signer completion CHECK | pending/rejected 均不得具有完成 PDF 狀態；signed 才允許 pending/processing/ready/failed 等既有 completion 狀態。signedAt 與 rejectedAt 不可同時存在 |
| EsignAuditEvent | 既有 signerId／actorUserId／metadataJson 可表達 rejected 事件，記 reason／requestId。只追加，不回填或改寫歷史 hash |
| EsignSignatureRecord | rejected 不建 record；已成立 record 不更新 |
| verification snapshot | 新結案 manifest 版本增加 rejected 摘要（publicId、時間、原因或其可驗證摘要）及 audit chain 對應；signed 清單才有 PDF hash。舊版本 reader 保留，不重建舊證據 |

note 與 reason 先 trim，使用 Unicode code point 長度（不是 UTF-16 length）。note null 非法，空字串清除；reason 預設空字串、上限200。DTO 與 service 都驗證。

### 狀態／交易

- 鎖序固定 document → signer（多人時按 id 排序），避免簽署、拒簽、停止、催簽相互死鎖。
- `pending → signed` 或 `pending → rejected`，不能從終態退回。拒簽同一 requestId 回第一次結果；不同 requestId 或內容不同回409，不覆寫原因。
- 外部拒簽重送先驗本人 credential 與原 requestId，才判待簽資格；已拒可讀本人結果，不開放原始 PDF 或完成 PDF，不給新的簽署資格。
- `pendingCount=0` 才可結案；有 signed 時 `readySignedCount=signedCount` 才完成；全拒 signedCount=0 仍有結案事件與可驗證 manifest，但不產生 PDF。
- expired/stopped 不因最後副本產製而復活 active；已簽者副本產製維持既有規則。補簽仍依 Spec007，只處理 pending。

## 通知批次／明細（擴充既有表）

| Entity | 新增／擴充欄位 |
|---|---|
| EsignNotificationBatch | publicId UUID unique、kind invitation/reminder（舊資料預設invitation）、requestId nullable、requestPayloadSha256；現有 documentId、notifiedByUserId、filterType、targetCount 保留 |
| EsignNotificationLog | result 增 skipped/unknown；reason 使用既有 errorCode；新增 dispatchDate DATE nullable、leaseToken、attemptHistoryJson、reminderTokenSha256 unique nullable、reminderTokenCiphertext nullable、invitationGenerationSha256 nullable、reminderExpiresAt nullable |

批次防重 unique(documentId, notifiedByUserId, requestId)，相同 key 不同 payload→409。逐人沿既有 unique(batchId,signerId,channel)。新增索引 signerId/result/dispatchDate，查當日 delivered/unknown 或未結束的 reminder；所有建立與派送保留在文件／簽署人鎖內判斷，queue dedup 不作唯一正確性來源。

`pending → processing → delivered | failed | skipped | unknown`。明確未寄失敗可原明細重試；unknown 不自動重寄，避免 SMTP 已接受但 DB 未寫回的重複寄送。unknown 當日占額度，次日可新催簽但不可自動重試舊 unknown。pending／processing 跨日仍阻止新排入；lease 過期先轉 unknown，再由下一個日界線處理，不假裝成功。

每日限額以實際 dispatch 日期計算。批次建立時先檢查當日額度與未結束明細，SMTP 前再以文件／簽署人鎖保留當日 dispatchDate 與 processing 狀態，提交後才發信。兩次短交易間簽署完成則派送前再次讀資格；SMTP 交付與業務寫入無法原子化，已交付不可收回，入口仍即時阻擋已失去資格者。

首次 invitation 不占 reminder 限額；OTP 限額維持獨立。投遞明細保存操作者、對象與每次狀態變更的時間／穩定原因；attempt history 可用 log 的 JSON 陣列（有限重試次數），不保存信件內容與憑證。

### 催簽憑證

原 signer invitation digest 不旋轉。每個 reminder log 產生獨立 opaque token，儲存 hash 與供投遞用的加密原值；成功寄出清密文、保留 hash。resolver 支援原邀請 digest 與 reminder digest，兩者都只導向既有 OTP 流程。

reminder 保存建立時原 signer invitation digest 作 generation；pending 必須 generation 相同且仍在有效期間。補簽輪若更新 invitation digest，舊輪 reminder 自動失效。signed 本人讀結果／下載沿 Spec008，不因七天匯出期限或提醒信日期過期失效；不同人的 credential 不可互換。OTP session 仍不含管理權限。

## 匯出工作與檔案

| 欄位 | 用途 |
|---|---|
| publicId UUID unique | 對外工作識別；內部 bigint 不作權限 |
| exportType | 本次固定 signed_copies_zip |
| documentId／createdByUserId | 文件與最初申請人；快取不以申請人區分 |
| snapshotAt／snapshotJson／snapshotSha256 | 不可變受理範圍，包含 signatureRecordId、signerPublicId、檔名；已存在副本另記 fileId/version/hash |
| resolvedFilesJson | 等待中的副本首次完成後，固定其 fileId/version/hash/size；不覆寫原始快照，不逐份重新保存大型 JSON |
| recordCount／processedCount／waitingCount | 固定總數、當次處理數、等待副本數；處理數不是發布成功 |
| status | pending / waiting / processing / completed / failed / expired |
| completedAt／expiresAt | 完成+168小時固定，不因存取更新；過期狀態可由時鐘推導，GET不寫入 |
| leaseToken／leaseExpiresAt／attemptCount／nextAttemptAt | fencing、重試與maintenance恢復 |
| stagingJson | generation、暫存 object key／multipart uploadId，避免孤兒上傳 |
| failureCode | 穩定可公開錯誤，不含 object key／SDK raw message |

所有新增欄位於舊資料 nullable，舊 snapshot 空的工作不作重用。索引 (documentId,exportType,status,expiresAt,id)、(status,nextAttemptAt,id)、leaseExpiresAt。

文件鎖下優先取得未到期 completed，其次既有 pending/waiting/processing；都沒有才建立快照。並發請求只產生一工作。failed 由明確 retry 子資源重試同一快照；新 export request 不暗中換掉失敗快照。完成未滿七天但實體遺失回 unavailable，不另建快照繞過重用規則。

既有 EsignFileObject 記 ZIP 成果，filePurpose=`signed_copies_zip`、mimeType=`application/zip`、exportJobId 有值、documentId 為 null，避免 document/purpose 唯一索引衝突。新增 unique(exportJobId,filePurpose)（本版單包），size/hash/objectVersion 由串流實際結果決定。檔名為清理後的姓名＋signerPublicId.pdf，去除路徑分隔符、控制字元與保留名稱，不以 Email 當檔名。

## 本階段匯出存取

Portal 管理發起入口；本專案本次不實作本地 role／permission，不新增人資欄位或名單。跨建立人匯出相關 API 以有效員工 session 驗證，所有有效員工 session 皆可使用；外部簽署 session 不適用。資源歸屬、刪除狀態、成果期限仍由後端驗證。人資查找 DTO 僅回文件標題、識別、建立人、狀態、已簽數與匯出狀態，不放寬原詳情頁的備註／其他管理資料。

## 遷移與回滾

新增欄位與索引先上，worker/API 相容後上；停用新功能前不得刪除拒簽證據、reminder digest 或有效匯出 metadata。down 若有新狀態先 fail closed；測試全空、舊資料、混合新資料與唯一鍵競態。entity comment、schema.sql、metadata/schema test 一起更新。role／permission 的資料模型由後續規格處理，本次不預建。
