# 02: 單人邀請只寄給白名單允許的收件人

**What to build:** 實際邀請寄送前核對可信 HR 與最新規則，通知畫面可區分跳過與檢查故障。

**Blocked by:** 01 白名單建立、撤銷與恢復

**Status:** ready-for-agent

- [ ] 唯一公開寄送 token 包覆 SMTP／fake，保留 send/sendOtp 的 Promise<void> 契約；建立 typed blocked/check-failed 與群發結果契約供後續票使用。
- [ ] NODE_ENV 明確必填、精確 production 才跳過白名單 DB／HR，其餘合法環境受保護；非法或缺漏拒絕啟動／傳輸，必要設定範例與測試同步。
- [ ] 最新有效規則按完整部門或員編 OR 匹配；HR 精確節點直接員工、信箱每批最多 100、資格最多 4 並行；無跨呼叫快取，不依賴本地 User 或 Spec 017。
- [ ] 實際單一合法地址與可信有效員工信箱一致才允許；偽造、離職、轉部門與同網域不放行；缺資料為 blocked，來源故障／格式／歧義為 check-failed，來源故障不部分寄送。
- [ ] 原邀請 blocked 記 skipped、不重試；check-failed 最多 3 attempt 含首次、30/60 秒退避，recovery 排除耗盡工作；保留 lease／generation 與既有 SMTP unknown 規則。
- [ ] 不寫 delivered audit／invitationDeliveredAt 或改簽署資格；通知 UI 呈現兩種穩定原因，不洩漏名單或憑證；對應單元／整合測試通過。
