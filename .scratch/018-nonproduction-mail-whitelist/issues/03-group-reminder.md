# 03: 群發與催簽逐人過濾並正確收尾

**What to build:** 內部群發與催簽僅交付允許地址，逐人結果、批次與重試正確收斂。

**Blocked by:** 02 單人邀請只寄給白名單允許的收件人

**Status:** claimed

- [ ] 共用 sender 的群發回傳每個正規化去重後地址恰一筆結果；To/CC/BCC/envelope 均不含阻擋地址，無允許者不呼叫 adapter。
- [ ] 必要來源故障整次尚未寄送檢查為 check-failed；adapter accepted/rejected/unknown 與 mismatch 保守語意保留。
- [ ] 內部群發與 reminder 路徑 blocked→skipped，check-failed→failed 並最多 3 次含首次及 30/60 秒退避；recovery 不復活耗盡或 skipped，批次總數與租約收尾正確。
- [ ] 排隊後撤銷在寄送時生效、每次重試重讀、追加不自動補寄 skipped；unknown 不盲目重送，舊世代不覆寫新結果。
- [ ] 混合／全阻擋、重複地址、來源故障、撤銷、重試耗盡與批次結果的測試通過。

## 實作與驗證紀錄

- 群發結果明確映射 blocked→skipped、check-failed→failed，保留逐人 SMTP 結果、既有三次上限、租約與批次收尾。
- 外部催簽辨識兩種政策錯誤，阻擋不重試，檢查故障採 30／60 秒退避；終止結果清除催簽暫存密文，不寫成功稽核。
- 先以真實 DB 測試證明舊行為將群發及催簽的阻擋錯記 unknown，再完成修正。新增完整 policy／guard／worker 測試，不覆寫公開 sender 為無條件允許。
- 隔離 MySQL 8.4、測試資料庫前綴 feastogether_intranet_test_03：mail-whitelist-worker E2E 13 tests 通過，含混合／重複地址、撤銷及恢復、每次重試重查、三次耗盡與 recovery、unknown、退休租約及實際 Nodemailer stream MIME／envelope。未使用真實 SMTP 或 UAT。
- 完整 server 單元測試 108 suites／1,001 tests 通過；server build 通過。server lint 檢查零錯誤，既有警告保留；新增測試已修正 unbound-method 與型別問題。
- 待 merger 整合後依實際 commit 補結案紀錄；完整跨入口回歸與部署文件由 05 完成。
