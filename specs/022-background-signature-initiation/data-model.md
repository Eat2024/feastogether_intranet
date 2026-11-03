# 022 資料模型：全量背景發起

> **最新範圍優先**：本輪只改後端 worker 與文件／簽署人異動保護；前端工作暫緩。原本必填 Idempotency-Key 改選填以相容既有 client。具體覆寫與已知限制見 [後端範圍決策](backend-only-scope.md)。

狀態：設計文件，未建立資料表。正式文件／指派／通知／證據維持既有模型。

## 背景工作 `esign_initiation_jobs`

繼承 AuditableEntity；無業務刪除 API。Repository 預設不選取大型 JSON，只有明確授權的執行與輸入讀取路徑取用。

| 欄位 | 型別／限制 | 用途 |
| --- | --- | --- |
| id | bigint PK | 內部游標與最新工作排序 |
| public_id | UUID，unique | API jobId；識別不代表授權 |
| document_id | bigint FK esign_documents，RESTRICT | 原草稿／最終文件 |
| created_by_user_id | bigint FK users，RESTRICT | 原發起者，所有寫入的明確 actor |
| request_key | UUID | 對應 Idempotency-Key，與 document_id 組合唯一 |
| request_hash | SHA-256 | server 正規化請求後計算；保留名單順序與欄位 sortOrder |
| parent_job_id | nullable bigint self FK，RESTRICT | 人工重試來源；新工作不復活舊列 |
| input_json | nullable JSON，預設不 select | 受理名單、共用欄位、期間、選項；非終態不可為 null |
| document_version_json | nullable JSON，預設不 select | 文件 ID、原 updated_at 微秒原值、source file ID/hash/object version；不是 client 提供的可信值 |
| status | queued／processing／succeeded／failed | 業務工作狀態 |
| stage | queued／resolving／validating／committing／completed／failed | UI 階段 |
| total_count / processed_count | 非負整數；0 ≤ processed ≤ total | 本輪已查核筆數，不等於已建立指派 |
| attempt_count | 整數 0..3 | 每次取得有效 claim 才 +1，重播不加 |
| next_attempt_at | nullable UTC datetime(6) | DB 管理 backoff |
| lease_token / lease_expires_at | nullable UUID／UTC datetime(6) | claim fencing；processing 才有值，token 不回 API |
| accepted_at / deadline_at | UTC datetime(6) | deadline=min(accepted+120min, signEndAt)，同一 job 不延長 |
| last_progress_at / started_at / completed_at | UTC datetime(6)，適用欄位可空 | 最新進度、首次執行與終態時間 |
| error_code / retryable | nullable 穩定代碼／boolean | 系統級失敗分類；不存任意 exception message |
| issue_count / issues_json | 非負整數／nullable JSON，預設不 select | 按輸入 index 記錄 employeeNo 或外部項目 index 與分類，不含 HR raw payload |
| input_purged_at | nullable UTC datetime(6) | 終態敏感明細已清理，摘要仍可讀 |
| created_at / updated_at / deleted_at | 既有稽核欄位 | 不以 soft delete 釋放非終態工作或繞過唯一約束 |
| active_document_id | generated stored bigint | status 為 queued／processing 時等於 document_id，其他為 NULL；unique |

索引：unique(public_id)、unique(document_id, request_key)、unique(active_document_id)、(document_id,id)、(status,next_attempt_at,id)、(status,lease_expires_at,id)、(status,completed_at,id)。FK 索引由 schema 一併確認，不以新欄位覆寫任何 users 主檔。

約束：total_count>0；非終態 input/version 不空、completed_at 空；processing 必須有 lease，其他狀態沒有有效 lease；succeeded stage=completed 且 error_code 空；failed stage=failed 且有分類錯誤；processed_count 不大於 total_count。清理不刪摘要列，也不更新既有正式簽署證據。

## 不可變輸入

- 新內部輸入保存完整 employeeNo，保留前導零與大小寫，不相信顯示姓名。舊 userId 格式只保存 ID，worker 鎖內讀主檔取得身分；同請求不得混用兩種內部表示。
- 外部保存建立人輸入的 name／正規化 email；維持現有重複／身分規則，不自動合併不同人的同信箱。
- request_hash 僅涵蓋正規化請求，不包含每次查詢都會變的 DB timestamp。document_version_json 分開保存並在正式交易驗證。
- 原檔識別只保存 metadata，不存 bytes、cookie、token、OTP、完整 users 或寄信憑證。進入正式發起後才建立既有 invitation token 與正式 signing_payload_json。
- 文件版本的 updated_at 以 DB 微秒字串保留，不經 JS Date 截斷後當唯一版本憑據；另核對 source file ID/hash/version。工作進度不得修改文件 updated_at，以免自我造成版本衝突。

## 狀態轉移

```text
新受理 → queued → processing(resolving → validating → committing) → succeeded
                        ├─ 暫時失敗且可重試 → queued(next_attempt_at)
                        └─ 資料失敗／期限到／嘗試耗盡 → failed
failed → 明確人工 retry → 新 queued 列（原 failed 列不變）
```

