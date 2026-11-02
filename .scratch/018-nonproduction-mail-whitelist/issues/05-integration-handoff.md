# 05: 全入口整合驗收與切換交付

**What to build:** 交付可追溯全入口保護與環境矩陣，提供協調切換及安全回滾文件。

**Blocked by:** 03 群發與催簽逐人過濾並正確收尾；04 OTP 套用白名單並呈現真實寄送結果

**Status:** resolved

- [x] 每個非 production 環境的邀請／群發／催簽／OTP 均受政策保護；production 不新增政策 DB/HR 呼叫，缺漏與非法環境拒絕。
- [x] E2E 使用合成 HR/SMTP 與具體 guarded sender，不全域覆寫公開 token 繞過政策、不冒用 production；新增測試被 Jest 配置收集。
- [x] 完成適用單元、schema、E2E、安全、root lint/build，記錄真實結果；確認前後端沒有洩漏敏感資料。
- [x] 更新 spec/plan/quickstart 的實作與驗證狀態；交付停止舊 worker/OTP、schema/seed、同步上版、驗證及停止寄信後回滾程序，不執行 UAT 異動或真實寄信。
- [x] 完成 Standards 與 Spec code review、修正發現並重驗；整合至功能分支、更新 PR 與票單驗證／commit 紀錄。

## 實作與驗證紀錄

- 實作 commits：8cf26ae（明確合成名單與核心流程）、6357dff（app／worker 政策生命週期）、7191c9b（原生模組環境矩陣）、077578d（既有 E2E 消費端）。
- 原生 HTTP／worker × 四環境共 8 項驗證，保留真實 MailModule／policy／repository；記憶體 SMTP envelope 與 fake 接受集合均符合規則。暫時還原舊 sender 時 8 項全數失敗，實驗後已復原。
- 既有 E2E 以測試明確登錄的有限合成 HR 名單執行真實政策，不從寄送輸入或文件快照自動授權；兩個跨午夜 session fixture 已修復，未更動正式 TTL。
- 隔離 MySQL 8.4（本機13318）、Redis（本機16318、非0 DB），未呼叫真實 HR／SMTP、未操作 UAT／production。
- schema 3 suites／14 tests、security 13 suites／73 tests、unit 108 suites／1,006 tests 通過；root lint 0 errors（既有 warnings）、server build 通過。
- 完整 E2E：32 suites／345 tests 通過，162.123 秒。整合後原工作目錄的 `pnpm build` 前後端均通過；Standards／Spec 正式審查已完成，兩軸均為 0 項發現。

- 快轉整合點：`8546772`（`implement/spec018-05` → `docs/spec-018-mail-whitelist`），包含最新 `origin/dev`；root build 已補驗證通過。敏感資料邊界與正式 code review 均已完成確認。

## 最終審查與交付

- 整合驗證 commit：`2152996`；完整前後端 `pnpm build`、root lint 與 1,006 項單元測試通過。
- 固定審查基準：`fb3c4ea`（最新 dev），程式審查範圍 `fb3c4ea...8546772`；其後僅補充驗證及交付文件。
- Standards：0 項發現；已檢查專案規範、七欄資料模型、前後端與敏感資料邊界，無需修正的程式碼異味。
- Spec：0 項發現；FR-001～FR-014、寄送契約、OTP、群發、重試／租約與資料維護均符合。
- 審查為獨立唯讀靜態檢查，採用上述隔離測試證據；不代表真實 HR／SMTP 容量或部署切換已驗收。
- 交付 PR：[#38](https://github.com/Eat2024/feastogether_intranet/pull/38)，未合併至 dev、未部署或執行正式資料維護。
