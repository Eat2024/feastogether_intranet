# 12: 整合驗證、深度 review 與提交前檢查

**What to build:** Spec 008 的完整外部簽署流程（收信 → 開啟 → 驗證碼 → 同意 → 簽署 → 下載 → 日後重新下載）在桌面與手機都能端到端走完，前後端驗證全數通過，程式經過深度 review，可以提交。

**Blocked by:** 02: 外部簽署人可從邀請信完成簽署；03: 邀請確認頁與失效頁依設計稿改版；04: 簽署尚未開始時顯示開始時間；05: 簽完立即下載本人副本；06: 已簽者日後重新開啟連結下載；07: 開發環境以公司 Gmail SMTP 寄出邀請信；08: staging／production 改用公司 Gmail SMTP 寄信；09: 送出簽名綁定簽署人；10: 外部簽署人通過驗證碼才能開啟文件；11: 驗證碼重新寄送與寄送上限

**Status:** ready-for-human

- [x] server lint、單元測試、build、e2e、security e2e 與 client lint、build 全數通過；結果與未能執行的項目記錄在 Spec 008 的 quickstart。
- [x] ~~單獨重跑 `core-esign-flow-scale`~~：使用者 2026-10-20 決定改為 10 人（8ba6a3c），併入一般 e2e，不再單獨執行。
- [ ] （人工，來自 08）staging／production 部署前：設定 `ESIGN_MAIL_DRIVER=smtp` 與 Gmail `SMTP_*`（含應用程式密碼）、移除 `ESIGN_MAIL_DRIVER=ses` 與 `SES_FROM`、放行對外 `smtp.gmail.com:587`（或 465）、確認 Google Workspace 每日寄信上限與 SPF／DKIM，可移除 IAM 的 SES 權限；實際 STARTTLS 連線與登入需人工驗證。
- [ ] 依 quickstart 在桌面與手機寬度各完整走一次手動驗收（含尚未開始、失效、停止後下載）。
- [ ] （人工，來自 02）以真實邀請信在真實手機（含 iOS Safari 網址列與 home indicator 對固定底部面板的影響）與桌面各完成一次簽署，並在建立人畫面確認該簽署人顯示已簽署。
- [ ] （人工，來自 03）邀請確認頁、失效頁在真機或 DevTools 裝置模式目視（按鈕可點、窄螢幕與橫向）；確認服務暫停頁自訂文案「服務暫時無法使用／電子簽署服務暫時無法使用，請稍後再開啟邀請信中的連結。」與橘色雲朵圖示。
- [x] （code review，來自 03）`server/src/common/http/html-error-page.ts` 若已無任何呼叫者則刪除。
- [ ] （人工，來自 04）「簽署尚未開始」頁在手機與桌面目視比對設計稿 04；確認外部 API 的 409 回應附 `details.startAt`（僅有效邀請持有人可見）可接受。
- [ ] （人工，來自 06）以另一個瀏覽器重新開啟已簽者的原邀請連結，確認直接進入完成頁並可下載；文件被停止後再試一次仍可下載。
- [ ] （人工，來自 05）在真實瀏覽器點「下載已簽署文件」並開啟存檔的 PDF；手機寬度檢查完成頁；確認輪詢遇到一次請求錯誤即停止（需重新整理）的取捨可接受。
- [ ] （人工，來自 01）內部 `/my-signature/[id]` 在桌面與手機寬度與重構前比對：簽名進度面板、拒絕簽署依 `allowReject` 顯示、條款步驟（含簽到表流程）。
- [ ] （人工，來自 10）瀏覽器比對驗證碼輸入頁、錯誤頁與設計稿 11、12，以及過期頁、寄信失敗頁；確認錯誤頁不回填輸入的驗證碼可接受；觸發 IP 限流時回 JSON 429 可接受。
- [ ] （人工，來自 11）比對 scratchpad `t11-render/` 的 429 冷卻／上限頁（429 訊息無設計稿，暫以紅字置於重新寄送按鈕下）；真實瀏覽器確認冷卻倒數在 CSP 下運作；寄信失敗頁文案與契約「驗證碼寄送失敗，請稍後再試」不一致（10 遺留）。
- [ ] （人工，來自 10、11）以真實信箱收取驗證碼信（確認無連結、可能進垃圾郵件）、輸入錯誤顯示剩餘次數、60 秒冷卻與重新寄送，以及驗證成功後才進入文件。
- [ ] （人工，來自 07）以 `einvoice@eatogether.com.tw` 的應用程式密碼在本機實寄外部邀請信，收件匣收到且連結可開啟；填入錯誤密碼時 notification log 只有 `failed`、`MAIL_DELIVERY_FAILED` 與下次重試時間，worker 輸出不含 SMTP 回應。
- [x] 深度 review：KISS、不重複驗證、REST 語意、授權全在 server、token 與 cookie 不進入 log／錯誤訊息／URL 以外位置、回應不含其他簽署人資料；修正確認的問題後重跑驗證。
- [ ] （人工，來自 12）確認可接受：瀏覽器無法以 `DELETE /api/external-signature-session` 撤銷外部存取（cookie path 為 `/api/external-signing-task`，瀏覽器不會帶到該端點；目前前端也未呼叫，憑證 8 小時後自動失效）；cookie 屬簽署人 A、頁面屬 B 且 A 的存取已失效時，送出簽名回 409「簽署對象已變更」而非 401。
- [ ] 變更只包含 Spec 008 範圍；專案負責人確認並移除憲章修訂紀錄（Sync Impact Report）。
- [ ] 交付摘要分開說明 client、server、config 變更、驗證結果與已知限制（外部下載不設期限且無撤銷入口，待法務確認；Google Workspace 每日寄信上限待確認）；staging／production 部署前須先設定 SMTP 參數。

## 實作紀錄（2026-10-20）

- 深度 code review（Standards／Spec 兩軸，`git diff f7d89f0...HEAD`）發現驗證碼可被繞過：cookie 值即邀請連結中的 token。使用者決定改為驗證成功時產生的隨機存取憑證（Redis 存雜湊、8 小時失效），先更新 Spec 008（`0a6b866`：FR-016、FR-027、FR-028、research §15、T044）再實作。
- 修正分支 `008/12-review-fixes`：`b8c955d`（存取憑證分離，先以 e2e 重現 token 當 cookie 可讀任務／PDF／副本；簽署人比對移至 service；外部存取查找抽成單一 helper；cookie helper 移除 `expiresAt`）、`9eea4b7`（邀請頁重複區塊、OTP 時效與次數由常數推得、寄信失敗與尚未開始改為明確結果、刪除 `html-error-page.ts`、`isDeployedEnvironment`、`signAfterHint` 與 `formatInTaipei`）、`7892009`（`ConfirmHeading` 共用、`useSignaturePad`）、`efbab9b`／`70e3d84`（Spec 003 四處取代註記、驗證紀錄）；合併至整合分支 `0f8d2a8`。
- 根目錄與 client `AGENTS.md` 依使用者同意更新為現況（建立人文件管理與外部簽署頁已串接，我的簽署與部分 forms 仍為 mock）。
- 驗證（記錄於 quickstart）：server test 92 suites／814 tests、build、lint 0 error；e2e 85、security 31；client lint、build；整合後 server／client 驗證通過。
- 未處理：已簽者任務回應含文件層級進度欄位（Spec 003 既有行為，列為已知限制）；`auth-cookie.ts`、`create-db.ts`、`logger.config.ts` 的環境判斷不在本規格 diff 內；`ExternalAccessService` 依賴數未減少。
- 剩餘為人工項目，狀態改為 ready-for-human。

