# 04: 內部員工透過 Email＋OTP 簽署或拒簽

**What to build:** 員工不必登入內部入口網，即可從專屬邀請驗證 OTP 後閱讀、簽署或拒簽；一般員工登入與舊入口不能繞過驗證。

**Blocked by:** 03 發起文件並寄送內部員工邀請。

**Status:** claimed

**Spec:** 010 — US2、FR-007～012、FR-015～017。對應 T019～T024、T027、T028，以及 T004 的 ESIGN_EMAIL_OTP_REQUIRED。T025、T026 已由 03 完成；本票不重做邀請 worker。

**執行約定:** 前置 resolved 後執行，沿用現有 Email 通道與 cookie，不建立第二套登入。僅後端及契約，不修改 client、不部署；驗收並整合後才 resolved，追加驗證與 commit 紀錄。

- [ ] user 與 email 指派都可使用既有 Email 通道，但必須具固定有效 email、正確文件關聯及邀請世代；保留內部 userId／類型／員工快照，不轉成外部人員。
- [ ] 單純 GET 邀請不寄碼、不授予存取、不回文件內容；主動開啟才寄 OTP，開始前不寄碼，來源地址固定為發起時信箱。
- [ ] OTP 為 6 位、10 分鐘、一次性、錯 5 次失效；所有寄碼入口共用 60 秒冷卻及每小時 5 封限制，新碼使舊碼失效，並發只成功消耗一次，寄信失敗不建立存取。
- [ ] 驗證後使用獨立 credential 與瀏覽器 session cookie，期限 8 小時；只授權一人一文件，不建立員工 session、不接受邀請原值冒充 credential，同 Email 不同 signer 仍互相隔離。
- [ ] 簽署／拒簽與寬等重送均拒絕 internal principal；舊個人 open、source、sign、reject、completed-file 本人回 403 ESIGN_EMAIL_OTP_REQUIRED，他人 404、未登入 401，保留列表 metadata 與建立人管理權限。
- [ ] 驗證頁面 signer 與 cookie 身分，錯位回 409；保留同意版本、期限、狀態、拒簽規則與證據，新增證據使用 email_invitation，不改歷史 employee_session 證據。
- [ ] 公開 task 的員編、部門、職稱為 null，不洩漏 userId、建立人或管理備註；驗證前只回遮罩地址，沿用既有表單、cookie 與 API 契約。
- [ ] 邀請→OTP→簽署／拒簽 HTTP 測試通過，覆蓋重放、錯人／跨文件、Origin、過期、停止、刪除、舊入口與直接 service 繞過；不保留舊文件免 OTP 分支。
