# Spec 009 技術研究與決策

日期：2026-10-20。這是設計證據，不是功能或效能測試結果。

## 現有架構查核

- `server/src/features/esign/entities/` 已有 documents、signers、notification batches/logs、export jobs、file objects 與 audit events，優先擴充。
- `esign-document.entity.ts` 的日期 check 僅允許兩端皆空或皆有值；必須允許 draft 單端日期，非草稿仍嚴格驗證。
- `esign-signer.entity.ts` 已有 rejectedAt／rejectReason，但狀態 check 只有 pending/signed；現有欄位不代表拒簽已實作。
- `esign-initiation.service.ts` 已固定 watermark／allowReject；`completed-pdf.service.ts` 尚未繪製水印。
- `esign-access-policy.service.ts` 與 User 沒有人資權限來源。使用者已確認 Portal 管理發起入口，本專案本次不加角色檢查；匯出相關 API 僅要求有效員工 session，不靠部門文字推定。
- `private-file-storage.port.ts` 讀取支援 stream，寫入只接受 bytes，格式只 pdf/png；需要擴充 zip 串流及 Range。

## 決策 1：最少資料模型

**Decision**：沿用既有匯出工作，增加 immutable snapshot JSON（recordId、publicId、固定檔名、已存在的 file/version/hash），一次最多預期 6,000 個項目。副本未完成者只固定 signature record ID，完成後生成另一份解析 metadata，不覆寫原快照。成果 metadata 使用現有 file objects.exportJobId。

**Rationale**：受理不讀 PDF；6,000 筆 metadata 可批次取得，不需新增逐檔 table／跨 worker fan-out。快照大小、MySQL packet 與讀取成本納入實測，避免每處理一份重寫整份 JSON。

**Alternatives**：不採查詢當下動態名單，會違反快照；不採先建通用匯出平台；不建每人一個 worker 工作重繪 PDF。

## 決策 2：ZIP 與私有儲存

**Decision**：Archiver ZIP64，先 STORE、單一 ZIP、逐份串流。S3 以 @aws-sdk/lib-storage multipart，local 以暫存檔串流完成後發布。下載由 session 驗證的 API 串流代理，單 Range／If-Range，無簽名下載 URL。

**Rationale**：Archiver 提供 forceZip64、STORE 與 stream append，但輸出完成仍須等待目的地；這是官方 API 能力，並非吞吐保證。[Archiver 官方文件](https://www.archiverjs.com/docs/archiver/)

**Alternatives**：全 Buffer 記憶體隨總量增加；S3 presigned URL 會新增憑證 URL 例外，與目前 constitution 不符；分包可後續依驗收採用，目前不是必需。

延用 [大量 PDF 匯出研究](../../docs/research/2026-10-20-bulk-pdf-export-performance.md) 的來源、背壓、multipart 與 Range 調查；其中「可用短效 URL」及「可先提供部分包」只是研究候選，不是本次設計。

## 決策 3：併發、重用與清理

**Decision**：新匯出 queue 全域上限 1，現有 maintenance 恢復失敗工作與清理過期成果；完成時間加 168 小時為七天期限。所有人資共享同一 document/type 有效成果，不以申請人或新增簽署變更 cache key。

**Rationale**：全域 queue concurrency 限制整個 queue 跨 worker 同時工作數，與每個 worker 的 local concurrency 不同。[BullMQ 官方文件](https://docs.bullmq.io/guide/queues/global-concurrency)

**Alternatives**：每 worker 各限一個不足以控制總量；七天內重建新名單違反使用者決定；新 scheduler 不必要，既有 maintenance 已每 30 秒執行。

## 決策 4：水印與證據

**Decision**：讀發起固定 payload 的 watermark；true 才畫，false 不畫。使用 @pdf-lib/fontkit 與隨 server 部署的授權中文字型，文字／位置參考 client 既有樣式；在完成 PDF hash 與 manifest 前加印。舊完成副本不重繪。

**Rationale**：pdf-lib 自訂字型須註冊 fontkit，再 embedFont；不依賴系統或瀏覽器字型。[PDFDocument 官方文件](https://pdf-lib.js.org/docs/api/classes/pdfdocument#registerfontkit)

**Alternatives**：下載時加印使同一副本多版本；強制全部加印違反已確認設定；以西文字型畫中文可能缺字。

## 決策 5：拒簽與結案

**Decision**：同一文件鎖序處理簽署／拒簽／停止，拒簽是不可逆 signer 終態。signedCount 與 rejectedCount 分離，pending=0 才進結案，副本 readiness 只計 signed。既有 manifest 遍歷全員要求 PDF 必須修正為成功簽署集合，拒簽以不可變事件鏈保證；全拒不造 PDF。

**Rationale**：現有 finalization 的 ready===total 與驗證服務對每人要求 signature/PDF 會讓拒簽文件永遠卡住。

**Alternatives**：把 rejected 當 signed 會偽造簽署；一人拒簽就整份終止不符 spec。

## 決策 6：催簽的一致性

**Decision**：用既有 notification batches/logs 保存 requestId、type、結果與投遞狀態。逐 signer 鎖定，台北曆日成功或未知結果占用當日額度；pending/processing 跨日仍阻止新排入。實際交付 SMTP 前再次驗證與預占當日額度；明確未被接受的失敗可重試原明細，已接受但記錄不明不盲目重寄。午夜只改日界線判斷，不需重置排程。

**Rationale**：單靠前端禁用或 Redis TTL 會在並發、跨午夜及重啟失效。SMTP 接受與 DB 提交不是單一交易，不能保證物理寄信 exactly once。

**Alternatives**：技術重試建立新批次會失去追蹤；把 OTP rate limit 當催簽限額不符需求；寄信期間持有文件長交易影響正常簽署。

## 決策 7：催簽入口沿用 OTP

**Decision**：不旋轉 signer.invitationTokenSha256；reminder log 保存自己的 token hash／投遞密文及原邀請 digest generation。寄出清密文，resolver 支援兩類 token，皆走既有 OTP。pending 驗證當前輪次與期限，signed 仍可本人下載。

**Rationale**：`external-invitation.processor.ts` 寄出清除 signer ciphertext；`notification.repository.ts` 的現有重送候選依賴該欄位，必須依 batch.kind 改查 reminder log，不能直接重跑舊信。

**Alternatives**：重置原 invitation digest 會破壞原信及下載權；保留全部原邀請明文不必要；publicId 不是憑證。

## 決策 8：本地角色／permission 延後

**Decision**：依使用者最新明確決定，本次不加人資角色檢查。Portal 管理發起入口；本地跨建立人查找、匯出、紀錄及下載只驗有效員工 session 與資源／成果條件。外部 session 不得使用。

**Rationale**：現有 User／session 沒有此能力，使用者預計另加 role／permission；本次不建立第二套人資名單，也不把 Portal 選單限制誤稱為本地後端角色授權。

**Alternatives**：本地人資旗標、同步上游角色或新增RBAC均延後；不以 client role 或部門名稱作權威。後續新增角色機制時須收斂此跨建立人存取政策。

本輪設計澄清已完成，沒有未處理的技術決策阻礙。
