# 02: 單人邀請只寄給白名單允許的收件人

**What to build:** 實際邀請寄送前核對可信 HR 與最新規則，通知畫面可區分跳過與檢查故障。

**Blocked by:** 01 白名單建立、撤銷與恢復

**Status:** claimed

- [ ] 唯一公開寄送 token 包覆 SMTP／fake，保留 send/sendOtp 的 Promise<void> 契約；建立 typed blocked/check-failed 與群發結果契約供後續票使用。
- [ ] NODE_ENV 明確必填、精確 production 才跳過白名單 DB／HR，其餘合法環境受保護；非法或缺漏拒絕啟動／傳輸，必要設定範例與測試同步。
- [ ] 最新有效規則按完整部門或員編 OR 匹配；HR 精確節點直接員工、信箱每批最多 100、資格最多 4 並行；無跨呼叫快取，不依賴本地 User 或 Spec 017。
- [ ] 實際單一合法地址與可信有效員工信箱一致才允許；偽造、離職、轉部門與同網域不放行；缺資料為 blocked，來源故障／格式／歧義為 check-failed，來源故障不部分寄送。
- [ ] 原邀請 blocked 記 skipped、不重試；check-failed 最多 3 attempt 含首次、30/60 秒退避，recovery 排除耗盡工作；保留 lease／generation 與既有 SMTP unknown 規則。
- [ ] 不寫 delivered audit／invitationDeliveredAt 或改簽署資格；通知 UI 呈現兩種穩定原因，不洩漏名單或憑證；對應單元／整合測試通過。

## 實作與驗證（待整合）

- 已實作共用 guarded sender、可信 HR 寄信資格分類、白名單政策、單人邀請政策結果與 recovery 上限、明確 NODE_ENV、通知原因文案。群發已提供過濾及逐人契約，群發／催簽 consumer 與 OTP HTTP 結果由 03／04 接續。
- TDD：HR 資格分類、政策員編／部門／批次、sender／環境／群發、原邀請政策結果均先觀察失敗再完成；單元測試涵蓋來源故障、歧義、離職／轉部門、地址注入、撤銷、100 人分批與最多 4 個資格查詢並行。
- `pnpm -C server test --runInBand`：108 suites／1001 tests 通過。
- `pnpm -C server build`：通過。
- `pnpm lint`：前後端通過，server 0 errors（267 個既有 warnings）。
- 隔離 MySQL 8.4、127.0.0.1:13318、測試資料庫前綴 `feastogether_intranet_test_02` 執行 `pnpm -C server test:e2e mail-whitelist-recovery`：1 test 通過；證明排除政策耗盡／skipped，保留原 SMTP 重試。
- `pnpm build`：server 通過；client 在 /tmp worktree 因 node_modules symlink 指向 workspace 外而遭 Turbopack 拒絕，整合後由原工作區補驗證，未宣稱 client build 通過。
- 沒有操作 UAT、呼叫真實 HR 或 SMTP；沒有新增依賴、管理介面或白名單以外資料表。
- 完整 E2E fixture 與全入口驗證於 05 完成；本票仍 claimed，待合併至整合分支並記錄 commit 後結案。
