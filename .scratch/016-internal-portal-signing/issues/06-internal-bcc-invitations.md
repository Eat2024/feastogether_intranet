# 06：新發起文件的內部 BCC 邀請與可靠結果追蹤

**What to build:** 建立人發起含內部員工的文件後，同一次通知以一封多人的 BCC 邀請寄出，保留逐人投遞結果；混合名單的外部邀請維持逐人專屬連結。

**Blocked by:** 無。可獨立以測試信件驗證，不須等待 Portal 導頁部署。

**Status:** resolved

**Tasks coverage:** T003；T024/T026–T028/T030/T032–T035/T037 的新發起邀請、群寄、佇列、恢復及結果部分。

- [x] UAT／PRD 都使用正式 Portal 共用連結；內部新指派不產邀請 token；群組只含同文件同批次合格內部收件人。
- [x] 每封最多 50 個不同 BCC 地址，超過才拆批；2／50 人各一封、51 人兩封，單人情境仍可寄。實際 MIME 與正文不揭露收件名單。
- [x] 同信箱只投遞一次，映射回各人的獨立通知 log；外部仍各自專屬邀請，結果畫面按人次顯示而非誤稱封數。
- [x] 首次排入、維護補列與歷史單 log 工作都進批次處理，共用租約原子領取；並行 worker 不重寄已處理地址，SMTP 不放長交易內。
- [x] 部分 accepted 只記相應人員成功；明確暫時未寄出者最多 3 次含首次、30／60 秒退避；永久拒收停止，未知／寄送後落庫失敗／過期 processing 不自動整組重寄。
- [x] transport、worker 與建立文件到通知結果的整合測試通過，保留原外部與 OTP 流程。此票不以「群寄 adapter 寫好」取代實際批次路徑完成。


## 實作紀錄（2026-10-28）

- 內部新發起不產 token；同批只排 batch ID，外部保留逐 log 工作。維護補列與歷史內部單 log 工作同樣走批次路徑。
- 依文件 → 批次 → log → signer 鎖定，以共同 lease 領取最多 50 個不同地址；同信箱多明細同步更新，SMTP 在交易外。
- 新 mail port 回逐地址受理／拒收／未知，BCC MIME 不留名單；部分拒收獨立追蹤、明確暫時失敗最多三次並退避 30／60 秒；stale processing 與寄後落庫失敗不自動重寄。
- 歷史同地址已受理／未知旁的 pending 標示 skipped；退避中的同地址一起等待，不留下無限維護補列。
- 固定正式 Portal URL 集中常數；新邀請通知查詢不再依賴內部 token generation。未變更 schema／env。

驗證：
- TDD：SMTP 部分受理／全拒收分類、worker 共用信箱群寄、發起分流、maintenance 分流、歷史混合地址結果均先確認失敗再通過。
- 真實本機 SMTP：擷取實際 DATA/MIME，確認 To／Cc／Bcc 均不含員工名單，envelope 不加入寄件人；450／550 逐地址分類通過。
- 真實 MySQL e2e 新增 5 案通過：混合內外部與雙 worker 併發、50／51 地址拆批、同信箱去重、stale processing 復原；使用獨立 feastogether_intranet_test_spec016_t06 DB。
- worker 單元另涵蓋 1／2／50／51 人、30／60 秒三次重試、部分接受不重寄、未對應結果、SMTP 後 DB 失敗、租約退休、歷史單 log。
- 後續票單 07／08 負責催簽補簽 policy／無 Email 發起；09 更新既有內部 OTP e2e。此票未操作實際公司 SMTP 或正式 Portal。

狀態維持 claimed，等待整合分支合併後關閉。

- Server build、lint:check（0 errors）通過。擴跑 core-esign-flow 與新群寄共 30 案：26 通過、4 失敗；4 案為既有內部 OTP helper 仍要求 token（3 案）及補簽 policy 尚要求 token（1 案），屬後續 07／09 範圍，未宣稱完整 e2e 已通過。

### 整合紀錄

- 已審查票單範圍，將 `impl/016-06` 的 `e3ca0fa` fast-forward 合併至 `feat/016-internal-portal-signing`；實作 commit `495abb0`。
- 本票邀請群寄驗收完成；催簽、補簽、缺信箱與舊 OTP 回歸仍由 07／08／09 接續，未將整體端到端驗收視為完成。


## SMTP DATA 後斷線修正（2026-10-28）

- 檢查已安裝 Nodemailer 10.1.0 的 `dist/cjs/smtp-connection/index.js::_onClose`：DATA 後失去最終回應仍會使用 `ECONNECTION`／`CONN`，無法用這兩欄判定尚未寄送。
- 新增實際 SMTP server 收完 DATA 並關線、未回 250 的測試，先重現錯誤回傳 `rejected/retryable`，再移除 ECONNECTION 的肯定未寄出分類；現為 `unknown`、不重試。
- 另補 mail adapter 單元 regression、worker 接到 unknown 後無 nextAttemptAt 且重複工作不再寄送。EAUTH、EDNS 與明確 4xx／5xx 拒收仍沿確定未受理分類。
- 狀態暫改 claimed，等待修正合併整合分支後再次關閉。
### 整合後檢查修正

Nodemailer 10.1 的 `ECONNECTION` 也可能在 DATA 後連線中斷時出現，不能概括視為明確未寄出。新增真實 SMTP 斷線回歸並改為保守 unknown 後，再結案本票；07 暫緩。

### SMTP 斷線修正整合

- 修正 `ab98891` 已隨 `e5050c6` fast-forward 整合；DATA 後 ECONNECTION 不再重試，保守記 unknown。
- 真實 SMTP 斷線測試先紅後綠，完整單元測試 106 suites／970 tests 通過；本票重新結案，07 可接續實作。
