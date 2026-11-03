# 02: 寄送政策套用信箱規則

**What to build:** 非 production 寄信時，命中信箱規則的完整地址直接允許；收件人全部命中時不查人資來源。外部簽署人的邀請、催簽與 OTP 因此可寄給明確列入的外部測試信箱，其他地址仍被阻擋。

**Blocked by:** 01-email-rule-schema

**Status:** ready-for-agent

**Source:** [Spec 021](../../../specs/021-external-mail-whitelist/spec.md)、[Plan](../../../specs/021-external-mail-whitelist/plan.md)、[Tasks](../../../specs/021-external-mail-whitelist/tasks.md)。

**Scope:** US1、US2，對應 T007–T013。

- [ ] 政策服務讀取 `email` 規則，以正規化後的完整地址精確比對；同網域其他地址、plus alias、子網域、相近地址阻擋。
- [ ] 收件人全部命中信箱規則時，組織樹與 `staff_emails` 查詢 0 次，人資來源故障也允許；仍有未命中者時沿用 Spec 018 解析並取聯集，人資故障時整次 check-failed。
- [ ] 不修改 guarded sender、worker processor、OTP service、repository、seed 與 client；不新增 log、快取或環境變數。
- [ ] OTP e2e：信箱規則命中且人資來源故障時回 200、可驗證、`external_otp.sent` 一筆。
- [ ] Worker e2e：外部催簽命中信箱規則且人資來源故障時為 delivered。
- [ ] Spec 018 的 spec、data-model、contract 相關段落註明已由 Spec 021 修訂，不改寫歷史驗證紀錄。
- [ ] 執行 021 quickstart 全部指令並記錄結果；完成 Standards／Spec 雙軸 code review 並修正確認的發現。
- [ ] 驗收通過後整合至功能整合分支，追加驗證與 commit 紀錄，再改為 resolved。

## Comments & Implementation Results

尚未實作。後續結果追加於此，保留上述驗收條件。
