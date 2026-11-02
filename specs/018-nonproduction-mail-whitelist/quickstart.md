# Quickstart: 非 production 白名單驗證

此為未來實作後的指南，並非已執行的測試報告。本輪不得藉此指令對 UAT 寫入或寄送真實郵件。

## 前置條件

- pnpm workspace、既有 MySQL／Redis；測試 DB 只能使用 feastogether_intranet_test 前綴，不能用 UAT。
- 依 server/.env.example 設定明確合法 NODE_ENV 與既有 driver；不得印出或提交密碼／API key。
- HR org_chart／staff_emails／完整員編查詢使用合成 stub，SMTP transporter 使用攔截 spy；不使用真實員工地址或真的 SMTP。
- 測試具體 guarded sender，底層 fake observer 只記允許地址。不要將公開 token 全域 override 成繞過政策的 fake，也不要將測試 NODE_ENV 改 production 求通過。
- 現有本機 E2E 曾因 MySQL 驗證失敗中止；先恢復隔離測試環境，不繞過 DB 保護。

## Schema 與維護演練

1. 執行新 migration，核對七欄、唯一鍵與 CHECK；非法 type、空白、長度超限、重複 type/value 被拒絕。
2. 在隔離資料套四筆初始規則：部門 1029030000／1029090000／1029010000，員工 09005001；額外補合成 worker 測試規則與 HR fixture。
3. 驗證重跑 seed 不重複、不恢復已撤銷列；明確 restore 會恢復原 id，前導零保持。
4. up/down/up 與 schema.sql 對齊；不在應用啟動自動寫 seed。

## 環境矩陣

- development／test／staging：允許者才到 adapter，fake 也套政策。
- production：在白名單 repository／政策 HR spy 設為 throw 的情境仍不呼叫它們，adapter 正常；SMTP 仍為 mock，不能真的寄送。
- 未設定、空白、未知、Production：啟動／入口拒絕，不觸發 adapter。
- 檢查 docker-compose.uat.yml 的 server／worker staging 與 client production build 分開，不由 client 設定影響寄送。

## 身分與單人寄送

使用三個允許部門、部門外允許員編及一般部門員工合成資料：

1. 部門命中或額外員編命中可寄，兩者皆不命中 blocked。
2. 額外員編前導零保留；同名部門、上層／子部門、同公司網域、caller 偽造身分均不放行。
3. 員工轉出且不在員編規則時 blocked；離職／停用不得因舊 email mapping 通過。
4. 不要求本機 User 存在；外部 email 若是允許員工可信信箱可過，其他外部信箱不過。
5. 必要 DB／HR 故障或歧義為 check-failed；沒有正常結果的地址不能從部分解析名單放行。

## 群發與 worker

- 混合三個允許、兩個阻擋地址：adapter 收到精確允許集合，To／CC／BCC／envelope 不含被阻擋者；回傳完整逐地址結果。
- 全阻擋：adapter 呼叫 0 次，全部 skipped；成功紀錄與 signer.invitationDeliveredAt 不變，無 pending／processing 殘留。
- 群發必要來源失敗：此次 SMTP 呼叫 0 次；check-failed 不被 generic catch 轉 unknown。
- 邀請、群發、催簽的 blocked 都無重試；check-failed 最多 3 次、30s／60s 退避，recovery 不再撈耗盡工作。
- 真正 SMTP unknown 沿原策略，不因白名單追加自動重送；重新寄送仍重查白名單。
- 撤銷規則後處理之前排入的工作被擋；新增規則不自動復活 skipped，人工新觸發才評估。

## OTP

- blocked 回 403 安全頁；沒有 sent、沒有 external_otp.sent、沒有本次新 code、不增加成功次數、不輸出完整白名單。
- 原有有效 OTP 在本次寄送失敗後依原語意保留，新增未寄碼不能驗證。
- check-failed／真正寄送失敗回 503；允許寄出可驗證，TTL／次數／冷卻原規則不變。
- endpoint 節流、Origin、邀請資格仍作用，錯誤不能進 429 新碼輸入流程或顯示寄送成功。

## 實作後指令

```bash
pnpm -C server test --runInBand
pnpm -C server test:schema
pnpm -C server test:e2e
pnpm -C server test:e2e:security
pnpm lint
pnpm build
```

先跑本次相關 sender／policy／worker／OTP 測試，通過後完成相應整體檢查；新 E2E 必須加入現有 regex 收集配置。新檔名與具體任務於 tasks 定義，不能宣稱尚不存在的測試已通過。

## 非 production 切換

1. 停止所有舊 worker 與可能寄 OTP 的 server 寄送入口，避免新舊混跑。
2. 備份及套 schema、一次性初始資料，唯讀確認四個有效 key；維護異動保留受控紀錄但不提交 repo。
3. 同步部署政策 sender、worker 結果處理及 OTP 分支；先用合成／受控測試驗收再開放。
4. 回滾前先停寄送，不能直接恢復不查白名單的舊版本對外寄信。保留 DB 修復，不以刪表或假 production 繞過。
5. 交付記錄實際命令、通過／失敗與原因、各環境影響；此文件不是操作授權或通過報告。
