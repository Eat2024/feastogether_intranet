# 寄信白名單影響盤點

**狀態**：盤點已納入 plan；未修改程式或 DB。

## 可信來源查核

2026-11-02 以既有 Portal `/api/v1/hr/org_chart` 唯讀查詢，僅輸出部門代碼與名稱，未保存員工名單。確認 `1029030000` 節點沒有下層部門，其上層為 `1029000000` IT策略本部；同層包含 `1029090000` 系統開發二部及 `1029010000` 資訊安全部。使用者選定這三部門加員編 `09005001`，不是整個本部。

## 共用寄送邊界

| 現有檔案 | 現況與需要修改 |
|---|---|
| `server/src/infrastructure/mail/mail.module.ts` | 目前只依 driver 建立 sender；規劃需將共用寄送政策與 DB／HR 依賴接入，HTTP／worker 都使用同一邊界 |
| `invitation-mail-sender.port.ts` | send／sendOtp 回傳 void，只有 recipientEmail；不能把政策跳過當 void 成功，需設計明確 blocked／check-failed 結果或專屬錯誤 |
| `smtp-invitation-mail-sender.service.ts` | 單人 deliver 與 sendInternalGroup 有兩個 transporter.sendMail 呼叫點，都要防護；實際 envelope 最終確認，不只在 controller 檢查 |
| `fake-invitation-mail-sender.service.ts` | 使用相同政策語意的合成測試，不能 production 以外的 fake 無條件假成功掩蓋錯誤 |
| `server/src/worker/esign/external-invitation.processor.ts` | invitation／reminder／internal group 需處理政策跳過，blocked 不是 SMTP unknown，也不進一般寄送失敗重試；批次租約與總數正確收尾 |
| `server/src/features/esign/services/external-access.service.ts`、`external-otp.service.ts` | HTTP OTP 路徑亦檢查，不能因 sender 沒寄但回成功而存有效 OTP、寫 external_otp.sent 或回已寄送 |
| 通知結果 DTO／前端 notificationLabels／errorCodes | 顯示既有 skipped 狀態搭配穩定原因，與暫時來源故障區分，不公開白名單全文 |

應在 plan 選擇最小的單一政策實作，所有寄送入口都經過它；不重複在各 controller 散落判斷，也不建泛用 provider／policy framework。

## 環境與資料

- 沿用 `server/src/config/app.environment.ts` 的四種合法值。只有 production 可略過白名單；不能用 isDeployedEnvironment（staging 也是 deployed）當免檢查條件。
- 現有 UAT compose 的 server／worker 使用 staging；client 的 production build 不影響 server 寄送判斷。
- 不新增 bypass env、不新增 cron、不增加每筆規則的環境欄位。
- production 不為白名單查詢 DB／HR；若原寄送本來需要 HR 解析信箱，原需求仍保留，不能混淆兩種責任。

### 已確認新增表 `mail_recipient_whitelist`

| 欄位 | 已確認定義 | 說明 |
|---|---|---|
| id | bigint PK | 規則識別 |
| type | varchar(20)，限定 department／employee | 規則種類 |
| value | varchar(50) | 完整部門代碼或員編；字串、非空、依 type 驗證，不轉數字 |
| remark | varchar(255) nullable | 維運備註，不用於授權 |
| created_at／updated_at／deleted_at | 沿 AuditableEntity | 有效規則為 deleted_at IS NULL，撤銷採軟刪除 |

- 建議 `(type, value)` 精確比對唯一鍵，包含已軟刪除列；再次加入同一規則恢復原列，不插重複資料。欄位長度、collation、constraint 與索引見 data-model.md。
- 不以白名單 value 外鍵參照本機 users.departmentId；允許對象可能未登入過系統。
- 一般 migration 建表、索引與 constraint，同步 entity／schema.sql／schema tests；四筆種子資料與重跑／回滾程序須清楚定義，不能每次啟動重新 seed 而復活已撤銷項目。
- 使用者只要求白名單表，不新增查詢／增刪管理 API 或頁面。維護程序須可審查且顯示影響筆數，不提交真實人員信箱或憑證。

## 收件人身分核對缺口

目前 sender 只有 Email，不能直接用 User 的名字、部門名稱或寄件人資格推論收件人。既有可信來源：

- `FeastogetherDepartmentService.getOrgChart()`：取得部門樹與員編，必須按白名單精確部門節點取員工；本需求不含 descendants。
- `FeastogetherHrService.getStaffEmails()`：完整員編查可信信箱，最多 100 員編／批，不能超出原限制。
- `FeastogetherHrService.lookupEligibleStaff()`：可核對單一完整員編、目前部門與在職資格。

plan 需選擇適合批次的解析方式並證明身分／信箱一致。可從允許部門與額外員編解析允許信箱集合後與實際收件人交集，不需要新增上游反查 Email API；若上游不足以唯一確認或資料不完整則不放行。不要逐封重建全公司名單或要求全部員工先登入系統；同一寄送檢查可共用解析結果，但不跨寄送快取白名單造成撤銷延遲。

同部門資格是收件人現在的組織歸屬，不是文件建立部門。額外員編規則獨立允許，不要求他也屬於三部門。

## 結果與可觀測性

| 情況 | 行為 |
|---|---|
| 明確白名單未命中 | 不寄，通知 result=skipped，新增穩定原因碼（建議 MAIL_RECIPIENT_NOT_WHITELISTED），不自動重試 |
| 白名單／HR 查詢失敗 | 不寄，與政策阻擋區分的檢查失敗原因；確定未送 SMTP 才走既有有限次失敗策略 |
| 允許且交 SMTP | 維持 accepted／rejected／unknown 與防重寄原規則 |
| 全批阻擋 | 不呼叫 transporter，逐人 skipped，完成批次與租約收尾 |
| OTP 阻擋 | 不回 sent、不留本次可用 OTP、不寫成功寄送稽核；對外錯誤不揭露哪個規則命中或白名單內容 |

現有 esign_notification_logs 的 result 已支援 skipped，原則上不新增通知狀態或新通知表。是否需調整 port 回傳型別、OTP 對外錯誤或既有 reasonCode mapping，見 contracts/mail-whitelist.md。

## 預計驗證

- 三個非 production 環境、production、缺漏／不合法環境的矩陣。
- 部門／員編 OR 命中、精確比對、前導零、非有效員工、非可信信箱、偽造欄位與相同網域未授權。
- 單人、群發、OTP 及 worker 重試各入口；檢查 transporter 參數與 envelope 無未允許地址。
- 名單追加／軟刪除／恢復／重複值、佇列等待期間撤銷、已跳過工作不自動補寄。
- 來源故障不寄、失敗分類正確、混合群發逐地址結果不誤配、unknown 不重寄。
- OTP 失敗無新有效碼／成功稽核，既有節流不被繞過。
- migration up/down/up、種子重跑不復活撤銷項目、schema 對齊；server 單元／整合測試及適用 client/server lint/build。

## 範圍外

不執行 UAT 白名單新增、不寄測試郵件、不修改 Spec 017 PR、不加入任何 email／domain 型白名單、不建立管理介面、排程、跨環境同步或轉寄機制。
