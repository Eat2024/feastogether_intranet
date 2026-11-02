# 03: 群發與催簽逐人過濾並正確收尾

**What to build:** 內部群發與催簽僅交付允許地址，逐人結果、批次與重試正確收斂。

**Blocked by:** 02 單人邀請只寄給白名單允許的收件人

**Status:** ready-for-agent

- [ ] 共用 sender 的群發回傳每個正規化去重後地址恰一筆結果；To/CC/BCC/envelope 均不含阻擋地址，無允許者不呼叫 adapter。
- [ ] 必要來源故障整次尚未寄送檢查為 check-failed；adapter accepted/rejected/unknown 與 mismatch 保守語意保留。
- [ ] 內部群發與 reminder 路徑 blocked→skipped，check-failed→failed 並最多 3 次含首次及 30/60 秒退避；recovery 不復活耗盡或 skipped，批次總數與租約收尾正確。
- [ ] 排隊後撤銷在寄送時生效、每次重試重讀、追加不自動補寄 skipped；unknown 不盲目重送，舊世代不覆寫新結果。
- [ ] 混合／全阻擋、重複地址、來源故障、撤銷、重試耗盡與批次結果的測試通過。
