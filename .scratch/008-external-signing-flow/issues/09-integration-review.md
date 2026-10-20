# 09: 整合驗證、深度 review 與提交前檢查

**What to build:** Spec 008 的完整外部簽署流程（收信 → 開啟 → 同意 → 簽署 → 下載 → 日後重新下載）在桌面與手機都能端到端走完，前後端驗證全數通過，程式經過深度 review，可以提交。

**Blocked by:** 02: 外部簽署人可從邀請信完成簽署；03: 邀請確認頁與失效頁依設計稿改版；04: 簽署尚未開始時顯示開始時間；05: 簽完立即下載本人副本；06: 已簽者日後重新開啟連結下載；07: 開發環境以公司 Gmail SMTP 寄出邀請信；08: staging／production 改用公司 Gmail SMTP 寄信

**Status:** ready-for-agent

- [ ] server lint、單元測試、build、e2e、security e2e 與 client lint、build 全數通過；結果與未能執行的項目記錄在 Spec 008 的 quickstart。
- [ ] 依 quickstart 在桌面與手機寬度各完整走一次手動驗收（含尚未開始、失效、停止後下載）。
- [ ] 深度 review：KISS、不重複驗證、REST 語意、授權全在 server、token 與 cookie 不進入 log／錯誤訊息／URL 以外位置、回應不含其他簽署人資料；修正確認的問題後重跑驗證。
- [ ] 變更只包含 Spec 008 範圍；專案負責人確認並移除憲章修訂紀錄（Sync Impact Report）。
- [ ] 交付摘要分開說明 client、server、config 變更、驗證結果與已知限制（外部下載不設期限且無撤銷入口，待法務確認；Google Workspace 每日寄信上限待確認）；staging／production 部署前須先設定 SMTP 參數。
