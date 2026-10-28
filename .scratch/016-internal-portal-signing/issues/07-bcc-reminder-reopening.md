# 07：催簽與補簽沿用 BCC 並正確處理舊工作

**What to build:** 建立人選取待簽員工催簽或開放補簽時，內部以 BCC 通知本批合格人員；補簽後舊批次不會再覆蓋新結果。

**Blocked by:** 06 BCC 邀請與投遞機制。

**Status:** claimed

**Tasks coverage:** T031；T024/T026/T032–T035/T037 的催簽、補簽、每日額度與 supersede 部分。

- [ ] 人工催簽只寄本次選取且合格的人，保留台北每日一次限制及批次重送去重；外部依原 token 世代逐人寄送。
- [ ] 內部通知資格依文件期間與指派狀態判斷，不再要求 invitation token 或其期限。
- [ ] 補簽同交易失效舊未完成通知並建立新批次；排隊中／領取中／延遲完成的工作不能改寫新批次結果。
- [ ] 暫時失敗只合併本批未寄出地址重試，已受理／永久失敗／未知結果不被維護工作重送。
- [ ] 建立人畫面的操作與逐人結果、混合名單、跨日與競態整合驗收通過。

## 實作紀錄（2026-10-28）

- 內部催簽資格只依文件期間、指派、固定有效 Email 與既有每日額度，不再要求 token。新內部 reminder log 的 token／generation／expiry 為 NULL；producer 僅排本批內部 batch 與外部逐 log。
- worker 在文件鎖內以 locking read 重讀催簽歷史，再驗證期間與每日額度；避免等待文件鎖前的交易快照漏看另一批受理結果。重試仍只處理本批未受理地址。
- 補簽仍在同交易退休舊 pending／processing／可重試 failed；共同 lease 防止在途 SMTP 延遲結果覆寫新批。保留 delivered／unknown 歷史。
- 內部補簽不建立或輪替 token；歷史 digest 保留供舊入口辨認，授權與寄送均不使用。外部照原世代輪替，建立人可取的專屬補簽邀請限定外部。
- 無 Email 的內部補簽仍更新資格與期限，通知 skipped／RECIPIENT_UNAVAILABLE，不入列；一般發起與 UI 無 Email 流程由 08 接續。

驗證：
- TDD 已重現並修正：內部無 token 催簽、補簽不輪替、無 Email 補簽、內部 reminder token／佇列分流、worker 寄送前開始時間／每日額度重驗。
- 真實 MySQL：新增 `internal-group-reminders.e2e-spec.ts` 8 案，覆蓋選取子集合、混合內外部、requestId 重送、台北跨日、併發申請、跨午夜部分重試、補簽退休舊工作與 SMTP 在途完成競態、無 Email 補簽。
- 新舊群寄與催簽共 3 suites／31 tests 全通過，包含既有外部 OTP 催簽回歸；使用獨立 `feastogether_intranet_test_spec016_t07`。
- 修正 06 新測試的 maintenance 候選分頁起點，使重複執行或與其他 suites 同跑不依賴測試 DB 無舊待寄紀錄。
- Server build、lint:check（0 errors）通過。建立人操作與結果經 HTTP API 驗證；未執行瀏覽器／正式 Portal 或實際公司 SMTP 驗收，留待 10 整體驗收。

狀態維持 claimed，等待整合分支合併後關閉。
