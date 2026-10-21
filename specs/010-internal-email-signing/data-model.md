# Data Model：內部 Email 簽署

狀態：已實作於既有表，entity／migration／schema.sql 同步；隔離 MySQL 已驗證 up→down→up 與不相容資料拒絕 rollback。未對開發／部署環境執行 migration，未回填歷史資料。

## EsignSigner（既有 esign_signers）

| 欄位 | 設計 |
| --- | --- |
| signer_type | 保持 user／email；內部不轉外部 |
| user_id、empid_snapshot | user 必填；email 為 NULL；保留既有帳號 FK 與 document_user unique |
| email | 沿用 VARCHAR(255) nullable，語意改為固定通知 Email。內部草稿／歷史指派可 NULL，新發起必須是正規化有效地址 |
| external_email | 新增 nullable VARCHAR(255) STORED generated column：CASE WHEN signer_type='email' THEN email ELSE NULL END；沿用 email charset／collation，不進 DTO、snapshot 或寫入參數 |
| invitation_token_sha256 | 內外部皆可保存，唯一索引保留；單人單文件邀請世代 |
| invitation_token_ciphertext | 待寄密文，送達後沿用清除規則；不可為永久複製連結而保留 |
| invitation_expires_at／delivered_at | 兩種類型適用；已簽下載依既有狀態規則，不受原簽署期限影響 |
| name／department／title snapshots | 保留員工發起快照，不隨 HR 更新；public Email task 不暴露非必要內部欄位 |
| status、signed_at、rejected_at、completion_* | 沿用 pending→signed 或 pending→rejected；終態不得重簽，副本流程不變 |

### CHECK／索引變更

- identity CHECK 的 user 分支保留 user_id／empid_snapshot 非 NULL，移除 email／邀請三欄必須 NULL 的限制；email 分支保留 user_id／empid_snapshot NULL、email 非 NULL。
- 刪除 `uq_esign_signers_document_email`，改成 `uq_esign_signers_document_external_email(document_id, external_email)`。外部正規化 email 保持唯一；不同 user 同 email、user 與 email signer 同地址都不互相合併。
- 草稿允許沒有邀請／email；新發起完整性由 service 在同一交易驗證，不用 CHECK 跨表查文件狀態。
- generated 欄位需以 TypeORM asExpression／generatedType 定義並排除一般 insert/update／select DTO；與 migration、schema.sql 及 MySQL 實際 metadata 一致。

### Migration 與 rollback

只修改既有表。up 先加入 derived 欄位與外部 unique，再替換舊 unique／identity CHECK，確保變更間不缺外部唯一性。保留其他約束。MySQL DDL 不保證整組 transactional rollback，migration 須記錄順序並驗證前置 schema，失敗不得以清資料恢復。

down 在執行任何 DDL 前確認：無 user email／邀請資料、無違反舊 document_id,email unique 的資料。若有則明確拒絕回滾，不刪信箱、憑證或指派。無新資料的隔離測試庫可還原舊 CHECK／unique 後移除 generated 欄位。測試 up→down→up 以及有新內部邀請時 down 拒絕且資料不變。

## 發起快照與簽署證據

- 現有 signingPayloadJson schemaVersion 2 已包含 signer.email。內部 email 必須在 buildSigningSnapshot 前固定並納入 hash；不新增 parallel payload 或變更歷史版本。
- Email principal 簽署使用既有 authenticationMethod=email_invitation，signer 本身仍保留 user 身分。已存在的 employee_session 簽署、manifest、PDF、audit chain 不回填或重算。
- 舊無 email 的內部指派不能由員工 session 簽署／拒簽，也不自動補寄。既有檔案保留，建立人既有管理下載權限不改。

## 帳號解析與信箱預覽（非新表）

- Resolution 只對所選員編沿用 User 建帳流程；停用／刪除帳號不可重新啟用。該操作不建立 signer、邀請或文件授權。
- EmailCheck 結果只在 request 記憶體，狀態 ready／unavailable。unavailable 原因 missing／invalid_email 不代表確切人事狀態；對外統一提示無有效信箱。
- 新發起重新查來源，不能接受前端傳入的 email-check 結果或地址作可信依據。

## 通知（既有 batch／log）

- invitation、reminder kinds 沿用；每筆 log 依 signerId，非 email。filterType 的既有儲存字串可保留相容，新語意於 Swagger 說明，不因 external 字樣排除 user。
- 初次／補簽新 log 記錄既有 invitationGenerationSha256。worker claim、結果回寫及密文清除必須核對 log 世代與當前 signer 世代，不重用舊 log 發新 token。未 claim 的舊 log 不再寄；已在途的舊信可能送達，但其連結必須失效，舊結果不得覆寫新通知或新 signer 世代。
- 舊通知 log 缺少 generation 時 fail-closed，不自動補寄或回填。到期落盤保留原 digest／期限供補簽檢查，只清除待簽邀請密文；狀態與截止時間仍禁止舊邀請授權。
- 補簽原子更新文件期限、pending 邀請、舊通知結果及新通知；signed／rejected 指派與世代不變。不修改原 signing payload。
- 郵件結果沿用 pending／processing／delivered／failed／skipped／unknown。SMTP 接受不等於收件人已閱讀。

## Redis 與存取狀態

- org-chart 維持環境／來源隔離 key 與固定 7,200 秒 TTL；無重設 TTL、刷新參數、排程。
- OTP 依 signerId 隔離，6 位、10 分鐘、錯 5 次、60 秒冷卻、每小時 5 封；同 email 不共享額度。
- credential 保留雜湊、signerId、邀請 generation、8 小時期限。補簽世代更換使待簽者舊 credential 失效；已簽者世代不變。
- 不新增 email Redis cache、資料同步工作或新一般登入 session。
