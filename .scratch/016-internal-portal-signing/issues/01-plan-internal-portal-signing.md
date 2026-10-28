# 01：規劃員工從 Portal 登入後於我的電子簽完成簽署

**What to build:** 依 CR-016 產出前後端實作計畫、API 契約及依賴排序的工作項目，確認 Portal 銜接與內部 Email OTP 切換方式。

**Blocked by:** 無；Portal 導頁契約的未確認項目須於規劃中列明，不可假設已支援。

**Status:** ready-for-agent

**Spec:** [CR-016](../../../../specs/016-internal-portal-signing/spec.md)

本票為規劃工作，非已完成實作。開始工作改 claimed；驗收並整合後才改 resolved，追加驗證與 commit 紀錄。使用本機 Markdown，不建立 GitHub Issues。

- [ ] 確認 Portal 登入入口、電子簽 session 建立方式與前往 `/my-signature` 的導覽契約；列明是否需 Portal 端配合。
- [ ] 盤點內部閱讀、開啟、簽署、拒簽、結果及本人副本的 API 與授權檢查，定義前端串接及錯誤狀態。
- [ ] 定義內外部邀請、催簽、補簽的寄信分流與既有通知佇列切換方式。
- [ ] 定義既有內部指派、舊邀請及舊 OTP cookie 的切換行為，確保外部流程不變。
- [ ] 核對簽署證據驗證來源與欄位相容性；列出實際所需 migration/config，無需求則不新增。
- [ ] 依 CR 更新憲章適用範圍與衝突契約，保留歷史交付紀錄；協調 Spec 014 的內部 OTP 敘述。
- [ ] 產出依賴排序的前端、後端、通知、切換與驗收工作；涵蓋 CR 全部驗收情境及 Portal 整合證據。

## 紀錄

- 2026-10-28：依使用者需求建立 CR 與規劃 ticket；已查閱本機前後端阻擋及寄信實作，尚未修改程式或驗證正式 Portal。
