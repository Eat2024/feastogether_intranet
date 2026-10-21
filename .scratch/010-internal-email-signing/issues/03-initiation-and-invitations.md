# 03: 發起文件並寄送內部員工邀請

**What to build:** 建立人以內部或混合名單發起文件時，後端重新核對並固定所有員工信箱，成功後逐人寄送專屬邀請；任一員工無有效地址時整份保持草稿。

**Blocked by:** 01 內部員工選取與帳號解析；02 員工 Email 批次查詢與發起前檢查。

**Status:** claimed

**Spec:** 010 — US1、US2 的邀請部分、FR-004～006、FR-014～017。對應 T003、T005、T006、T015～T017、T025、T026，以及 T009 的發起／交易測試與 T004 的發起錯誤；在 01／02 的基礎上完成 T001、T002 尚缺的 migration、mailer fixture。worker 世代基本保護由本票完成，補簽競態深化由 07 負責。

**執行約定:** 前置均 resolved 才開始；依核准的垂直切分先完成本票 worker，不等待原 tasks 中較晚的 OTP 步驟。僅後端、必要既有表 migration 及契約，不修改 client、不部署。驗收並整合後才 resolved，追加驗證與 commit 紀錄。

- [ ] 草稿可保存缺信箱的內部員工，拒絕手填覆寫內部地址；外部地址既有正規化與去重不變。
- [ ] 調整既有 signer 約束，保留內部 userId／員工快照及既有 user、token 唯一性；以 generated external_email 的文件內唯一性保留外部去重，允許不同內部員工共用地址及內外部同地址。
- [ ] entity、schema 與 migration 一致，不新增資料表或回填歷史資料；隔離 MySQL 驗證 up→down→up，新內部信箱／邀請資料不相容時 down 必須在 DDL 前拒絕且資料不變。
- [ ] 發起使用完整名單與欄位，於文件交易外重新查信箱；零內部人員不查 HR。交易內再驗草稿、建立人、帳號有效性及 userId→員編映射，異動回 409。
- [ ] 缺有效地址回 422、來源失敗回 502，均無部分 active、通知或稽核；固定 email 後才建立既有 schemaVersion 2 snapshot/hash，不重算歷史證據。
- [ ] 每筆內外部指派各建邀請、世代與通知紀錄，和發起狀態同交易保存，提交後入列；相同 Email 不警告、不阻擋、不合併，未來開始的文件也在發起時寄邀請。
- [ ] worker 支援內部指派，claim／finish／fail 核對邀請世代，成功清除對應邀請密文；建立人詳情顯示各人寄送狀態。SMTP 失敗不撤銷已成功發起文件，沿用既有重試／補償。
- [ ] HTTP 發起原子性、同地址逐人邀請、回應遺失後查詳情、來源等待不持文件長鎖、worker 寄送與 schema 測試通過。可獨立展示寄送，但完整 OTP 簽署須待 04，不宣稱此時已完成簽署流程。

## 實作與驗證紀錄（2026-10-21，待整合）

- 分支 `feat/010-ticket-03`，基於整合分支 `7d0c764`（01、02 resolved）。依已確認的 HTTP、worker、schema seams 執行 TDD。
- Red→green：共用內部信箱先因舊 CHECK 失敗，完成 derived external unique/migration；migration 前置不符原本留下半套 DDL，增加 DDL 前 fail-closed 檢查；HTTP 內部固定地址、拒絕手填、來源途中停用 409、worker 內部寄送、在途舊世代成功／失敗不得覆寫，以及詳情不得顯示不符世代通知均先看到失敗再修正。
- HTTP 覆蓋 101 人為 100＋1 批、來源缺漏 422／失敗 502 全份不變且沒有通知或發起稽核、HR 等待期間另一個草稿 PATCH 可完成（無文件長鎖）、v2 payload 固定 Email、零內部不查 HR、非建立人先拒絕、未來開始仍逐人寄信與 SMTP 失敗維持 active。所有輸入／郵件均為合成測試資料。
- MySQL schema：8 tests，包含 up→down→up、零 drift、內外部同地址、外部 duplicate 拒絕、有內部邀請時 down 拒絕且資料不變、前置 schema 不符時不執行 DDL。
- 已同步必要舊 e2e 的合成 HR 信箱替身、寄信數量及測試資料清理；未跳過既有案例。新 suite 已加入正式 e2e whitelist。
- 驗證指令均由 worktree 使用 `pnpm --config.verifyDepsBeforeRun=false -C server`：`test --runInBand`（104 suites／896 tests）、`test:e2e`（20 suites／177 tests）、`test:e2e:security`（7 suites／34 tests）、`test:schema`（2 suites／8 tests）、`build` 通過；`lint:check` 0 errors（既有及 fixture warnings 保留）。
- 歷史邊界：不回填舊通知。pre-010 初始邀請 log 若沒有 invitationGenerationSha256，無法證明與目前 token 同世代，worker／補償掃描 fail closed 不寄；既有已寄外部連結及 OTP 不因這項檢查失效。此限制不得以 null fallback 繞過，後續交付文件應明確列出。原始通知稽核資料保留。
- 尚未實作內部 OTP 授權（04）、副本（05）、混合催簽（06）或補簽（07）；沒有修改 client、新增 table/dependency/env、連真實 HR／SMTP 或部署。驗收及合併紀錄由 merger 追加，再改 resolved。
