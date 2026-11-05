# 06: 每週輪換隱藏入口並支援停機補做

**What to build:** 背景服務每週一台北 04:00 換新入口；維護者可透過同一 REPL 查詢結果，在服務停機或多實例競爭下仍只有一個有效網址，既有會話不被登出。

**Status:** ready-for-agent

**Blocked by:** [04-hidden-login](04-hidden-login.md)

**Source:** [Spec](../../../specs/027-super-user-access/spec.md)、[Plan](../../../specs/027-super-user-access/plan.md)、[Tasks](../../../specs/027-super-user-access/tasks.md)、[資料模型](../../../specs/027-super-user-access/data-model.md)、[API 行為](../../../specs/027-super-user-access/contracts/api-behavior.md)、[維運契約](../../../specs/027-super-user-access/contracts/operations.md)、[驗收指南](../../../specs/027-super-user-access/quickstart.md)。

**Scope:** T037、T038、T039、T040、T041、T042、T043、T044。

## Acceptance Criteria

- [ ] 共用輪換服務鎖 singleton，以最近到期週期大於 DB 已處理週期才產新入口、增加 entry generation 並同交易寫事件；同週 no-op、不改 credential generation、不撤會話。
- [ ] 只有獨立 worker 註冊週排程；固定 queue／scheduler／job、Asia/Taipei 週一 04:00、空 payload、3 次重試及既定 exponential backoff，保留最近 100 成功／失敗 metadata。
- [ ] startup 先做 DB catch-up，再處理 overdue job／排程；停機多週只補一次，Redis 排程遺失、job 重試及多 worker 並發仍由 DB 仲裁。
- [ ] 03:59:59／04:00、跨年、同週重啟、DB 故障與恢復有測試；失敗保留舊入口，未初始化不偷建帳號，不新增掃描排程或 production 時間設定。
- [ ] 輪換後舊 GET／POST 立即 404，包括已開舊表單；輪換先 commit 則登入失敗，登入先 commit 的會話仍有效。
- [ ] REPL 提供到期才輪換與白名單安全事件查詢（limit 預設 20、最大 100，beforeId 倒序），沒有任意強制輪換或 token 查詢；唯讀 helpers 不寫入。
- [ ] 真正 REPL 的初始化並發、重複不覆寫、開發／建置模式與連線關閉通過；HTTP／Console 不註冊 queue、不啟動外部業務服務。
- [ ] 完成週期、故障、競態與副作用驗收紀錄，未跑的停機環境情境明列限制。

## Comments & Implementation Results

（尚未開始）
