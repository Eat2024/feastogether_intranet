# 03: 三個登入入口的員工資料改讀 Portal

**What to build:** 同仁用帳密、饗賓人 App WebView 或 OAuth 登入時，員工資料改為即時查 Portal，並照現行規則更新本機員工資料。帳密仍先由饗賓人 `staff/login` 驗證；資格規則、錯誤碼與訊息都不變；新進同仁當天就能登入。

**Status:** ready-for-agent

**Blocked by:** [01-portal-connection](01-portal-connection.md)

**Size:** L：除了登入本身，還要把約 11 個 esign e2e 的登入替身一起改掉，否則它們會壞。

**Source:** [Spec](../../../specs/024-portal-hr-source/spec.md)、[Plan](../../../specs/024-portal-hr-source/plan.md)、[Tasks](../../../specs/024-portal-hr-source/tasks.md)、[Contracts](../../../specs/024-portal-hr-source/contracts/portal-source.md)。

**Scope:** T014–T019；US2；FR-006、FR-007、FR-011；SC-003、SC-004、SC-007。

## Acceptance Criteria

- [ ] 以完整員編精確比對（大小寫不同或尾端有空白的資料不算相符），必須剛好一筆試用或正式資料；0 對應「試用」、1 對應「正式」。
- [ ] 查無、多筆、其他狀態或欄位不合法時，回傳 `AUTH_EXCHANGE_FAILED`，不把資料寫入本機；Portal 失敗或逾時，15 秒內回傳 `STAFF_LOOKUP_FAILED`，不改查饗賓人，也不用本機舊資料放行。
- [ ] 帳密登入時，密碼通過但 Portal 顯示已非在職，拒絕登入；密碼錯誤與帳號停用的錯誤對應不變。
- [ ] 三個入口寫入本機的欄位與現行相同（OAuth 不寫人員狀態與職稱），也不寫本機部門外鍵。
- [ ] 三個入口的 e2e 改用合成 Portal，呼叫饗賓人 `hr/staff_lookup` 的次數為 0；其他 esign e2e 改用新的登入替身，且不再替身 `getStaffEmails`。
- [ ] 相關的 lint、單元測試、build 與 e2e 通過，並附上實際結果與未驗證的限制；整合到 `feat/024-portal-hr-source` 並追加 commit 紀錄後，才可以改成 resolved。

## Comments & Implementation Results

2026-11-03：只建立 ticket，尚未實作。ready-for-agent 不代表可以忽略 Blocked by；前置 ticket 都 resolved 後才能開始。實作結果追加在這裡。
