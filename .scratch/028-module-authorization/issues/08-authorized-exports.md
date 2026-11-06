# 08: 授權一般匯出與下載，封閉個人副本旁路

**What to build:** 一般匯出與下載依明確 read/create/all 能力及資料範圍執行，保存真正匯出者；本人副本保持獨立資格，不能藉歷史路徑冒領。

**Blocked by:** [028-06](06-cross-department-documents.md)

**Status:** ready-for-agent

**Source:** [Spec](../../../specs/028-module-authorization/spec.md)、[Plan](../../../specs/028-module-authorization/plan.md)、[Tasks](../../../specs/028-module-authorization/tasks.md)、[API 契約](../../../specs/028-module-authorization/contracts/api-behavior.md)、[權限目錄](../../../specs/028-module-authorization/contracts/permissions.md)、[維運契約](../../../specs/028-module-authorization/contracts/operations.md)

**Scope:** T048、T049、T050、T051。

## Acceptance Criteria

- [ ] 一般 excel／zip 只 employee 或 super；pdf 本人副本只 employee／external 且 signer 非空，Super 不可建立本人 pdf 紀錄，DB CHECK 明確處理 NULL。
- [ ] 匯出產生、重試與既有檔下載記錄按實際分支要求 create 或 read；跨部門需 export.all 搭配 base，來源查詢亦受保護。
- [ ] worker 保存真實提交 actor；已受理工作可完成，後續 job／歷史／檔案查詢、retry與download逐次驗當前能力與範圍。
- [ ] pdf歷史與個人副本只給本人，即使管理者／Super 有全部一般匯出能力也不能繞過；外部憑證不被員工權限取代。
- [ ] 既有輸出 DTO／client nullable相容、姓名顯示Super user、檔名不出現undefined；真 worker 產檔與下載完整性驗收通過。

## Comments & Implementation Results

- 2026-11-06：依使用者確認的拆分提案建立；尚未開始實作。前置 ticket 皆為 `resolved` 才可開始。
