# 研究紀錄：Portal 本機員工資料

日期：2026-11-03。依據為本機原始碼與使用者提供的 UAT 查詢結果，未連線正式環境。

## 1. 維持既有 API，移除逐人補查

- Decision：修改 `server/src/features/esign/services/esign-signer-candidate.service.ts` 的 resolve，保留 org chart、Redis 快取與搜尋；刪除 importStaff 與 resolve 路徑 HR 注入依賴。
- Rationale：目前先 findByEmpids，缺人時才循序 lookupEligibleStaff + transaction；這是已觀察到的 110 秒解析請求的可疑熱點，但尚無逐段 profiling 可斷言全部時間都在 HR。
- Alternatives considered：提高 proxy timeout、背景逐人呼叫 HR 都不符合此輪切換本機來源目的。非同步受理另屬 Spec 022。
- DTO 每次 1–100 個完整英數員編；client 以 100 人分批，維持契約。未知帳號回 unavailable，UI 提醒同步；不在解析建立帳號。

## 2. Email 為顯式查詢欄位

- Decision：沿用 UserRepository，為發起與 policy 增加有用途限制的批次查詢，不改一般 findByIds 的欄位曝光。
- Rationale：users.email 已 select:false；目前 EsignEmployeeEmailService.resolveUsers 讀本機身分，lookupEmails 仍以每批 100、最多四個工作同時查 HR。現有 initiation 只重新比對 empid，並沒有防止 Email 或部門在交易前後變更。
- Alternatives considered：全域 select:true 會擴大登入／候選人資料揭露；保留 HR fallback 使資料來源不確定。

## 3. 發起交易一致性

- Decision：以同一 EntityManager 讀取並鎖定發起者與所有內部簽署人，依 user ID 遞增、每批最多 500，之後才鎖文件。快照與資格都以交易內值為準；將已鎖定 users 直接傳入 signer update；僅同 manager 的一般 SELECT 在 repeatable-read 下不等於 current read，不能依賴重讀一定取得鎖定版本。
- Rationale：UserRepository.findByIdForUpdate 註解已有「員工先於文件」鎖順序；應避免文件先鎖、再與登入／匯入爭搶員工造成反向鎖定。不得在交易外取得 Email 後只比 empid。
- Alternatives considered：只比較 updated_at 而不鎖會在檢查後留下競態；將外部查詢放入交易會拉長鎖持有時間。
- 實作驗證：同時發起不同文件共享簽署人、登入更新、匯入更新；死鎖／鎖等待失敗須整筆回滾、不得部分送信，沿用既有錯誤處理，不加自動重試框架。

## 4. 白名單為收件信箱集合

- Decision：policy 的員編／直接部門規則改從 users 批次取得有效員工 email；完整 email 規則直接命中仍短路。精確部門代碼沿用 binary 欄位語意，員編以精確字串再過濾，禁止大小寫相似員編擴大命中。
- Rationale：MailRecipientPolicyService 現在 collectCandidateEmployeeIds 讀 org chart，matchRecipientEmails 查 HR；替換這兩處可同時覆蓋初邀、催簽、補簽與 OTP 所用共用政策。
- Alternatives considered：把白名單名單永久快取會讓匯入與規則更新無法及時反映；直接改通知目標會破壞文件固定信箱。
- 保留每次寄送讀規則、正式環境 bypass、來源失敗 check-failed、無匹配 not-whitelisted，以及共用信箱集合語意。

## 5. 匯入與維護

- Decision：採人工執行的本機維護 CLI，讀取既有匯出格式（HEX TSV），產出 mode 0600 的預覽／原值 artifact，使用既有 DB 設定；不新增資料表、排程、環境變數或 Portal runtime 連線。
- Rationale：Auth 主機可讀 Portal，已成功輸出 5,165 筆；繼續手貼含中文 SQL 會有遺失中文字及 collation 錯誤。工具應明確以 utf8mb4 與 unicode_ci 作跨值比較。
- Alternatives considered：一般 API 提供匯入擴大授權面；把 Portal 密碼放 server 環境變數違反本次最小變更。離職不由在職清單缺席推斷。
- 首次匯入已完成，但不以此證明預覽競態防護或提交後 rollback 已實作。

## 6. 尚需部署時確認的營運事項

- 維運人員於新人或異動需要簽署前人工更新；每次發起只保證本機最近快照，不保證即時 Portal 狀態。上版交接 ticket 紀錄維護責任人與更新時機。
- 用合成 5,001 人在相同環境做前後量測，記錄每階段耗時與 DB 查詢數，不承諾未測量倍數。規劃已無阻止實作的技術未知項目。
