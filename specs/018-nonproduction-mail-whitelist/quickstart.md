# Quickstart: 非 production 白名單驗證

簡化政策的程式與測試已同步；本文件分別記錄修訂前與本次驗證證據。不得藉此指令對 UAT 寫入或寄送真實郵件。

## 前置條件

- pnpm workspace、既有 MySQL／Redis；測試 DB 只能使用 feastogether_intranet_test 前綴，不能用 UAT。
- 依 server/.env.example 設定明確合法 NODE_ENV 與既有 driver；不得印出或提交密碼／API key。
- HR org_chart／staff_emails 使用合成 stub，SMTP transporter 使用攔截 spy；白名單檢查中的逐人員工資格查詢應設為不可呼叫並確認呼叫數為 0，不使用真實員工地址或真的 SMTP。
- 測試具體 guarded sender，底層 fake observer 只記允許地址。不要將公開 token 全域 override 成繞過政策的 fake，也不要將測試 NODE_ENV 改 production 求通過。
- 現有本機 MySQL 憑證驗證失敗，實作驗證改用一次性本機 MySQL 8.4 容器與獨立 Redis；保留測試 DB 前綴及 Redis DB 非 0 保護。

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
3. 本次組織樹不再含該部門員工、且沒有額外員編規則時 blocked；仍命中額外員編且取得可信信箱時可寄。僅在逐人資格來源設定離職／停用或不同部門，不影響本政策，因該來源根本不應被呼叫。
4. 不要求本機 User 存在；外部 email 若是允許員工可信信箱可過，其他外部信箱不過。
5. 必要 DB／HR 連線或格式錯誤為 check-failed；沒有正常結果的地址不能從部分解析名單放行。

## 查詢成本與簡化驗收

- 將 staff_lookup／lookupMailEligibleStaff／lookupEligibleStaff 設為呼叫即失敗；邀請、群發、催簽及 OTP 的白名單檢查仍可正常判定，且三者呼叫數為 0。既有登入等業務呼叫另行觀察，不計入白名單政策。
- 空規則：一次規則查詢，HR 呼叫 0 次；只有員編規則：不查組織樹，信箱每批最多 100 人。
- 有部門規則、去重候選 300 人、本次收件 50 人：一次規則查詢、一次組織樹、三次信箱查詢；不得再出現 50 次資格查詢。
- 候選 101 人時，信箱查詢批次為 100＋1；每次寄送重新讀取規則，不以跨呼叫快取降低測試次數。
- 移除舊測試中「逐人資格查詢最多 4 並行」與「以額外資格查詢拒絕離職／轉部門」的預期，改驗證上述零逐人查詢與組織樹／規則判定。

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

先跑本次相關 sender／policy／worker／OTP 測試，通過後完成相應整體檢查；新 E2E 必須加入現有 regex 收集配置。本功能以本機 tickets 追蹤具體驗收，不能宣稱尚不存在的測試已通過。

## 非 production 切換

1. 停止所有舊 worker 與可能寄 OTP 的 server 寄送入口，避免新舊混跑。
2. 備份及套 schema、一次性初始資料，唯讀確認四個有效 key；維護異動保留受控紀錄但不提交 repo。
3. 同步部署政策 sender、worker 結果處理及 OTP 分支；先用合成／受控測試驗收再開放。
4. 回滾前先停寄送，不能直接恢復不查白名單的舊版本對外寄信。保留 DB 修復，不以刪表或假 production 繞過。
5. 交付記錄實際命令、通過／失敗與原因、各環境影響；此文件不是操作授權或通過報告。

## 測試配置與既有案例

既有寄送 E2E 使用每個案例明確登錄的有限合成人資名單、真實白名單表與政策，並由 guarded sender 包覆 fake observer。名單只於測試安排階段建立，不從寄送輸入、文件快照或網域自動放行。真實 worker 也共用該有限名單。原生 MailModule 的 HTTP／worker 組裝另由 mail-whitelist-runtime 驗證，不覆寫公開 sender 或政策。

白名單專用 suites 為 mail-whitelist-schema、mail-whitelist-recovery、mail-whitelist-worker、mail-whitelist-otp、mail-whitelist-runtime；Jest 收集配置包含對應案例。SMTP 透過記憶體 transporter 檢查 envelope／MIME，沒有真實寄信。

