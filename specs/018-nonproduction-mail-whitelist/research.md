# Phase 0 Research: 寄送邊界與可信收件人

**狀態**：以下保留規劃階段研究與決策，無待釐清需求；當時只讀程式與先前 Portal 部門結果。後續實作與隔離驗證結果見 quickstart.md，未呼叫真實 SMTP。

## 1. 單一具體 sender 保護兩種 driver

- **Decision**：INVITATION_MAIL_SENDER 指向 GuardedInvitationMailSender，包覆 SMTP 或 fake adapter；MailModule 只 export 這個 token。
- **Rationale**：SMTP 的 deliver 與 sendInternalGroup 是兩個實際 sendMail 呼叫點；OTP 走 HTTP，其他通知走 worker。統一在公開入口過濾最不易漏掉。
- **Alternatives considered**：只在 worker／SMTP 單人 deliver 檢查會漏群發或 OTP；在 fake 複製政策會有測試與實際行為漂移；泛用 provider registry 超出需求。
- **Evidence**：mail.module.ts、invitation-mail-sender.port.ts、smtp-invitation-mail-sender.service.ts、fake-invitation-mail-sender.service.ts。

## 2. 七欄表與動態規則

- **Decision**：使用核准的 id／type／value／remark／created_at／updated_at／deleted_at，完整 type,value 唯一鍵，軟刪除後恢復原列。每次公開寄送呼叫讀有效規則一次，不跨呼叫快取。
- **Rationale**：支援無須重啟的增刪，避免同時出現有效與撤銷的同一規則。無需 is_active 或 environment。
- **Alternatives considered**：環境變數需重啟；DB 加 Email 快照會在信箱異動時殘留；管理頁/API 尚無需求。

## 3. 信箱集合解析，不能只核對員編聲稱

- **Decision**：每次非 production 檢查：讀有效規則；有部門規則才查 org_chart，走訪尋找精確節點但只收其直接 employees，不合併 children；與額外 employee 規則合併候選員編。依每批最多 100 員編呼叫 staff_emails，找與本次實際收件地址相同的候選，再用 lookupEligibleStaff 精確核對這些候選的有效資格、當前部門及命中規則，最後確認地址仍來自該完整員編的可信回應。
- **Rationale**：sender 只有地址，沒有可信 Email→員工 API；先解析候選信箱可避免對每個部門所有人都逐一查 eligibility。真正準備放行的員工仍需核對目前資格與部門，不把 org chart 舊位置或 staff_emails 的稀疏 map 視為在職證據。
- **Alternatives considered**：只看本機 User 漏掉未登入員工；只看 email domain、caller userId 或文件部門不代表實際收件人。每封信先抓全公司信箱造成過度查詢。
- **細節**：信箱沿既有 trim＋lowercase 正規化，但不解析顯示名稱為多地址，也不擴張 plus alias 或網域規則。候選去重；相同實際地址若無法唯一核對可信對象，不寄送並列檢查失敗。明確查得無員工、非有效資格、轉出允許部門且無員編例外，為 blocked；上游網路／格式／多筆歧義為 check-failed，不能把所有 lookupEligibleStaff 的 AppException 都當同一種失敗。必要時在既有 HR service 補內部 typed lookup 結果，不改既有登入對外錯誤契約。
- **效能**：同一次群發共享規則／候選／來源結果；staff_emails 批次序列，匹配候選資格核對最多 4 個並行、每員編只核對一次，沿既有 timeout，不新增 env 或跨呼叫 cache。空規則直接 blocked，不查 HR。必要來源中途故障時此次尚未交 SMTP 的檢查整批失敗，禁止部分解析結果誤放行。
- **Limits**：上游資料是查詢時點的可信狀態，不是 DB／HR／SMTP 分散式交易；規則撤銷適用下次開始的檢查，已交 SMTP 無法追回。

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

使用一個唯讀研究代理交叉檢查 sender／worker／OTP／HR，已補上原 invitation recovery 無次數上限的缺口。全部決策已納入 plan 與 contracts；無未解決需求或額外產品範圍。
