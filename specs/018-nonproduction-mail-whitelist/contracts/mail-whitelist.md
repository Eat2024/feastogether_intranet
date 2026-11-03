# Mail Whitelist Contract

> 2026-11-03：員工名單解析、發起信箱與員編／直接部門白名單的即時人資來源，由 [Spec 023](../../023-portal-user-email/spec.md) 改為 Portal 匯入的本機 users。部門樹及登入來源不變；缺信箱可簽署、文件固定收件信箱、完整 Email 規則與正式環境 bypass 語意不變。以下歷史設計及驗證紀錄保留，來源切換的驗收以 023 為準。

**狀態**：簡化政策程式與測試已同步；其他寄送契約沿用，未新增 HTTP API 路徑或管理介面。驗證結果見 quickstart.md。

## 環境

| NODE_ENV | 行為 |
|---|---|
| production | 直接沿既有 adapter，白名單 repository／僅供白名單的 HR 呼叫次數為 0 |
| development、test、staging | 每次公開寄送呼叫執行政策，fake 亦同 |
| 未填、空白、未知、不同大小寫 | 啟動驗證失敗；若寄送入口被單獨建立，也拒絕實際傳輸 |

使用合法精確值，不能使用 isDeployedEnvironment 或「不是 staging 就 production」邏輯。HTTP 與 worker 使用相同配置，無 caller 覆寫或 bypass flag。

## 公開寄信介面

保留 INVITATION_MAIL_SENDER 作唯一對外 provider，包覆內部 SMTP／fake adapter。`send`、`sendOtp` 的 request 欄位與 Promise<void> 不變：

- 正常 resolve：允許收件人，adapter 沿原語意完成。
- `MailRecipientBlockedError`：未交 adapter，reasonCode=`MAIL_RECIPIENT_NOT_WHITELISTED`，retryable=false；不附收件人、規則值或憑證。
- `MailWhitelistCheckFailedError`：未交 adapter，reasonCode=`MAIL_WHITELIST_CHECK_FAILED`，retryable=true；只保留安全分類供運維，不透傳 HR body／SQL／API key。
- 已進 adapter 的 SMTP error：保持原值與既有分類；不得把 SMTP DATA 後斷線誤標成 policy check failure。

Error class 必須可被 worker／OTP 明確辨識，不使用字串 message 判斷、不偽造 SMTP responseCode。

## 群發

`sendInternalGroup()` 回傳每個正規化、去重後輸入信箱的結果。現有 accepted／rejected／unknown 與 retryable 原規則不變，新增：

| status | reasonCode | retryable | 已交 adapter？ |
|---|---|---|---|
| blocked | MAIL_RECIPIENT_NOT_WHITELISTED | false | 否 |
| check-failed | MAIL_WHITELIST_CHECK_FAILED | true | 否 |

1. 寄送檢查前先驗證實際地址是單一合法信箱，不能從顯示名稱、逗號列表或 header 注入額外收件人。
2. production 走既有 adapter；其他合法環境讀最新規則、解析可信資料。
3. 明確不允許者保留 blocked；允許子集合才傳進底層 recipientEmails，To／CC／BCC／envelope 均不能另加被阻擋地址。
4. 無允許者不呼叫 adapter。必要 DB／HR 查詢在 SMTP 前失敗，整次尚未寄送檢查回 check-failed，不用部分名單寄送。
5. adapter 只需對允許子集合回結果，外層合併被阻擋結果，逐地址恰一筆；缺漏／重複 adapter 結果仍依現有 mismatch／unknown 保守處理。
6. 白名單更新不能讓先前 unknown 轉為可盲目重送。

## 可信收件人政策

> 已由 [Spec 021](../../021-external-mail-whitelist/spec.md) 修訂：增加收件信箱規則，以正規化後的完整地址精確比對；收件人全數命中時不查 org_chart 與 getStaffEmails，其餘地址沿用下列解析並取聯集。

