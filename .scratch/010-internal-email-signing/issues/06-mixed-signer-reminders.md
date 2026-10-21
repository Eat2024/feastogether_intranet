# 06: 內外部簽署人混合催簽

**What to build:** 建立人可對指定或全部待簽的內外部人員人工催簽，逐人看見受理、略過與寄送結果；同信箱仍各自寄送及計算額度。

**Blocked by:** 03 發起文件並寄送內部員工邀請。

**Status:** resolved

**Spec:** 010 — US4 的催簽部分、FR-005、FR-014～016。對應 T033、T035；T039 的跨催簽／補簽整體回歸由 08 執行。

**執行約定:** 依已核准依賴，03 resolved 後可用合成待簽／終態資料驗收通知，不等待 04、05 的互動流程；原 tasks 的 US3 階段門檻不作本票阻擋。不修改 client、不部署；驗收並整合後才 resolved，追加驗證與 commit 紀錄。

- [ ] selected 與 all_pending 都支援具有有效固定地址／邀請的內部 user 指派及外部指派，selected 沿用最多 6,000 人；不重新查 HR 或改收件地址。
- [ ] 同文件同 signer 台北時間每天最多受理一次、午夜重置；以 signerId 而非 Email 計算，同 Email 不合併通知；OTP 額度獨立。
- [ ] 同 requestId 重送不重複受理，異 payload 沿用衝突錯誤；並發請求不可超額，pending／processing／待重試／unknown 依既有政策計額度。
- [ ] 已簽、已拒、已催簽及不符合文件狀態者依規則略過或拒絕；無合格對象保留既有 details.items，不把缺必要邀請條件的歷史內部指派補登為可寄送。
- [ ] 沿用 202、通知 kind／狀態、cursor 與 limit 1–100 契約，批次回傳逐人結果；寄送失敗可追蹤，不撤銷文件。
- [ ] unit／HTTP／worker 捕捉郵件驗證混合名單、共用信箱、額度邊界、重送與競態，既有外部催簽回歸通過；相關契約同步。

## 實作紀錄（2026-10-21）

- 以整合分支 `a5a7d1d`（03 已 resolved）為基底，於獨立 `feat/010-ticket-06` worktree 實作；保持 claimed，交由 merger 完成整合後結案。
- TDD：內部資格先出現 `INTERNAL_REMINDER_UNSUPPORTED` 的 red，移除型別封鎖後 green；無效固定信箱／缺邀請世代先 red，再以共同資格檢查拒絕。HTTP all_pending 先只選到 1/2 人 red，再移除外部限定後 green。
- 共同 eligibility 同時供建立人摘要、受理與寄出前 worker 使用。selected/all_pending 納入內部；同地址不合併，保持 signer 額度及既有 requestId／文件鎖防重。
- HTTP／worker 捕捉郵件涵蓋內外部共用地址寄出兩封不同 token、逐人每日限額、內部並發僅受理一批、缺固定信箱歷史指派拒絕且不建立催簽批次；保留外部提醒、租約、重試、分頁及安全回歸。未呼叫真實 HR／SMTP。
- 驗證：`pnpm --config.verifyDepsBeforeRun=false -C server test --runInBand`：104 suites、900 tests 通過；`test:e2e --testPathPatterns=esign-reminders`：18 tests 通過；`build` 通過；`lint:check` 0 errors（既有 warnings）；`git diff --check` 通過。既有 reminders 檔已在 e2e whitelist，無新增測試入口。
- 契約及 Swagger 明列內外部混合對象、固定地址、逐人配額；不改 client、schema、設定、依賴及共用 tasks/quickstart。不在本票承諾尚待 04 的內部 OTP 操作。

## 整合驗收紀錄（2026-10-21）

- 實作 commit `4d82c5e` 以 `--no-ff` 合入 `feat/010-internal-email-signing`，merge commit `da5c447`，無衝突；前置 03 已 resolved。
- 合併者核對 all_pending 包含內部、共同 eligibility 的固定信箱／邀請檢查、同地址逐 signer 寄出及限額；既有外部、錯人、授權與並發測試未被移除。
- 整合分支 `pnpm --config.verifyDepsBeforeRun=false -C server test --runInBand esign-reminder-policy.spec.ts`：7 tests 通過；DB slot 序列取得後執行 `pnpm --config.verifyDepsBeforeRun=false -C server test:e2e --testPathPatterns=esign-reminders`：1 suite／18 tests 通過，含最後更新的精確結果斷言。
- 同一程式碼樹全套 unit 104／900、build、lint 零 errors 證據如上；本票六項驗收完成，狀態改 resolved。DB／Redis 已釋放；04、05、07 與跨流程 08 仍依各自票單驗收，不以本票代替。
