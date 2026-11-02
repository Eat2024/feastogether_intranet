# 04: OTP 套用白名單並呈現真實寄送結果

**What to build:** HTTP OTP 受相同收件人政策保護，不對未寄出的驗證碼回報成功。

**Blocked by:** 02 單人邀請只寄給白名單允許的收件人

**Status:** resolved

- [x] 允許員工可信信箱可走外部 OTP，不要求本地 User；recipient-blocked 回 403 安全頁，check-failed 與真正寄送失敗回 503。
- [x] 阻擋不存本次新 code、不增加成功 hourly、不寫 external_otp.sent；釋放本次冷卻 claim，依既有失敗語意保留舊有效碼。
- [x] 保留 Origin／邀請資格、endpoint 節流、TTL、驗證次數及冷卻；不新增自動重試，不落到 429 新碼輸入或成功頁。
- [x] 錯誤與 log 不揭露完整白名單／員編／OTP／token／上游 body；服務及 HTTP 整合測試驗證政策與結果。

## 實作與驗證紀錄

- 實作 recipient-blocked 結果與 HTTP 403 安全頁；來源故障仍回 503，內部只記穩定原因碼，不記原始上游錯誤。沿用 sent 才保存新碼、計成功額度及寫成功稽核的流程。
- TDD：先驗證舊程式將阻擋誤回 delivery-failed（1 failed／14 passed），再加入分類；安全頁測試先因頁面不存在失敗後實作；診斷紀錄先因缺少穩定原因失敗後實作。
- 單元：108 suites／1,006 tests 通過；涵蓋新碼不存、失敗不消耗額度、舊碼及錯誤次數保留、冷卻釋放與安全紀錄。
- 專用 HTTP E2E：mail-whitelist-otp 5 tests 通過。原生 MailModule 與 guarded sender 未覆寫，只替換 HR 上游並觀測底層 fake 傳輸；使用本機隔離 MySQL 13318、Redis 16318／DB 4。驗證 403、503、動態新增／撤銷、無本機 User 也可寄送、稽核、舊碼驗證、Origin 與 IP 節流。測試已加入一般與安全 E2E 收集設定。
- server lint:check：0 errors；server build 通過。廣泛既有 E2E fixture 遷移與整體矩陣由票 05 整合驗證。
- 未執行 UAT 資料異動或真實寄信。已整合至功能分支並結案。

- 實作與快轉整合 commit：`c5a2767`（`implement/spec018-04` → `docs/spec-018-mail-whitelist`）；原生 HTTP E2E 的 5 個案例已通過，OTP 的一般／安全 E2E 收集設定均已保留。
