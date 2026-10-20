# 09: 整合驗證、深度 review 與提交前檢查

**What to build:** Spec 008 的完整外部簽署流程（收信 → 開啟 → 同意 → 簽署 → 下載 → 日後重新下載）在桌面與手機都能端到端走完，前後端驗證全數通過，程式經過深度 review，可以提交。

**Blocked by:** 02: 外部簽署人可從邀請信完成簽署；03: 邀請確認頁與失效頁依設計稿改版；04: 簽署尚未開始時顯示開始時間；05: 簽完立即下載本人副本；06: 已簽者日後重新開啟連結下載；07: 開發環境以公司 Gmail SMTP 寄出邀請信；08: staging／production 改用公司 Gmail SMTP 寄信

**Status:** ready-for-agent

- [ ] server lint、單元測試、build、e2e、security e2e 與 client lint、build 全數通過；結果與未能執行的項目記錄在 Spec 008 的 quickstart。
- [ ] 單獨（不與其他 e2e 同時）重跑 `core-esign-flow-scale` e2e 並通過（08 合併後因並行負載逾時）。
- [ ] （人工，來自 08）staging／production 部署前：設定 `ESIGN_MAIL_DRIVER=smtp` 與 Gmail `SMTP_*`（含應用程式密碼）、移除 `ESIGN_MAIL_DRIVER=ses` 與 `SES_FROM`、放行對外 `smtp.gmail.com:587`（或 465）、確認 Google Workspace 每日寄信上限與 SPF／DKIM，可移除 IAM 的 SES 權限；實際 STARTTLS 連線與登入需人工驗證。
- [ ] 依 quickstart 在桌面與手機寬度各完整走一次手動驗收（含尚未開始、失效、停止後下載）。
- [ ] （人工，來自 02）以真實邀請信在真實手機（含 iOS Safari 網址列與 home indicator 對固定底部面板的影響）與桌面各完成一次簽署，並在建立人畫面確認該簽署人顯示已簽署。
- [ ] （人工，來自 03）邀請確認頁、失效頁在真機或 DevTools 裝置模式目視（按鈕可點、窄螢幕與橫向）；確認服務暫停頁自訂文案「服務暫時無法使用／電子簽署服務暫時無法使用，請稍後再開啟邀請信中的連結。」與橘色雲朵圖示。
- [ ] （code review，來自 03）`server/src/common/http/html-error-page.ts` 若已無任何呼叫者則刪除。
- [ ] （人工，來自 01）內部 `/my-signature/[id]` 在桌面與手機寬度與重構前比對：簽名進度面板、拒絕簽署依 `allowReject` 顯示、條款步驟（含簽到表流程）。
- [ ] （人工，來自 07）以 `einvoice@eatogether.com.tw` 的應用程式密碼在本機實寄外部邀請信，收件匣收到且連結可開啟；填入錯誤密碼時 notification log 只有 `failed`、`MAIL_DELIVERY_FAILED` 與下次重試時間，worker 輸出不含 SMTP 回應。
- [ ] 深度 review：KISS、不重複驗證、REST 語意、授權全在 server、token 與 cookie 不進入 log／錯誤訊息／URL 以外位置、回應不含其他簽署人資料；修正確認的問題後重跑驗證。
- [ ] 變更只包含 Spec 008 範圍；專案負責人確認並移除憲章修訂紀錄（Sync Impact Report）。
- [ ] 交付摘要分開說明 client、server、config 變更、驗證結果與已知限制（外部下載不設期限且無撤銷入口，待法務確認；Google Workspace 每日寄信上限待確認）；staging／production 部署前須先設定 SMTP 參數。
