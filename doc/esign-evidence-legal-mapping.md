# 電子簽署保存參數與電子簽章法對照

本文件整理電子簽系統目前在簽署流程中保存的參數，並說明各參數在《電子簽章法》上的意義，供法務、HR 與開發團隊對照使用。

- 法規依據：[電子簽章法](https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=J0080037)（民國 113 年 5 月 15 日修正），條文以全國法規資料庫公告為準。
- 程式依據：`server/` 現行實作（Spec 03 核心簽署流程），資料表定義見 `server/src/infrastructure/database/schema.sql`。
- 本文件是技術面的對照，不是法律意見；是否適法須由法務確認。

## 1. 系統定位

本系統的簽署方式是「簽署人以 Canvas 手寫簽名，後端保存簽名圖檔與簽署證據」，屬於電子簽章法第 2 條第 2 款的**電子簽章**，不是第 3 款的**數位簽章**（未使用憑證機構簽發的憑證與私密金鑰）。

因此：

- 依第 4 條，符合本法規定的電子簽章在功能上等同實體簽章，不得僅因電子形式否認其效力。
- 不適用第 6 條「推定為本人親自簽名或蓋章」。發生爭議時，須以本文件列出的證據自行舉證簽署人身分、簽署意思與文件真偽。

## 2. 相關條文摘要

| 條文 | 重點 |
|---|---|
| §2② 電子簽章 | 依附於電子文件並與其相關連，用以辨識及確認電子文件簽署人**身分**、**資格**及電子文件**真偽**。 |
| §4 | 符合本法規定的電子文件及電子簽章，在功能上等同實體文件及簽章。 |
| §5② | 依法令應以書面為之者，內容**可完整呈現**，並**可於日後取出供查驗**，得以電子文件為之。 |
| §5③ | 依法令應簽名或蓋章者，得以電子簽章為之。 |
| §5④ | 有相對人時，相對人已同意者即可採用；否則須給予合理期間與方式表示反對，並告知未反對即推定同意。 |
| §5⑤ | 相對人得隨時表示停止採用電子形式；停止前已完成的法律行為，效力不受影響。 |
| §6 | 使用經許可憑證機構簽發、未逾有效期間及使用範圍之憑證所為的數位簽章，推定為本人親自簽名或蓋章。 |
| §7 | 應提出原本或正本者，可完整呈現並可日後取出查驗者，得以電子文件為之；但**應核對筆跡、印跡**或法令另有規定者除外。 |
| §8 | 應以書面保存者，可完整呈現並可日後取出查驗者，得以電子方式保存；並**得併同保存**收發地、網路協定位址、簽署歷程、日期與時間等可驗證、鑑別內容真偽的資料。 |
| §9 | 發文時間以電子文件進入發文者無法控制資訊系統的時間為準；收文時間依收文者指定或本人的資訊系統判定。 |
| §11 | 第 5 條第 1 至 3 項及第 8 條第 1 項得依法律排除適用。 |

## 3. 保存參數與法律意義

### 3.1 簽署證據 `esign_signature_records`

每位簽署人成功簽署時，在同一交易內建立一筆，之後不提供修改或刪除。

