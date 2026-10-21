# 07: 重新開放簽署並寄送新邀請

**What to build:** 建立人重新開放符合條件的文件時，內外部待簽者都收到寄往原固定信箱的新邀請；舊待簽邀請失效，已簽及已拒資料與邀請世代不變。

**Blocked by:** 04 內部員工透過 Email＋OTP 簽署或拒簽。

**Status:** claimed

**Spec:** 010 — US4 的補簽部分、FR-005、FR-014～017。對應 T034、T036～T038，以及 T004 的 ESIGN_REOPEN_RECIPIENT_UNAVAILABLE。T034 的已簽原邀請實際副本下載與 T039 跨流程驗收由 08 在 05 完成後執行；本票先驗世代、證據與存取政策不變。

**執行約定:** 前置 resolved 後執行；依核准票單不以催簽 06 為必要前置，直接沿用 03 的通知世代與 worker。原 tasks 的 T035 階段排序不作額外阻擋；共享通知檔案須協調整合。不修改 client、不部署；驗收並整合後才 resolved，追加驗證與 commit 紀錄。

- [ ] 沿用 expectedSignEndAt、新期限及 trim 後 1–500 字 reason 規則；先核對所有 pending 指派的固定地址及原邀請，任一缺漏整次回 409 ESIGN_REOPEN_RECIPIENT_UNAVAILABLE，僅列允許的 signerPublicIds，無任何部分寫入。
- [ ] 不查 HR、不回填舊指派、不更正收件地址；同 Email 逐人建立通知，不新增檢查、警告、阻擋或去重。
- [ ] 同交易作廢舊未完成通知、僅輪替 pending 世代並建立 invitation batch/log，提交後入列；signed／rejected 不輪替、不寄送，原 payload／hash 與證據不改。
- [ ] 舊 pending token 與 cookie 失效；舊未 claim job 不再寄，已在途 SMTP 可能送達但舊連結不能授權。舊 finish／fail 不得覆寫新通知、寄送狀態或清除新密文。
- [ ] worker 沿用文件→通知→簽署人鎖序，不跨 SMTP 持有長交易；SMTP 失敗保留已補簽狀態，重送不重複建立批次。
- [ ] 建立人詳情顯示最新有效邀請寄送狀態；補簽邀請清單含內部 pending，正常略過寄送後已清密文的項目，全部送完回空清單；仍有密文卻損壞回 503，不為複製連結永久保留密文。
- [ ] unit／HTTP／worker 競態測試驗證原子性、世代與舊結果隔離，並以合成 signed／rejected 資料驗證既有存取政策不變；契約說明邀請清單不是待簽總表，實際下載保護由 08 再驗收。
