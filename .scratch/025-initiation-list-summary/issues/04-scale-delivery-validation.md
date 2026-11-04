# 04: 大名單效能與完整交付驗收

**What to build:** 確認 5213 人使用情境快速返回列表、背景安全完成，並備妥可部署與可回滾的完整驗收證據。

**Blocked by:** [01：受理後立即顯示確認日期與預計人數](01-accepted-list-summary.md)、[02：重新進入與原有讀者取得一致摘要](02-summary-access-consistency.md)、[03：背景終態與快取競態正確切換](03-terminal-state-consistency.md)

**對應 Tasks:** T015–T018

**Status:** ready-for-agent

- [ ] 5213 人大型輸入與 256 KiB sort buffer 回歸通過；不排序完整 JSON、無 N+1。
- [ ] 讀取快照不阻塞 worker；成功無重複、失敗無部分正式名單。
- [ ] 1／100／5213 人各 20 次：前置解析完成後至列表摘要可見 P95 <=3 秒；另報點擊起整體等待。
- [ ] 受影響單元、整合、異動保護與前後端 build、lint 通過，所有未完成檢查明列。
- [ ] 合約、部署順序、無 migration 回滾與資料最小化經核對並留下證據。

## 執行紀錄

- 使用者已確認此拆分與依賴；尚未開始實作。前置 tickets 均 resolved 後才可 claimed；驗收通過且整合後才可 resolved。
