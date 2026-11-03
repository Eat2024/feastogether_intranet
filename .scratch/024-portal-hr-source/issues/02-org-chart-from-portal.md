# 02: 選人部門樹改由 Portal 提供

**What to build:** 建立人開啟選人時，部門樹改由 Portal 的部門與人員資料組成，組樹規則照饗賓人現行行為。回應格式、授權、30 分鐘快取與錯誤碼都不變，饗賓人 `hr/org_chart` 故障不再影響選人。

**Status:** ready-for-agent

**Blocked by:** [01-portal-connection](01-portal-connection.md)

**Size:** L

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T007–T013；US1；FR-004、FR-005、FR-011；SC-002、SC-007。

## Acceptance Criteria

- [ ] 組樹規則與 fgapi 一致：只包含未停用部門與正式員工；上層不存在或已停用時成為根節點；子部門員工不複製到上層；對不到部門的員工不列入，只記人數。
- [ ] 部門代碼空白或重複、形成循環、深度超過 100 層時，回傳 502 `ORG_CHART_UPSTREAM_UNAVAILABLE`，不寫快取；合法的空資料回傳空陣列並快取。
- [ ] 快取 1,800 秒、讀取不續期；未登入一律 401；快取命名空間改為 Portal 來源，舊的饗賓人快取自然不再命中。
- [ ] 部門表無法讀取或 Portal 不回應時，15 秒內回傳 502；登入不受影響。
- [ ] 測試期間呼叫饗賓人 `hr/org_chart` 的次數為 0；寄信白名單的 e2e 對任何 `hr/*` 呼叫都會失敗。
- [ ] `EsignModule` 不再依賴饗賓人模組；回應中不出現哨兵欄位的值。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。
