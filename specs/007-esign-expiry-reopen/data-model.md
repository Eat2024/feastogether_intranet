# Data Model: 已到期與補簽

## 1. 文件（沿用 esign_documents）

| 欄位／投影 | 語意與規則 |
| --- | --- |
| status | draft / active / expired / finalizing / completed / stopped；CHECK 增加 expired |
| sign_start_at | 原開始時間，不因補簽變更 |
| sign_end_at | 目前有效截止時間；補簽鎖內更新，嚴格遞增 |
| signing_payload_json.period.endAt | 原始截止時間，發起後不可改寫 |
| signing_payload_json / signing_payload_sha256 | 原始固定證據，不因補簽重建 |
| stopped_at / stop_reason | 人工停止維持既有語意；到期不填寫 |
| originalSignEndAt | DTO 投影自固定 payload；草稿為 null |
| isReopened | 已發起且有效期限不同於原期限；草稿為 false |

無新增欄位。補簽必須確認完整且 hash 正確的固定快照與合法期限，缺漏時沿用完整性失敗，不以目前期限補造原始期限。

`expectedSignEndAt` 是 request precondition，不儲存；使用 API 回傳的 UTC ISO 毫秒值，轉成瞬間比對，不比對不同時區的字面字串。新輸入限制最多毫秒精度，與現行 JavaScript Date 一致。

## 2. 有效狀態與轉換

| persisted 狀態／操作 | 結果 |
| --- | --- |
| active，仍 pending，now >= signEndAt | 讀取投影 expired；worker 落盤 expired |
| expired 或邏輯到期的 active，建立人補簽 | active、新 signEndAt、新邀請、reopened event |
| active／expired／finalizing，建立人停止 | stopped；禁止補簽 |
| 最後一位簽署成功 | 沿用 finalizing，個人副本完成後 completed |
| completed／stopped／finalizing，時間經過 | 不轉 expired，不允許補簽 |

同一讀取使用同一 now；先算有效狀態再依 status 篩選。pending=0 不因期限到達轉 expired。查詢不追加事件或更新 DB。已簽者的讀取與副本產製不因 expired 被拒絕；未簽者仍不得在到期期間讀取簽署來源或提交。

## 3. 稽核（沿用 esign_audit_events）

- `document.expired`：actorUserId 空值；occurredAt 為實際寫入時間；metadata `{ status: 'expired', expiredAt: 舊有效期限 }`，明確區分截止與處理時間。
- `document.reopened`：actorUserId=建立人；occurredAt=補簽生效時間；metadata `{ status: 'active', previousSignEndAt, signEndAt, reason }`。
- 既有 stopped_by_deadline 事件保留，不改寫；新流程不再產生此事件。
- 每次 persisted active → expired 最多一筆事件。若 worker 未處理，補簽交易先追加 expired 再 reopened；失敗整筆回滾。
- 不增加輪次欄位：歷程依追加順序 ID 升序串接前後期限；以事件 ID 區別每次補簽。
- 擴充 metadata 型別與白名單，只接受合法日期；原因 trim 後 1–500 個 Unicode code points，保存不得因原本 slice 的 UTF-16 截斷而遺失字元。
- 建立人歷程回傳操作者 ID、前後期限及原因；簽署人只看到事件類型、時間與必要的新期限，原因與操作者欄位省略。不得直接回傳 metadataJson。

## 4. 邀請與舊通知

只更新 pending email signer 的 invitationTokenSha256、invitationTokenCiphertext、invitationExpiresAt，並清除上一輪 invitationDeliveredAt。不變更姓名、Email、signed 狀態或完成副本欄位。

新密文可由建立人在有效補簽期間重複讀取，不因 GET 被消耗；簽署、到期及停止後依既有撤銷機制失效／清除。舊 cookie 使用舊 token，因此輪替 digest 後不能取得新資格。token 不寫入 audit。

既有尚未完成的 invitation logs 在補簽鎖內標記 failed／INVITATION_SUPERSEDED，撤銷 lease；已 delivered 紀錄保留歷史。scanner/claim 排除該錯誤碼，worker 回寫需驗證 claim 與當前憑證同一世代。此補簽輪不產生新通知 log；DTO invitationDelivery 回 null，不能把舊 delivered 誤當新邀請已寄送。

## 5. 交易邊界

補簽：鎖 document → 檢查建立人 → 鎖既有通知 logs（固定 ID 順序）→ 鎖 signers（固定順序）→ 取 now、比對 expectedSignEndAt、到期／pending／新期限及 payload → 必要時追加到期事件 → 退休舊通知、更新新邀請與有效期限 → 追加 reopened → commit。

所有有交集的流程維持 document 在最前，碰到通知及 signer 時統一 notification log → signer；無通知者直接 document → signer。這與既有通知 worker 的鎖順序相容。audit 在同交易復用文件鎖。失敗不得留下部分狀態。

簽署原有鎖內資格檢查保留；簽署時間與最後期限檢查使用一致的權威時間，昂貴檔案驗證後、建立簽署證據前重新檢查，避免檢查時未到期但證據時間已逾期。已成功請求的合法重送返回既有證據不算新增簽署。

## 6. Migration 與回滾

up：僅重建 chk_esign_documents_status 納入 expired；保留 sign_end_at 索引與其他 CHECK。同步 entity／schema.sql／schema-metadata 測試。

不將任何 stopped 轉換為 expired，不改 payload、不補造事件。down 先檢查 expired 或 document.reopened 歷史，任一存在即拒絕；不得為讓回滾成功而永久停止文件或刪稽核。空白／無新功能資料測試庫驗證 up → down → up。

部署需停用舊 expiry worker，再協調 migration、HTTP 與 worker 版本切換；新功能生效後優先向前修正，避免舊版本永久停止已補簽文件。
