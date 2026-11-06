# 05: 預先指派有效員工角色與即時撤銷

**What to build:** Super 以員編查核未登入員工並配置單一子功能多角色；同一員工只建立一次，撤銷即時生效且必要差異可追查。

**Blocked by:** [028-04](04-role-permission-management.md)

**Status:** ready-for-agent

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T025、T029、T030、T031、T034。

## Acceptance Criteria

- [ ] 員編只從 body 進入，1～32字且保留大小寫／前後字元；Portal 必須唯一 exact-match 有效員工，不用舊資料 fallback。
- [ ] 不存在／失效／模糊422、Portal故障502、本地停用或刪除403且不復活；目標錯誤不使有效 Super session 被判401登出。
- [ ] 首次登入與預指派競爭只得到同一 user ID；角色集合單 module、最多50／不重複、只一般角色，不把 implicit 同仁放進可改 roleIds。
- [ ] 依固定鎖序與 expectedRoleIds CAS；同目標 no-op，不同版本409，撤銷 soft-delete／重授恢復同列，不重複關聯。
- [ ] 新 user、關聯與 audit 原子提交；audit 故障沒有半套身分或指派；刪除角色與新增指派競爭仍正確。
- [ ] API／REPL 相同結果、角色成員與員工角色查詢最小化；兩實例舊 session 下一請求立即更新能力，同仁始終保留。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
