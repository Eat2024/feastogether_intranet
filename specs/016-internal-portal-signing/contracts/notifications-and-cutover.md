# 通知、舊入口與切換契約

## 寄送分流

server esign 常數集中保存固定 Portal 正式登入 URL，mail 與舊內部入口共用；UAT／PRD 同值，不新增 env。不更動 `EXTERNAL_SIGNING_ORIGIN`、`WEBVIEW_LAUNCH_ORIGIN` 或既有信件供應商設定。

保留外部 `send`／`sendOtp` 單人契約；在既有 mail port 加入 `sendInternalGroup`，輸入為本批 BCC 地址陣列、kind、文件名稱、建立人及期限，沒有 invitationToken。回傳逐地址 `accepted/rejected/unknown` 及可重試分類（不暴露到一般 API）。text/html 使用相同 Portal 按鈕與登入說明，不含個人 token、簽署人姓名清單或 Email 名單。外部模板、OTP、固定收件地址及期限不變。

發起／催簽／補簽逐一處理：有有效內部 Email 才排寄；無有效地址保留指派與任務，log `skipped/RECIPIENT_UNAVAILABLE`，不記 delivered、不入 SMTP 工作。來源查詢故障維持失敗，不當作全員無信箱。無信箱的補簽仍更新文件期限與資格。

worker 在 claim/send/finish 全部依 signerType 分支。內部沿文件／簽署人狀態、log supersede 與 lease 檢查，不依賴 invitation expiry/generation；外部照舊。每日一次催簽沿既有 policy，補簽使舊未完成通知失效；舊工作不可在完成時覆蓋新 log。SMTP 已在途中無法撤回，沿現有 unknown/retry 語意處理，不宣稱 exactly-once。

## BCC 群寄、部分結果與重試

- 群組限定同一文件、同一次邀請／催簽／補簽 batch，不能跨文件、跨批次或與外部合併。只寄本批實際選取且仍合格的人；不另等待湊滿，不新增排程。
- 每封最多 **50 個不同 BCC 地址**，以既有 Email 正規化值去重並穩定排序，超過拆批。這是本次保守實作上限，不是聲稱服務商固定上限。只有一位或重試只剩一位仍可寄。群寄不改變每日收件人配額，不新增配額繞過。
- 所有實際收件人只放 BCC／SMTP envelope，不放 To 或 CC；可省略 To/CC。驗證實際 MIME 不含 BCC 名單，禁止 keepBcc；不額外把寄件人加入 envelope。共用 Email 一次投遞映射回多個獨立 signer/log。
- producer 在現有 queue 對內部送 `{notificationBatchId}` 工作，同批 dedup；外部維持 `{notificationLogId}`。maintenance 必須使用相同分流。worker 接到歷史內部單人工作時，先轉為所屬批次選取，不能繼續逐人 SMTP。
- 每次領取在既有 DB 交易中鎖文件及批次，選擇可寄送的地址群組，連同其全部合格 log 設共同 lease；鎖內排除 processing/delivered/unknown/skipped、超次數及未到重試時間者。SMTP 在交易外執行，finish 以各 log 相同 lease 條件更新；後續工作領取下一組，不重領已處理地址。併發 workers 不可把同地址拆為重複信件。
- `accepted` 僅在整個 send 成功結束且該地址被受理時映射 delivered；有些地址 rejected 不得把整封視為成功。未對應到本批的地址忽略並列內部協定異常，缺結果者 unknown；mail adapter 不把原始 SMTP 錯誤／地址名單寫 log。
- 明確暫時拒收或確定整封未送出者才重試；內部群寄沿用現有催簽的有限策略：每個 log 最多 3 次（含首次），失敗後 30 秒、60 秒再次符合候選，由既有 maintenance 觸發，不承諾精準時刻。下一次可將本批剩餘失敗地址再合併；永久拒收停止自動重試。已 accepted 的地址不可隨其他失敗者再寄。外部原策略不變。
- DATA 後斷線、SMTP 已成功但落庫失敗、worker 中斷留下 stale processing，均保守 unknown，不自動回 pending。維護工作恢復狀態而非盲目再寄。人工再次催簽仍須遵守既有每日限制，不新增重送介面。
- 本次不新增通知 schema、供應商回執服務或新的計時工作；沿用 batch/log/lease/attemptHistory。記錄仍是逐人結果，畫面不得將人次稱為寄出封數。

設計依據：Nodemailer 的[寄送回應](https://nodemailer.com/)包含 accepted/rejected，部分受理仍可能視為送出成功；[訊息欄位](https://nodemailer.com/message)支援 BCC。實作須測試專案已安裝版本的實際回傳形狀，不依賴原 `Promise<void>` 推定所有地址成功。

## 舊內部邀請與 OTP

所有 `assertExternalAccess`、external principal、簽署／拒簽查重與檔案存取必須只允許外部指派，即使 cookie 仍在 Redis 也不能操作內部任務。不批次刪除歷史 token 或證據。

邀請 GET 維持既有不查資料、不寄碼、不建立 session 的確認頁。POST 開啟／寄 OTP 時，若 token 對應尚存在的內部指派，回 303 到固定 Portal 登入網址，不寄 OTP、不設定 external cookie，也不揭露文件。無效 token 維持原通用失效行為。

已存在內部 OTP cookie 呼叫 task API，回 403 `ESIGN_INTERNAL_LOGIN_REQUIRED` 與固定、安全的 `portalLoginUrl`（新增穩定錯誤碼及 client 對應），顯示「請登入入口網，至我的電子簽完成操作」按鈕。原檔／副本 API 回錯誤而非 PDF 或登入 HTML；簽署、拒簽與重送也拒絕。外部 cookie、邀請、完成後下載與拒簽重送保持原行為。

## 部署順序（實作後由交付流程執行）

1. Portal 先交付 redirect_to、登入／改密碼接續與登出清理，驗證一般登入未變。正式 Portal 尚未具備參數時，不宣稱電子簽通知旅程完成。
2. 暫停受影響通知派送與內部寫入入口，等待舊 worker 在途租約結束或依既有復原機制處理；不刪 queue/log。
3. 同一相容版本更新 HTTP、client、worker。舊內部通知由新 worker 按 user 分支改寄 Portal，外部照原 token 世代；superseded／完成者略過。
4. 驗證後恢復派送及操作。保留每版 artifact 與必要恢復紀錄；沒有 DB migration。

若回退：保留所有新指派、不可變證據及通知結果。舊版不能操作無 Email 指派，也會恢復 OTP 授權，故不可任意只退其中一個服務；先停止受影響流程，再協調整版回退或修正前進，不改寫新證據以迎合舊版。

## 環境驗收限制

電子簽 UAT 寄信也導正式 Portal，其後所見文件來自正式 Portal 實際接的電子簽環境。本次不保留來源環境、不傳 UAT 回跳、不同步 DB；兩邊同一員工登入不代表文件相同。驗收區分 URL 指向正確、UAT API 正確與 Portal 對應環境端到端三種證據。
