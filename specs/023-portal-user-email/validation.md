# Spec 023 實作驗證紀錄

## 範圍與環境

- 整合分支：`feat/023-portal-user-email`；基準：`5c79e52`（PR #45 已包含 nullable、select:false 的 users.email）。
- 本機 MySQL 8.4／Redis 使用隔離測試資料庫，名稱一律以 `feastogether_intranet_test` 開頭；來源、員工與收件人均為合成資料。
- 本輪沒有連線 UAT／Portal、匯入真實名冊、寄出真實信件、部署或發布遠端 PR。
- 不新增 table、migration、環境變數或排程。Spec 022 的背景發起不在此次交付範圍。

## 已完成的針對性驗證

- Repository：一般查詢不選 email、顯式批次讀取、完整員編精確比對、部門大小寫差異、升冪鎖定。
- 名單解析：18 項 e2e 通過；無本機帳號不建帳，停用或刪除不可用，DB 故障明確失敗，HR 零呼叫。
- 發起／草稿：41 項 e2e 通過；並行主檔修改、同員工多文件、草稿與發起競爭、缺 email 仍指派、拒絕 client 偽造 email、資料庫失敗無部分通知。
- 寄信政策：32 項相關 e2e 通過；本機員工／直接部門／完整 Email 聯集、production bypass、初邀／催簽／補簽／OTP、失敗不放行。
- 核心流程：25 項 e2e 通過；候選解析的舊「自動建立帳號」測試已改為要求先有本機主檔。
- Client lint／build 通過；錯誤提示改為確認帳號狀態或聯絡維運同步；維持每批最多 100 人，任何不可用者阻止整份送出。此項以既有流程碼及 server HTTP 契約核對，未宣稱完成瀏覽器人工操作。

## 整合過程修正

1. 完整 e2e 抓到草稿鎖文件後等待 users 外鍵、發起鎖 users 後等待文件的 deadlock。InnoDB 確認後統一先排序鎖 users、再鎖文件；保留原「發起必須成功」測試期待。
2. Review 發現來源取得時間不能等同預覽執行時間；工具改為要求顯式提供來源取得時間，保存在預覽與完整性摘要。
3. 回復工具 review 發現非 FK 引用的 gap lock 只能延後寫入，不能阻止刪除後插入孤兒引用。現在偵測到非 FK 使用者引用欄位，即使空表，也拒絕含新增帳號的自動回復；純既有帳號回復仍可執行。新增回歸測試通過。
4. 舊測試由 HR stub 提供員工信箱，現改為事前建立本機合成 email，避免把不再使用的 API mock 當成本機資料已存在。

## Review

- 核心流程：檢查解析精確匹配、交易快照、隱私、白名單及匯入原值防護；來源時間問題已列入修正。
- 維護入口：TS 與 compiled CLI 的無效命令實測均非零退出，未啟動 HTTP／worker；檢查私人 artifact、目標 DB 綁定、來源 hash、保護帳號及 no-op。
- 回復工具已覆核完整原值、微秒時間、引用競態與提交後 artifact 失敗；非 FK 引用缺口已修正並通過 7 項回復 e2e。
- 維護解析單元 16 項、匯入 e2e 8 項、回復 e2e 7 項通過。

## 維運交接

- 執行者：具既有 Portal 唯讀與目標 DB 維護權限的維運人員。正式個人責任人及保存期限由團隊於部署前指定；本輪未替團隊指派人員。
- 更新時機：首次切換前，以及新增員工、部門／職稱／信箱異動後，人工執行 preview → 審核分類 → apply；沒有自動同步。
- 來源只含 0／1 不表示可自動停用缺席帳號；離職與停用依既有管理流程處理。
- server／worker 必須同版本部署；同步上版 client 的不可用提示。
- 應用回滾先回復 server／worker 與 client 版本，保留 users.email、帳號及歷史資料。資料回復是另一個受控動作，依維護 runbook 執行，不能用刪帳號取代應用回滾。
- 私人原值檔包含員工資料，只保存在 repository 外的 0700 目錄／0600 檔案；保存期限到期且確認不再需要回復後，依組織規定清理。

## 最終檢查

- server 單元測試：112 suites／1,168 tests 通過。
- root pnpm build（server＋client）：通過。
- root pnpm lint（server＋client）：通過；server 0 errors、269 warnings，未以本任務清理無關既有警告。
- 完整 e2e：36 suites／398 tests 通過（174.253 秒）。
- Security e2e：14 suites／84 tests 通過（9.338 秒）。
- 5,001 人前後各三輪：六輪全部通過，詳見 [performance.md](performance.md)；沒有真實 HR 網路／SMTP，不能推算 UAT 加速倍數。
- 程式整合 commit：`32f72a7`；基礎與規劃 commit：`e14b26a`。
- Schema 未變更，因此不新增 migration 或執行不相關的 schema 變更流程；本次真實 DB 整合測試仍由既有 migration 建立 schema。

## 後續授權：發起批次寫入優化

- 使用者於上述實作完成後授權優化三處發起寫入；對應 ticket07／T027。
- 新增簽署人與通知初建專用 bulk insert 方法；保留既有 saveMany/saveLogs 更新與草稿 caller，不新增 schema、環境變數或背景工作。
- 內部固定信箱與外部邀請資訊在簽署人首次 insert 前準備完整，回查真實 ID 後才建立簽署快照；沒有推算 AUTO_INCREMENT。
- 批次稽核只鎖同文件一次、current-read 鏈尾一次，再按輸入順序計算 hash 鏈分批寫入。原有單筆 append 保持。
- 真實 DB 驗證跨批、非連續 ID、完整 defaults／actor／subscriber、hash 接續與 RR 舊快照；HTTP 在首筆 audit 寫入後故意失敗，確認文件、原 signer ID/publicId、欄位、通知及稽核完整回滾，且不入列。
- 唯讀整合 review 核對 token、快照 ID、缺信箱 skipped、外部世代、同交易及 commit 後 enqueue，未發現實質 regression。
- 三輪 5,001 人量測通過；SQL 50,073→135，HTTP 中位數15.088→1.195秒。細項與限制見 [batch-write-performance.md](batch-write-performance.md)。
- server 單元113 suites／1172 tests、lint（0 errors）及build通過；本輪僅 server 與文件變更，client 未變更。
- 完整e2e首輪38套通過／1套失敗；唯一失敗是通知故障注入仍mock舊saveLogs而沒有觸發。只更新測試注入到insertLogs後，該套25項全數通過；最終驗證涵蓋39 suites／404 tests，未放寬失敗回滾期待。
- Security e2e14 suites／84 tests通過。整合 commit：`b5b0aee`；commit hook root lint及server單元測試亦通過。
- 未部署／未寄出真實郵件；worker寄送耗時未優化，與前端發起HTTP時間分開記錄。
