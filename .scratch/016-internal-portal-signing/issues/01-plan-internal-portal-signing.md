# 01：規劃員工從 Portal 登入後於我的電子簽完成簽署

**What to build:** 依 CR-016 產出前後端實作計畫、API 契約及依賴排序的工作項目，確認 Portal 銜接與內部 Email OTP 切換方式。

**Blocked by:** 無；Portal 導頁契約的未確認項目須於規劃中列明，不可假設已支援。

**Status:** claimed

**Spec:** [CR-016](../../../../specs/016-internal-portal-signing/spec.md)

本票為規劃工作，非已完成實作。開始工作改 claimed；驗收並整合後才改 resolved，追加驗證與 commit 紀錄。使用本機 Markdown，不建立 GitHub Issues。

- [x] 調查 Portal 登入入口、電子簽 session 與導覽契約；確認需要 Portal 配合，詳見 spec 同目錄 `research.md`。
- [ ] 規劃 Portal 固定目的地保留、登入成功自動返回、改密碼後接續、成功／登出清除及一般登入回歸；於 UAT 驗證完整網址、權限與 iframe session。
- [ ] 登入入口採 `login?redirect_to=hr/esign/mine`；涵蓋 GET 驗證與 session 保存、POST 重試、已登入分支、不合法參數及無參數一般登入。只接受此固定路徑，不新增通用回跳功能或代碼別名。
- [ ] 盤點內部閱讀、開啟、簽署、拒簽、結果及本人副本的 API 與授權檢查，定義前端串接及錯誤狀態。
- [ ] 定義內外部邀請、催簽、補簽的寄信分流與既有通知佇列切換方式。
- [ ] 依 grilling 決策取消「內部員工缺 Email 阻擋整份發起」；保留指派並略過寄信，不記為成功，涵蓋邀請／催簽／補簽。人資通知與補信箱流程不在範圍，上游故障及外部 Email 驗證規則維持。
- [ ] 內部授權接受所有正式支援的有效員工 session，不額外限定 Portal 來源；不因此提前實作 Spec 014。
- [ ] 定義既有內部指派、舊邀請及舊 OTP cookie 的切換行為，確保外部流程不變。
- [ ] 核對簽署證據驗證來源與欄位相容性；列出實際所需 migration/config，無需求則不新增。
- [ ] 依 CR 更新憲章適用範圍與衝突契約，保留歷史交付紀錄；協調 Spec 014 的內部 OTP 敘述。
- [ ] 產出依賴排序的前端、後端、通知、切換與驗收工作；涵蓋 CR 全部驗收情境及 Portal 整合證據。

## 紀錄

- 2026-10-28：tasks 階段使用者確認內部邀請／催簽／補簽採 BCC 群寄，外部與 OTP 維持逐人。已同步 spec、plan、data-model、research、contracts、quickstart，產出 47 項 `tasks.md`，含群組投遞、逐地址部分結果、舊 queue 與 maintenance 恢復。任務尚未執行；不改原驗收清單或宣稱環境測試完成。

- 2026-10-28：依使用者需求建立 CR 與規劃 ticket；已查閱本機前後端阻擋及寄信實作，尚未修改程式或驗證正式 Portal。
- 2026-10-28：使用者確認登入後須自動抵達「我的電子簽」。Portal 本機調查確認既有嵌入導頁可沿用，缺口在登入與改密碼的目的地保留；未修改 Portal 程式。
- 2026-10-28：Grilling Q1、Q2 採建議；Q3 由人資通知無 Email 員工自行登入 Portal。同步修訂 spec 授權來源、舊流程切換與無信箱發起規則，未修改程式。
- 2026-10-28：已切換 PR #34 分支完成 speckit-plan Phase 0／1，產出 plan、data-model、三份 contracts、quickstart，擴充 research 並修訂憲章。使用者指定電子簽 UAT／PRD 都導 Portal 正式機；不新增環境變數。原驗收清單保留，含真實環境驗收及 tasks 拆分者尚待後續；未提交／合併，故不標 resolved。

- 2026-10-28：實作 tickets 02／04～09 已在本機整合並完成回歸與雙向審查；程式 `5abefa1`、Portal `961ed6a8`。原清單「只接受固定路徑、不新增通用功能」屬先前決策，已由使用者後續要求及 FR-003b 的通用允許清單取代，保留文字作歷史，不作現行限制。驗證見 specs/016-internal-portal-signing/validation.md；03／10 與 T011／T045 真實環境驗收仍待完成，未推送或部署。
