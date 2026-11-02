# 04: OTP 套用白名單並呈現真實寄送結果

**What to build:** HTTP OTP 受相同收件人政策保護，不對未寄出的驗證碼回報成功。

**Blocked by:** 02 單人邀請只寄給白名單允許的收件人

**Status:** ready-for-agent

- [ ] 允許員工可信信箱可走外部 OTP，不要求本地 User；recipient-blocked 回 403 安全頁，check-failed 與真正寄送失敗回 503。
- [ ] 阻擋不存本次新 code、不增加成功 hourly、不寫 external_otp.sent；釋放本次冷卻 claim，依既有失敗語意保留舊有效碼。
- [ ] 保留 Origin／邀請資格、endpoint 節流、TTL、驗證次數及冷卻；不新增自動重試，不落到 429 新碼輸入或成功頁。
- [ ] 錯誤與 log 不揭露完整白名單／員編／OTP／token／上游 body；服務及 HTTP 整合測試驗證政策與結果。