- 規則讀取方式為單次呼叫的有效 `(type,value)` 集合；部門完整代碼／員編完整字串 OR 命中。
- org_chart 只選精確白名單節點的直接員工，額外 employee 值獨立加入；不遞迴放行子節點。
- getStaffEmails 每批最多 100，將候選員編的可信有效信箱與實際地址相交，直接回傳允許集合。地址與員編的映射必須來自可信 HR 回應，不能只相信 sender 傳來的員編聲稱。
- 不呼叫 staff_lookup／lookupMailEligibleStaff／lookupEligibleStaff 做白名單判定；不逐人確認在職狀態，也不再次查詢 department_id。部門規則依本次 org_chart，額外員編依有效規則，無本地 User 依賴。
- 明確無候選、無可信有效信箱或實際地址不在允許集合為 blocked；必要 DB／組織樹／信箱來源連線或格式錯誤為 check-failed。不能靠 User 已登入／部門名稱／文件快照／網域或寄件人身分放行。
- 同一次呼叫只讀一次規則、最多一次組織樹，信箱依候選員編每 100 人分批；逐人資格查詢數為 0。規則及可信信箱仍命中時，不另外以離職／停用狀態否決。
- 同一可信信箱可對應多個白名單候選員編，允許集合按信箱去重，不因此回報 check-failed。
- 單次查詢結果可共用，不跨呼叫快取；production 不跑此解析。

## Worker 結果映射

`external-invitation.processor.ts` 的原邀請、內部群發與 reminder 三條路徑都必須處理：

| 政策／傳輸 | log.result | errorCode | 後續 |
|---|---|---|---|
| blocked | skipped | MAIL_RECIPIENT_NOT_WHITELISTED | completedAt 設定、清 processing／lease／nextAttemptAt，不重試 |
| check-failed | failed | MAIL_WHITELIST_CHECK_FAILED | 明確未寄，最多 3 次 attempt（含首次）；30s、60s 退避，耗盡後 nextAttemptAt=null |
| accepted／成功 | delivered | 原契約 | 沿既有成功紀錄 |
| rejected／unknown | 原契約 | 原契約 | 沿既有重試／不明結果防重寄 |

- 政策跳過／失敗不寫 invitationDeliveredAt 或 delivered audit，不改 signer 簽署狀態，不保留非必要明文／暫存邀請憑證。
- NotificationRepository 的 recovery 查詢排除已 skipped，check-failed 達 3 次也不能因 nextAttemptAt=NULL 被重新撈出；不得改成無限 recovery。
- 初始外部 invitation 的既有 SMTP finishFailed 沒有同樣上限；新 3 次限制明確只用在政策 check-failed，其他 SMTP 行為不在此規格順手更動。
- 租約／世代驗證保留，舊 worker 結果不能覆寫新邀請世代。群發逐人紀錄與批次總數需收斂，不殘留 processing。
- 新增規則不復活 skipped 工作；只能沿既有人工重新觸發流程建立後續工作。

## OTP 與 HTTP

既有 `/api/external-signature-otps` 路徑不變，Origin／邀請／速率驗證全部保留。

- `OtpIssue` 新增 `{ status: 'recipient-blocked' }`；policy blocked catch 釋放本次冷卻 claim，不寫新 code、不增成功寄送 hourly、不寫 external_otp.sent。
- 已存在的舊有效 OTP 依現有寄送失敗語意保留，不能因新信未寄任意清除；本次未寄的新碼不可驗證。
- check-failed 對外沿 delivery-failed；內部以穩定原因區分，不輸出原始來源內容。
- recipient-blocked：HTTP 403，以既有安全頁面風格顯示「此環境未開放寄送至此收件人，請聯絡系統管理員」，不揭露命中部門、完整白名單或員編，不顯示已寄送及新驗證碼輸入頁。
- check-failed／真正寄送失敗：503 原失敗頁。sent／cooldown／hourly-limit 的 200／429 原規則不變。
- 失敗不計入成功寄信額度，但既有 endpoint 節流、OriginGuard、驗證次數與 TTL 不得取消；不新增 OTP 自動重試。

## UI 與維護

通知列表沿既有 skipped 狀態顯示「非正式環境白名單未允許寄送」；check-failed 顯示「寄送白名單檢查失敗」。reasonCode 必須能與實際 SMTP 失敗區分，但不把規則值或完整信箱當 log。

沒有白名單 CRUD API。維護人以受控 DB 程序操作七欄表，新增／撤銷提交後下一次檢查生效，不使用環境變數重啟作生效機制。
