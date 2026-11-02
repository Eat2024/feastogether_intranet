# 05: 全入口整合驗收與切換交付

**What to build:** 交付可追溯全入口保護與環境矩陣，提供協調切換及安全回滾文件。

**Blocked by:** 03 群發與催簽逐人過濾並正確收尾；04 OTP 套用白名單並呈現真實寄送結果

**Status:** claimed

- [ ] 每個非 production 環境的邀請／群發／催簽／OTP 均受政策保護；production 不新增政策 DB/HR 呼叫，缺漏與非法環境拒絕。
- [ ] E2E 使用合成 HR/SMTP 與具體 guarded sender，不全域覆寫公開 token 繞過政策、不冒用 production；新增測試被 Jest 配置收集。
- [ ] 完成適用單元、schema、E2E、安全、root lint/build，記錄真實結果；確認前後端沒有洩漏敏感資料。
- [ ] 更新 spec/plan/quickstart 的實作與驗證狀態；交付停止舊 worker/OTP、schema/seed、同步上版、驗證及停止寄信後回滾程序，不執行 UAT 異動或真實寄信。
- [ ] 完成 Standards 與 Spec code review、修正發現並重驗；整合至功能分支、更新 PR 與票單驗證／commit 紀錄。
