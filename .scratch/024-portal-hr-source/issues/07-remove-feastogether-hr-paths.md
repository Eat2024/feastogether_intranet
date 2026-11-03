# 07: 移除饗賓人三條人資路徑

**What to build:** intranet 不再保留任何呼叫饗賓人 `hr/org_chart`、`hr/staff_lookup`、`hr/staff_emails` 的程式，也不留 fallback 或開關。`staff/login` 與 WebView token 驗證照舊。

**Status:** ready-for-agent

**Blocked by:** [02-org-chart-from-portal](02-org-chart-from-portal.md)、[03-login-staff-from-portal](03-login-staff-from-portal.md)

**Size:** S

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T029–T032；FR-010、FR-011；SC-001。

## Acceptance Criteria

- [ ] 饗賓人 HR 服務的員工查詢與信箱方法、部門服務的組織樹方法、信箱解析器及其測試都已刪除。
- [ ] 饗賓人 client 中這三條路徑的特例（omitBody、envelope 檢查、`staff_lookup` 特例、「人事來源回應格式錯誤」log）都已移除；`staff/login` 的測試仍通過。
- [ ] `server/src` 搜尋不到這三條路徑；測試中只剩「呼叫數為 0」的斷言；饗賓人模組只被 auth 使用。
- [ ] client 可見的錯誤碼與訊息不變。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。