| 參數 | 內容與來源 | 電子簽章法上的意義 |
|---|---|---|
| `signer_id` | 簽署人 ID；UNIQUE，每位簽署人只會有一筆成功簽署 | §2② 依附並相關連：將簽署結果綁定到特定簽署人與文件。 |
| `document_sha256` | 簽署當下從 storage 讀回原始 PDF 重新計算的 SHA-256，並與發起時記錄的值比對一致才允許簽署 | §2② 確認文件**真偽**：證明簽署人簽的是發起時固定的那份內容。§8 可鑑別內容真偽的資料。 |
| `signing_payload_sha256` | 發起時固定的簽署參數（見 3.4）重新序列化後的 SHA-256，與發起時的值比對一致才允許簽署 | §2② 真偽：證明簽署人、欄位位置、簽署期間與告知版本在發起後未被變更。 |
| `consent_version` | 簽署人接受的告知版本，必須等於後端目前生效的版本 | §5④ 相對人**已同意**採用電子形式的證據。 |
| `authentication_method` | `employee_session`（內部員工 SSO 登入）或 `email_invitation`（外部 Email 邀請連結） | §2② 辨識簽署人**身分**的方式。 |
| `authentication_event_id` | `{internal\|external}:{signerPublicId}:{requestId}`；UNIQUE | §2② 身分驗證事件的識別；同時防止重複送出產生多筆簽署。 |
| `source_ip` | 送出簽署請求的來源 IP（Fastify `trustProxy: 1` 解析），最多 45 字 | §8 得併同保存的**網路協定位址**。 |
| `user_agent` | 送出簽署請求的 User-Agent，最多 500 字 | §8 其他可驗證、鑑別內容真偽的資料（簽署裝置環境）。 |
| `signed_at_utc` | 後端在簽署交易內記錄的時間（UTC） | §8 **日期與時間**；§9 簽署意思表示進入本系統（發文者無法控制的資訊系統）的時間。 |

### 3.2 簽名圖檔與文件檔案 `esign_file_objects`

檔案本體存放於私有 storage，資料表只保存中繼資料。

| 用途 `file_purpose` | 保存內容 | 電子簽章法上的意義 |
|---|---|---|
| `signature_png` | 每個簽名欄位一張 PNG；以 `signature_record_id` 連到簽署證據、`document_field_id` 連到簽名欄位；保存 `sha256`、`file_size`、`mime_type` | §2② 電子簽章本體，並與文件、欄位、簽署證據相關連。結案時重新計算 PNG 的 SHA-256 比對一致才會使用。 |
| `source_pdf` | 建立人上傳的原始 PDF；保存 `sha256`、`original_file_name` | §5②、§8 **可完整呈現、日後取出查驗**的原始內容。 |
| `completed_pdf` | 全員簽署後產生的完成 PDF（原始 PDF 疊上簽名圖與台北日期）；保存 `sha256` | §5②、§7、§8 可完整呈現並供日後查驗的最終文件。 |
| `archive_status` | `active` 才可被使用；完整性檢查會一併確認 | §8 保存狀態管理，確保使用的是有效的保存檔案。 |

### 3.3 簽署人與身分快照 `esign_signers`

| 參數 | 內容與來源 | 電子簽章法上的意義 |
|---|---|---|
| `public_id` | 對外使用的 UUID v4，不暴露內部流水號 | 簽署任務的識別。 |
| `signer_type`、`user_id`、`email` | 內部員工以 `user_id` 識別；外部簽署人以正規化後的 Email 識別 | §2② 辨識簽署人**身分**。 |
| `empid_snapshot`、`name_snapshot`、`department_snapshot`、`title_snapshot` | 指派簽署人時的員編、姓名、部門、職稱快照，之後人事資料變動不影響 | §2② 確認簽署人**身分與資格**（簽署當時的職務身分）。 |
| `status`、`signed_at` | 目前只允許 `pending`、`signed`；`signed_at` 與簽署證據的 `signed_at_utc` 相同 | 簽署狀態與時間。 |
| `invitation_token_sha256` | 外部邀請 token 的 SHA-256；不保存明文 | 外部簽署人身分驗證的依據（持有邀請連結）。 |
| `invitation_expires_at` | 外部邀請到期時間，等於簽署截止時間 | §2② **資格**：限制外部簽署人只能在簽署期間內簽署。 |
| `invitation_delivered_at` | 郵件服務接受寄送外部邀請的時間 | §9 可作為邀請**發文時間**的參考。 |
| `completion_receipt_sha256`、`completion_receipt_expires_at` | 外部簽署人完成後取得完成文件的收據 token 摘要與到期時間（30 天） | §5②、§8 讓外部簽署人在期限內取出完成文件。 |

### 3.4 文件與固定簽署參數 `esign_documents`