- claim 使用短交易，只鎖 job；成功後釋放鎖再預查。並行的相同 delivery 只有一個 lease 能取得權限。
- 預查續租、進度、暫時失敗回佇列均以 id/status/lease_token CAS；失去 lease 的舊 worker 不得再寫入。
- stage=committing 在正式交易前以有效 lease 的短 CAS 提交，讓輪詢看見階段；不能據此宣告成功。正式交易仍重驗 lease，只有業務與 succeeded 同時提交才算完成。
- 正式交易鎖 users（ID 升冪，共享鎖）→ document（獨佔鎖）→ job（獨佔鎖）。確認 active job 仍為自己、lease 未失效、版本／授權／期間有效；與文件 active、指派、快照、通知、audit 一起標 succeeded。工作成功前先標完成或提交後再標成功都禁止。
- 回收只處理可鎖定／已過期列；不可持 job 鎖再等待 document。正式交易持 job 鎖期間不啟動獨立同列 heartbeat，maintenance 不強搶。
- 已 commit 但 worker 未確認 Redis：再次執行先讀 succeeded，返回，不重建通知。確認完成前 crash：DB 回滾後才能重新 claim。
- `status=active` 卻沒有相符 succeeded 工作屬一致性異常：停下並回報維運，不憑 active 狀態把任意新請求當成功，也不再次發起。

## 業務邊界

文件 status 在 queued／processing／failed 期間仍 draft，只有成功交易才 active。別的簽署人不能因工作受理就看見未成立的指派。

受理及所有草稿寫入皆由同一 document 鎖串行化；唯一 active_document_id 是額外資料庫防線。工人通行權是特定 job+lease，不是可由 client 傳入的 bypass flag。

總人數由 server 的輸入規則決定；不以 100 或 6,000 人切換模式／截斷名單。員編查詢 500 一批、既有寫入 250 一批，全部正式寫入同一交易。仍保留既有 HTTP bytes／欄位形狀限制，超出回明確 413／400，不能截斷。

## 保留與 migration

- 非終態工作永不按一般保留期限清除。deadline 到期必須先安全判定失敗，不能直接刪除。
- 終態完成 30 天後，由既有 maintenance 分批清空 input_json、document_version_json、issues_json；保留 ID、關聯、request key/hash、計數、分類錯誤、時間、狀態，支援重播與稽核。清理不新增 scheduler。
- 完整 input／issues 被清理後回 410；原 key 重播仍返回原摘要。失敗內容無法重試時由建立人重新設定並提交，不假造空名單。
- migration 新增一表、唯一約束與 FK，同步 entity／schema.sql／MysqlModule。不得更動舊文件與證據。down 只允許工作表為空；有資料需拒絕而非 DROP 後遺失受理紀錄。


## 草稿版本完整性補修（2026-11-03）

`document.updated_at` 作為草稿編輯版本時，所有成功的標題／PDF／欄位／名單／期間／選項／草稿簽署人註記／軟刪除都須在同一 document 鎖及交易內單調推進。採 DB `UTC_TIMESTAMP(6)` 與舊值加 1 微秒取較大值；不能僅依賴 ORM save 的 dirty 判斷或自動整秒 CURRENT_TIMESTAMP。即使重新儲存相同值也保守推進，使舊 failed 工作必須重新確認。

對既有 draft 的 save，先以 current read 保存原微秒字串，完成一般欄位 save 後，再用窄 SQL 取 DB 現在、save 後當前值+1µs、save 前原值+1µs 的最大值，抵抗 ORM timestamp 回退；回傳 entity 的 updatedAt 重讀 DB。外部版本比對仍用 raw 微秒字串，不能以 JS Date 當唯一版本。fields 與草稿 note 無文件 save 時直接 touch，updateDraft／softDeleteDraft 在 SQL 自身遞增。

此 touch 是草稿異動的必要窄 SQL 例外，業務欄位仍沿用 save 與既有 audit。新建無舊版；正式核心先驗 job 受理版，再 buildFields，activate 已變為 active 後沿原 save，沒有在 worker 中途自行推進版本。非草稿註記維持不改正式文件或簽署證據。


保留清理的 SELECT SKIP LOCKED 後，UPDATE 也必須只定位已鎖定PK。MySQL對批次 IN UPDATE 可能選掃描計畫而等待未選parent，因此每批100列交易內逐唯一PK窄更新，不能只依賴SELECT端略過鎖。


受理／retry對建立人使用共享鎖current read，直到短交易commit保持帳號有效；正式worker對users也只需共享鎖。兩者與jobs creator FK的共享引用相容，既有另一份草稿可在大型文件正式發起持鎖期間受理。資格／信箱／同步更新需要X鎖，仍等待正式交易完成；若停用先取得X鎖，worker共享current read等待後看見停用並整份拒絕。未放寬正式授權，未更動其他users寫入流程鎖模式。