既有兩個跨台北午夜案例在移動測試時鐘後重新核發測試 session，保留正式 session TTL 與 auth guard；基線曾因此出現 401。6000 人容量案例保留，基線完整 E2E 約 161 秒，需等待 worker 完成逐批紀錄。

## 2026-11-02 原版本實作驗證紀錄（簡化修訂前）

以下保留修訂前歷史證據；本次零逐人資格查詢的驗證另列於後續章節。

- TDD：原核心寄送案例改經真實白名單後，未安排合成名單時 17 項失敗（403），加入明確 fixture 後 25 項核心案例全數通過，不能將 fake 成功當作送達。
- 原生環境矩陣：AppModule／WorkerModule × development／test／staging／production，共 8 項通過；暫時還原成舊未保護 adapter 時 8 項全數失敗，實驗後已還原。
- `pnpm -C server test:schema`：3 suites／14 tests 通過。
- `pnpm -C server test:e2e:security`：13 suites／73 tests 通過。
- `pnpm -C server test --runInBand`：108 suites／1,006 tests 通過；`pnpm lint` 通過（既有 warnings、0 errors）；`pnpm -C server build` 通過。
- `pnpm -C server test:e2e`：32 suites／345 tests 通過，162.123 秒，包含 6000 人完整發起與群發。整合分支 `pnpm build` 前後端通過；正式 Standards／Spec review 各 0 項發現，範圍為 `fb3c4ea...8546772`。
- 未執行 UAT／production migration、seed、部署或真實 HR／SMTP 呼叫。正式切換仍須依維護程序操作。

## 2026-11-02 簡化政策實作驗證紀錄

- `allowedRecipients()` 現在直接回傳批次解析的可信收件信箱；移除 `filterEligibleRecipients()`、`isEligibleEmployee()` 與無其他用途的 `lookupMailEligibleStaff()`。登入等既有 `lookupEligibleStaff()` 保留。
- 白名單單元測試使用真實 HR service 搭配合成上游，逐人 GET 一旦被呼叫即失敗；驗證組織樹直接員工、額外員編、規則撤銷、空／無效信箱、重複信箱去重與來源故障。
- 候選 101 人的信箱批次為 100＋1；候選 300 人、實際收件 50 人時為一次組織樹及三次信箱查詢，逐人資格查詢 0 次。來源故障仍不回傳先前批次已解析的部分允許集合。
- 原生 HTTP／worker 四環境矩陣與 OTP 測試移除可用的逐人資格替身，明確斷言 GET 呼叫 0 次；worker 的逐人查詢替身也設為呼叫即失敗。
- `pnpm -C server test --runInBand`：108 suites／1,003 tests 通過；最後測試型別清理後重跑白名單政策 10 項通過。原寄信資格專用案例移除，登入離職拒絕案例保留。
- `pnpm -C server test:e2e`：32 suites／345 tests 通過，161.151 秒，包含 6,000 人容量案例。
- `pnpm -C server test:e2e:security`：13 suites／73 tests 通過；`pnpm -C server test:schema`：3 suites／14 tests 通過。
- `pnpm -C server lint:check` 與 `pnpm -C server build` 通過；本次修改的 policy／HR／fixture／E2E 檔案另外直接執行 ESLint，0 errors、0 warnings。
- 使用一次性本機 MySQL 8.4／Redis 與合成 HR／SMTP，未操作 UAT／production 或寄真實郵件。本輪無前端、migration、dependency 或環境設定變更；原雙軸 code review 結果仍僅適用修訂前版本。

### 後續簡化：重複信箱只去重

- 多個候選員編對應同一可信信箱時，允許集合直接以 Set 去重；保留空值及本次實際收件地址的過濾，不再因共享信箱回報檢查失敗。
- 同批 2 人與跨批 101 人共用信箱的案例通過；完整單元測試 108 suites／1,004 tests、server lint（0 errors，既有 warnings）及 build 通過。本次未重跑 DB E2E，上述 E2E／安全／schema 紀錄屬去重調整前的驗證。