| 參數 | 內容與來源 | 電子簽章法上的意義 |
|---|---|---|
| `doc_number` | 文件 UUID | 文件識別。 |
| `title` | 文件名稱 | 文件識別。 |
| `created_by_user_id` | 建立人 | 文件發起者。 |
| `sign_start_at`、`sign_end_at` | 簽署期間（UTC）；截止時間點本身不含在期間內 | §2② **資格**：期間外不得簽署。 |
| `initiated_at` | 發起時間 | §8 簽署歷程。 |
| `signing_payload_json` | 發起時固定的簽署參數（內容如下） | §2② 真偽：發起後內容不可變更的基準。 |
| `signing_payload_sha256` | 上述 JSON 以固定順序序列化後的 SHA-256 | §2② 真偽：簽署時重新計算並比對。 |
| `allow_reject`、`watermark_enabled` | 發起時由建立人設定；同時寫入簽署參數 | 簽署規則的一部分，發起後鎖定。 |
| `completed_at` | 完成 PDF 驗證並保存後的時間 | §8 簽署歷程。 |
| `stopped_at`、`stop_reason` | 建立人停止或到期自動停止的時間與原因 | §8 簽署歷程；停止後既有簽署證據保留不變。 |

`signing_payload_json` 固定的內容：

| 區塊 | 欄位 | 意義 |
|---|---|---|
| `document` | `id`、`docNumber`、`title`、`sourceFileSha256` | 綁定原始 PDF 的摘要。 |
| `period` | `startAt`、`endAt` | 簽署期間。 |
| `consent` | `version`、`sha256` | 適用的告知版本與告知全文摘要。 |
| `options` | `parallelSigning`、`allowReject`、`watermark` | 簽署規則。 |
| `signers[]` | `id`、`publicId`、`type`、`userId`、`email`、`employeeNo`、`name`、`department`、`title`、`sortOrder` | 簽署人名單與身分快照。 |
| `fields[]` | `id`、`signerId`、`type`、`page`、`xPercent`、`yPercent`、`widthPercent`、`heightPercent`、`sortOrder` | 每個簽名／日期欄位的位置與所屬簽署人。 |

### 3.5 簽署欄位 `esign_document_fields`

| 參數 | 內容 | 電子簽章法上的意義 |
|---|---|---|
| `signer_id`、`field_type`、`page_number`、`x_percent`、`y_percent`、`width_percent`、`height_percent` | 欄位所屬簽署人、類型（簽名或日期）、頁碼與位置 | §2② 依附並相關連：簽名圖落在文件的哪個位置。發起後內容固定於簽署參數中。 |

### 3.6 電子簽署告知

定義於 `server/src/features/esign/services/esign-consent.service.ts`。

| 項目 | 內容 | 電子簽章法上的意義 |
|---|---|---|
| 版本 | `esign-consent-v1` | §5④ 證明簽署人同意的是哪一版告知。 |
| 文案 | 本人已閱讀並了解本文件內容，並同意以電子形式進行簽署。本人確認畫面中的手寫簽名代表本人對本文件內容的簽署意思表示。 | §5④ 相對人同意採用電子形式；同時表明簽署意思。 |
| 全文 SHA-256 | 寫入簽署參數的 `consent.sha256` | 可證明告知全文在發起後未被替換。 |
| 送出要件 | 簽署請求必須帶 `accepted: true`，且版本等於目前生效版本，否則拒絕簽署 | §5④ 未同意者不得完成電子簽署。 |

### 3.7 稽核事件 `esign_audit_events`

只追加、不修改。每份文件的事件以 hash chain 串接：`event_hash = SHA-256(前一筆 event_hash + 本事件內容)`，`event_hash` 為 UNIQUE。

| 參數 | 內容 | 電子簽章法上的意義 |
|---|---|---|
| `event_type` | 事件類型（見下表） | §8 **簽署歷程**。 |
| `occurred_at` | 事件發生時間（UTC） | §8 日期與時間。 |
| `actor_user_id`、`signer_id` | 操作的員工、相關簽署人 | §8 簽署歷程中的行為人。 |
| `request_id` | 請求追蹤 ID；簽署相關事件使用簽署請求的 `requestId` | 將同一次簽署的多筆事件串在一起。 |
| `metadata_json` | 事件附帶資訊（例如告知版本、狀態、停止原因） | §8 其他可驗證資料。 |
| `previous_event_hash`、`event_hash` | 前一筆與本筆事件的雜湊 | §8 可鑑別簽署歷程是否被竄改；任一事件被修改或刪除都會讓後續雜湊對不上。 |

