# Phase 0 Research: 寄送邊界與可信收件人

**狀態**：第 3 節已依使用者本次指示修訂，取消逐人資格查詢；其餘決策沿用。簡化程式與測試已同步，歷史與本次驗證結果分列於 quickstart.md。

## 1. 單一具體 sender 保護兩種 driver

- **Decision**：INVITATION_MAIL_SENDER 指向 GuardedInvitationMailSender，包覆 SMTP 或 fake adapter；MailModule 只 export 這個 token。
- **Rationale**：SMTP 的 deliver 與 sendInternalGroup 是兩個實際 sendMail 呼叫點；OTP 走 HTTP，其他通知走 worker。統一在公開入口過濾最不易漏掉。
- **Alternatives considered**：只在 worker／SMTP 單人 deliver 檢查會漏群發或 OTP；在 fake 複製政策會有測試與實際行為漂移；泛用 provider registry 超出需求。
- **Evidence**：mail.module.ts、invitation-mail-sender.port.ts、smtp-invitation-mail-sender.service.ts、fake-invitation-mail-sender.service.ts。

## 2. 七欄表與動態規則

- **Decision**：使用核准的 id／type／value／remark／created_at／updated_at／deleted_at，完整 type,value 唯一鍵，軟刪除後恢復原列。每次公開寄送呼叫讀有效規則一次，不跨呼叫快取。
- **Rationale**：支援無須重啟的增刪，避免同時出現有效與撤銷的同一規則。無需 is_active 或 environment。
- **Alternatives considered**：環境變數需重啟；DB 加 Email 快照會在信箱異動時殘留；管理頁/API 尚無需求。

## 3. 依白名單解析允許信箱（2026-11-02 修訂）

- **Decision**：每次非 production 檢查讀有效規則；有部門規則才查 org_chart，僅收精確節點的直接 employees，與額外 employee 規則聯集去重。每批最多 100 員編查 staff_emails，與本次實際地址取交集，直接產生允許集合。
- **Rationale**：使用者要求測試環境以避免寄給白名單外地址為目的，不承擔逐人再次確認在職資格及部門的成本。部門以本次組織樹為準，額外員編由白名單維護，不改登入或簽署資格驗證。
- **已撤回方案**：原先對匹配員工逐人呼叫 lookupEligibleStaff／lookupMailEligibleStaff 會形成 N+1；最多 4 個並行只有限流效果。此方案已被使用者本次指示取代，不再是實作要求。
- **細節**：信箱沿既有 trim＋lowercase 正規化，不解析顯示名稱為多地址、不擴張 plus alias 或網域規則。多個候選員編對應同一可信信箱時直接去重，不額外驗證唯一員工身分。無候選或無可信有效信箱為 blocked；必要 DB／組織樹／信箱查詢的連線或格式錯誤為 check-failed。
- **效能**：同次群發共用規則及解析結果；staff_emails 每批最多 100、依序查詢。只有員編規則時不查組織樹；空規則不查 HR；逐人資格查詢數必須為 0。不新增快取、排程、環境變數或上游 API。來源中途故障仍整次不寄，不使用部分解析結果放行。
- **Limits**：本政策不額外偵測停用／離職或組織樹更新延遲。實際地址仍在規則解析的允許集合內即可寄送；若需停止，撤銷規則或維護上游名單／信箱。規則提交後下次開始的檢查生效，已交 SMTP 無法追回。

## 4. 區分政策與投遞結果

- **Decision**：send／sendOtp 保留 Promise<void>，只在正常 adapter 成功時 resolve；未交 adapter 前以 MailRecipientBlockedError 或 MailWhitelistCheckFailedError 表達政策結果。group 擴充 blocked／check-failed union，合併回每個原收件地址；不把政策失敗 throw 到 worker 的通用 unknown 分支。
- **Rationale**：目前單人 resolve 就 finishDelivered，OTP resolve 就存碼；把 skip 當成功會造成實際未寄卻記送達。群發既有結果非 accepted/rejected 會被記 unknown，必須同步改 consumer。
- **Alternatives considered**：全面改單人回傳 union 容易被現有呼叫者忽略；偽造 SMTP responseCode 會混淆政策與傳輸來源。

## 5. 檢查失敗有限次重試

- **Decision**：blocked→skipped、不重試；check-failed→failed／MAIL_WHITELIST_CHECK_FAILED，三條 worker 路徑最多 3 次寄送 attempt（含首次，已有 attemptCount 繼續計），30 秒、60 秒退避；到上限 nextAttemptAt=null，recovery SQL 同樣不重新撈回。每次重試重讀最新白名單。
- **Rationale**：內部群發／催簽目前已有 3 次上限，但原始外部 invitation 的 finishFailed 與 recovery 沒有相同上限；僅寫「沿既有限次策略」不足。此變更只針對新政策 check-failed，既有 SMTP 行為不在本次順手重寫。
- **Evidence**：worker/esign/external-invitation.processor.ts 的 process、processInternalBatch、processReminder、finishFailed；esign/repositories/notification.repository.ts 的可恢復工作查詢。
- **Alternatives considered**：無限重試會在資料來源故障時持續佔用工作；blocked 重試會在規則後續新增時意外自動補寄。

## 6. OTP 與 fake

- **Decision**：OtpIssue 增加 recipient-blocked；check-failed 對外仍走 delivery-failed 503，一般安全運維紀錄記分開原因。blocked 回 403 的非正式環境禁止寄送頁，不回 sent 或 429 輸入碼頁；舊有效 OTP 保持既有失敗語意，新未寄碼不可保存。冷卻 claim 釋放、不增加成功寄送 hourly 計數，既有入口節流與驗證限制不變。
- **Rationale**：ExternalOtpService 現行成功才保存新碼，失敗釋放冷卻；ExternalAccessService 只有 sent 才寫 external_otp.sent，可沿用。Controller 現在只特判 delivery-failed，其餘非 sent 都可能走 429，需要完整分支。
- **Fake**：fixture 可持有底層 fake observer 觀測 deliveries，但應經 guarded sender 寄送。正式 E2E 不全域 override 公開 token 成無條件 fake；單獨測 adapter 與格式的單元測試可直接使用底層類別，不能當政策覆蓋證據。

## 7. 環境與初始資料

- **Decision**：validateAppEnvironment 的 NODE_ENV 改明確必填並允許四種合法精確值；取消未設定預設 development。production 在白名單查詢前返回原 adapter，其他合法值走政策，invalid 必須停止。
- **Rationale**：使用者明確要求未設定／不合法不得放行；目前 optionalString 預設 development 不能辨識漏設定。需同步 .env.example、測試 fixtures 與既有啟動腳本的環境確認，不新增開關。
- **Seed**：四筆初始值在受控一次性操作中插入缺少列，存在列不更改，尤其不能恢復 deleted_at。明確恢復是維護人的另一次操作，不是啟動或 migration 自動行為。

## 審查結果

原版本曾以唯讀研究交叉檢查 sender／worker／OTP／HR 並補上 recovery 上限。本次第 3 節的簡化決策已同步至 spec、plan 與 contracts；其後已同步程式並重驗，結果另記於 quickstart.md；原雙軸審查紀錄仍屬修訂前版本。