目前記錄的事件：

| 事件 | 發生時點 |
|---|---|
| `document.created` | 建立草稿 |
| `document.draft_updated`、`document.draft_deleted` | 修改或刪除草稿 |
| `signer.assigned` | 發起時指派每位簽署人 |
| `document.initiated` | 發起簽署 |
| `external_invitation.opened` | 外部簽署人開啟邀請 |
| `document.opened` | 內部簽署人開啟文件 |
| `consent.accepted` | 簽署人接受告知（記錄告知版本） |
| `signature.submitted` | 簽署人送出簽名 |
| `signature.completed` | 簽署完成 |
| `document.completed` | 完成 PDF 產生並驗證後結案 |
| `document.finalization_failed` | 完成 PDF 產生失敗（可重試） |
| `document.stopped_by_creator`、`document.stopped_by_deadline` | 建立人停止或到期自動停止 |

### 3.8 外部邀請寄送 `esign_notification_batches`、`esign_notification_logs`

| 參數 | 內容 | 電子簽章法上的意義 |
|---|---|---|
| `channel`、`result` | 寄送管道（Email）與結果（`delivered`、`failed` 等） | §9 邀請是否送達郵件服務。 |
| `attempt_count`、`completed_at` | 嘗試次數與完成時間 | §9 發文時間的佐證。 |

## 4. 完整性驗證時點

| 時點 | 驗證內容 |
|---|---|
| 發起 | 讀回原始 PDF 計算 SHA-256，寫入簽署參數；計算簽署參數的 SHA-256。 |
| 簽署 | 重新讀取原始 PDF 並比對 SHA-256；重新計算簽署參數的 SHA-256 並比對；不一致即拒絕簽署。 |
| 結案 | 再次比對原始 PDF、簽署證據中的文件摘要、簽名 PNG 的 SHA-256；產生完成 PDF 後讀回比對 SHA-256，一致才結案。 |

## 5. 尚未保存或尚未實作的部分

| 項目 | 現況 | 相關條文 |
|---|---|---|
| 拒絕簽署 | `esign_signers` 已有 `rejected_at`、`reject_reason` 欄位，但狀態限制只允許 `pending`、`signed`，也沒有拒簽 API，簽署人目前無法表示不採用電子形式。 | §5⑤ |
| 外部簽署人身分 | 只以持有 Email 邀請連結驗證，沒有 OTP 等第二因子。 | §2② 身分 |
| 證據不可修改 | 由程式層保證（repository 只提供新增與查詢），DB 層未以 trigger 或權限阻擋 UPDATE、DELETE。 | §5②、§8 |
| 完成 PDF 的獨立驗證 | 完成 PDF 只疊上簽名與日期，沒有附簽署紀錄頁，也沒有數位封印；離開系統後無法自行驗證真偽。 | §2② 真偽 |
| 憑證式數位簽章 | 未使用憑證機構簽發的憑證，不適用推定效力。 | §6 |
| 來源 IP 的正確性 | 前端串接時若由 Next.js server 代為呼叫，記到的會是 Next.js server 的 IP，須轉帶 `X-Forwarded-For` 並與代理層數一致。 | §8 |
| 可信時間 | 時間依伺服器時鐘，沒有可信時戳服務。 | §8、§9 |
| 收發地 | 未保存。條文為「得」併同保存，非強制。 | §8 |

## 6. 待法務或 HR 確認

- 可使用電子簽的文件類型：需核對筆跡、印跡的文件（§7 但書）及法律排除適用的文件（§11）不應使用本系統。
- 電子簽署告知文案定稿，包含是否告知簽署人可改以紙本辦理（§5④、§5⑤）。
- 各類文件的保存年限、備份方式與是否需要可信時戳（§5②、§8、§9）。
- 高風險文件是否需要憑證式數位簽章（§6）。
