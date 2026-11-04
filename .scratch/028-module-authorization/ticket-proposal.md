# 028 tickets 拆分提案（待確認）

本提案依 to-tickets 的 vertical slice 規則產生；尚未建立正式 issues，也未宣告任何實作完成。每張包含可驗證的行為、阻擋關係與驗收條件。程式細節與精確檔案位置留在原 tasks，不複製到 tickets。所有編號為提案識別；外部 027 編號需與其提案一起確認。

1. **028-01：可重跑的授權目錄初始化**。Blocked by：027-03（隔離 REPL／有效維護 context）。交付：維運者明確初始化隔離目錄、角色與稽核，再次執行不破壞自訂設定。
2. **028-02：同一會話查詢即時有效能力**。Blocked by：028-01、027-04（Super HTTP 登入，已含 actor/session 與隔離 REPL）。交付：員工與 Super 從 HTTP／REPL 查目前能力，多角色聯集、baseline 與跨功能隔離一致；供 029 消費。
3. **028-03：同仁可閱讀與本人簽署，受限操作全部拒絕**。Blocked by：028-02、027-05（OAuth/WebView 共用會話）。交付：基本員工電子簽閉環及本人副本保護，沒有一般建立／匯出或代簽能力。
4. **028-04：Super 維護角色與權限並查稽核**。Blocked by：028-02、027-07（維護憑證世代核對，已含 Super 登入）。交付：API／REPL 的一般角色 CRUD、配權、查詢與原子稽核。
5. **028-05：預先指派有效員工角色與即時撤銷**。Blocked by：028-04。交付：未登入員工可經 Portal 查核預建同一身分、CAS 指派／撤銷，多實例下一請求生效。
6. **028-06：Super 與管理員建立及管理跨部門文件**。Blocked by：028-03。交付：真 actor 建檔／編輯／跨部門閱讀，Super 必須指定有效部門，既有 client 能顯示真實建立者。
7. **028-07：管理者執行文件生命週期並保留真實操作者**。Blocked by：028-06。交付：發起、重試、停止、補簽與提醒連到 worker，既有狀態與證據限制不變。
8. **028-08：授權一般匯出與下載，封閉個人副本旁路**。Blocked by：028-06。交付：一般匯出／歷史／重試／下載依即時能力與範圍判斷，Super 真 actor，不能藉歷史下載他人副本。
9. **028-09：完成核定指派與完整保護切換驗收**。Blocked by：028-05、028-07、028-08、027-08（登入安全整合驗收）。交付：保留舊會話／資料的可演練切換，完整端點覆蓋與回復保護。

## 028-01：可重跑的授權目錄初始化

**Blocked by:** 027-03：隔離 REPL 初始化與維護身分驗證。

**What to build:** 維運者透過現有隔離 console 明確初始化目前兩個子功能的權限目錄與三個初始角色；重跑有確定結果，既有角色設定及歷史資料安全保存。

**Acceptance criteria:**

- [ ] 正式目錄只有 esign／platform 與已確認的 12 項能力，platform 管理能力不可指派；同仁初始能力固定，另有文件建立者及電子簽管理員。
- [ ] 真 MySQL 拒絕跨子功能角色權限／指派，同 module 同名競爭只能成功一次；停用角色占名，刪除後名稱可重用而 code 永不重用。
- [ ] 角色、權限與兩種關聯具正確唯一鍵、軟刪除恢復及 scope FK；不以 JSON／單一 users.role 取代多角色關聯。
- [ ] 明確 sync 執行才寫入；HTTP startup／GET 不自動初始化。第二次 sync 不重設一般角色自訂能力或停用狀態，不插重複關聯或 no-op audit。
- [ ] 目錄初始化、變更與必要裁切稽核同交易，audit 失敗全部回滾，不保存員編、憑證、文件、簽名。
- [ ] 空測試庫 up/down/reapply 通過；已有授權稽核或受保護資料時拒絕破壞性 down。維護 context 過期不得繞過執行。

**Task coverage:** T001、T002、T003、T004、T005、T006、T007、T008、T009、T010。

## 028-02：同一會話查詢即時有效能力

**Blocked by:** 028-01；027-04：Super HTTP 登入，已傳遞包含 employee／super_user actor、有效 session 與隔離 REPL。

**What to build:** 當前操作者可查自己的最小有效能力，維運者可辨識 baseline 與 explicit 來源；後端逐請求讀取角色聯集，作為後續業務與選單的共同授權來源。

**Acceptance criteria:**

- [ ] 新／既有有效員工沒有任何指派也有固定同仁能力，已有額外角色仍保留同仁，GET 前後沒有新增關聯。
- [ ] 多角色能力取聯集，重複 grant 撤一個仍保留；跨 module 同名角色不互授，停用／刪除／不在 compiled catalog 的 grant 排除。
- [ ] Super 回全部已登錄能力；employee 停用／刪除或 session 無效仍拒絕。角色名稱、cookie、前端傳入值不能決定能力。
- [ ] 本人能力契約只含 actor 與排序去重 modules／permissions，no-store，不含完整角色、其他員工或任何憑證，供 029 直接使用。
- [ ] 角色／權限／指派異動提交後，兩服務實例的舊 session 下一請求讀到新權限；交易目前讀沒有長快照或授權快取回退。已受理工作不承諾取消。
- [ ] guard 明確區分登入即可、全部／任一能力與 Super-only；403 不等同失效登入，資源不可見仍404，catalog／DB 不可用503。
- [ ] REPL 有效能力查詢與 HTTP 同 resolver，清楚標出 baseline／explicit；讀取不自動 sync、不依賴即時 Portal。

**Task coverage:** T011、T012、T013、T014、T015、T020、T021、T022、T023、T053。

## 028-03：同仁可閱讀與本人簽署，受限操作全部拒絕

**Blocked by:** 028-02；027-05：OAuth／WebView 共用正式會話。

**What to build:** 有效同仁可完成同部門閱讀和本人簽署／拒簽／副本流程；後端所有既有電子簽入口依能力保護，不讓未授權建立、匯出或個人副本旁路通過。

**Acceptance criteria:**

- [ ] 無額外角色員工可讀同部門既有可見狀態的列表／詳情／來源 PDF；仍裁切簽名、邀請及敏感欄位，不可見資源不洩漏存在。
- [ ] 本人跨部門簽署、拒簽與副本依本人指派、期限、狀態與證據規則判斷；缺可信部門不會一律否定另行成立的本人資格。
- [ ] 同仁不能建立／管理文件、查候選人目錄、一般匯出、export view、一般歷史／下載；全部入口有對應能力，服務分支不能用寬鬆 OR 放行。
- [ ] 同部門也不能取得別人的個人副本，含既有 departmentFile 與 pdf 歷史；管理員／Super 不能代簽或代拒簽。
- [ ] 外部邀請／OTP 與公開驗證保持原邊界，Super cookie 不產生外部本人資格。
- [ ] OAuth／WebView 的同一種 session 均通過正向與負向 e2e，未完成 actor 改造的 Super 業務仍拒絕。

**Task coverage:** T016、T017、T018、T019。

## 028-04：Super 維護角色與權限並查稽核

**Blocked by:** 028-02；027-07：有效維護憑證世代，已傳遞包含 Super 登入。

**What to build:** Super 可由 API 或 REPL 查目錄、建立與維護一般角色、配置權限並核對必要稽核，兩種入口遵守相同的版本與範圍規則。

**Acceptance criteria:**

- [ ] 只有有效 Super HTTP actor 或有效隔離維護 context 能管理；一般員工／電子簽管理員一律403，寫入驗 Origin，管理結果 no-store。
- [ ] 角色名稱修整後1～100字、code由後端產生且不可變，未知輸入拒絕；角色與 permission 查詢、分頁、詳細、建立、更名、停用及刪除符合契約。
- [ ] 每次實質更動驗 expectedVersion，過期409；無變更不加版／audit。同名409；仍被指派不可刪，停用保留關聯卻不授權。
- [ ] permission 完整集合只接受同 module 已登錄可指派項目，modifier 具同角色 base；同仁不得改／停／刪，platform 維護權不能指派，不能動態新增權限／子功能。
- [ ] API／REPL 共用服務與交易；成功與 audit 同時存在、失敗均回滾，查 audit 僅白名單差異且沒有修改／刪除入口。
- [ ] 正負契約驗收涵蓋輸入上限、未知欄位、安全 ID 序列化、版本與名稱衝突，不做管理前端。

**Task coverage:** T024、T026、T027、T028、T032、T033。

## 028-05：預先指派有效員工角色與即時撤銷

**Blocked by:** 028-04。

**What to build:** Super 以員編查核未登入員工並配置單一子功能多角色；同一員工只建立一次，撤銷即時生效且必要差異可追查。

**Acceptance criteria:**

- [ ] 員編只從 body 進入，1～32字且保留大小寫／前後字元；Portal 必須唯一 exact-match 有效員工，不用舊資料 fallback。
- [ ] 不存在／失效／模糊422、Portal故障502、本地停用或刪除403且不復活；目標錯誤不使有效 Super session 被判401登出。
- [ ] 首次登入與預指派競爭只得到同一 user ID；角色集合單 module、最多50／不重複、只一般角色，不把 implicit 同仁放進可改 roleIds。
- [ ] 依固定鎖序與 expectedRoleIds CAS；同目標 no-op，不同版本409，撤銷 soft-delete／重授恢復同列，不重複關聯。
- [ ] 新 user、關聯與 audit 原子提交；audit 故障沒有半套身分或指派；刪除角色與新增指派競爭仍正確。
- [ ] API／REPL 相同結果、角色成員與員工角色查詢最小化；兩實例舊 session 下一請求立即更新能力，同仁始終保留。

**Task coverage:** T025、T029、T030、T031、T034。

## 028-06：Super 與管理員建立及管理跨部門文件

**Blocked by:** 028-03。

**What to build:** 一般建立者維護自己的文件，具有明確能力的管理者可合法跨部門閱讀及編輯；Super 以自身維護身分建立文件並指定有效歸屬部門，前端既有列表能正常呈現。

**Acceptance criteria:**

- [ ] 文件、欄位與簽署人編輯保存 employee／super 真 actor；Super 員工 FK 為 NULL，不造假 user，不更改指定簽署人的員工關聯；NULL-aware CHECK 拒非法組合。
- [ ] 歷史有 user 記 employee、原空稽核 slot 記 legacy_unknown；document 舊最後管理者保留未知，不補造歷史，不修改人事共用稽核行為。
- [ ] Super 建立必填1～50字有效 departmentCode，Portal exact-match 取可信名稱，無效400／上游503；employee 不接受部門覆寫。
- [ ] 管理他人文件只放寬建立人／部門，保留原 creator／department、所有狀態、鎖與證據限制，寫入重新核對目前能力。
- [ ] role=all 必須 read-all，Super 預設 all、員工維持原範圍；任意 department query 不可越權。
- [ ] 既有 client 僅調整 actor DTO／nullable顯示及 super送all／employee送dep；顯示 Super user 而非假員編、0或undefined，不新增管理UI。
- [ ] 真 schema 與文件管理 e2e 通過，既有關聯／證據保持；有新受保護資料拒絕破壞性 down。

**Task coverage:** T035、T036、T037、T038、T039、T040、T041、T042。

## 028-07：管理者執行文件生命週期並保留真實操作者

**Blocked by:** 028-06。

**What to build:** 管理員／Super 對合法文件完成發起、重試、停止、補簽與提醒，背景工作沿真實受理操作者執行，不冒寫原建立者。

**Acceptance criteria:**

- [ ] 發起 job 和通知保存真 actor，employee 有 user、super／system 無 user，歷史可證明值正確回填且 schema CHECK 拒非法組合。
- [ ] worker 取持久化 job actor，不拿 document creator 冒充操作者；同 job retry 不改原 actor，新 job 才記新提交者。
- [ ] 所有流程驗 manage 與原建立人或 manage-all，狀態／期限／工作鎖／通知節流與證據規則不被 Super 繞過。
- [ ] poll、issues、input、retry 重新核對當前能力；已受理工作可完成，但撤權後的後續存取不可沿舊權限。
- [ ] 端到端跑 HTTP 到 worker 到可查結果，輸出真實 actor 且無個資／簽名／邀請洩漏，原 creator／department 不變。

**Task coverage:** T043、T044、T045、T046、T047。

## 028-08：授權一般匯出與下載，封閉個人副本旁路

**Blocked by:** 028-06。

**What to build:** 一般匯出與下載依明確 read/create/all 能力及資料範圍執行，保存真正匯出者；本人副本保持獨立資格，不能藉歷史路徑冒領。

**Acceptance criteria:**

- [ ] 一般 excel／zip 只 employee 或 super；pdf 本人副本只 employee／external 且 signer 非空，Super 不可建立本人 pdf 紀錄，DB CHECK 明確處理 NULL。
- [ ] 匯出產生、重試與既有檔下載記錄按實際分支要求 create 或 read；跨部門需 export.all 搭配 base，來源查詢亦受保護。
- [ ] worker 保存真實提交 actor；已受理工作可完成，後續 job／歷史／檔案查詢、retry與download逐次驗當前能力與範圍。
- [ ] pdf歷史與個人副本只給本人，即使管理者／Super 有全部一般匯出能力也不能繞過；外部憑證不被員工權限取代。
- [ ] 既有輸出 DTO／client nullable相容、姓名顯示Super user、檔名不出現undefined；真 worker 產檔與下載完整性驗收通過。

**Task coverage:** T048、T049、T050、T051。

## 028-09：完成核定指派與完整保護切換驗收

**Blocked by:** 028-05、028-07、028-08；027-08：登入與維護安全整合驗收。

**What to build:** 維運依核定名單及可演練流程切換新授權版本，保留既有身分／會話／文件／證據；所有入口確實受保護，失敗不回退全域放行。

**Acceptance criteria:**

- [ ] 備份副本驗證 schema、兩次 sync／指派冪等、原 user ID／關聯／證據保持；既有員工只自動同仁，禁止從歷史建立／匯出行為升權。
- [ ] 上線前核定必要角色指派與 resolver 核對完成；repository 不儲存員編名單或秘密。
- [ ] 明確停止舊 HTTP／worker，新實例全部同 schema／catalog 版本才接流量，不混跑舊放行版本，不新增永久flag或fallback。
- [ ] catalog 不完整或任一路由漏明確分類時拒絕 readiness；實際 HTTP 驗證所有路徑的身分／能力／資源政策，不只看metadata。
- [ ] 既有 session 免重登、撤權下一請求、真 Super 業務 worker、外部簽署／公開驗證／檔案／證據回歸全部有結果；403／目標422不錯誤登出。
- [ ] response／log／audit 無憑證、員編body、完整入口、Portal raw error、簽名；不恢復已移除的簽署事件歷程。
- [ ] 只有無需保存新資料的空測試庫可down；正式以向前修復或一致備份回復保護 audit／Super 資料，失敗保持停用不全域放行。
- [ ] 適用 server lint／unit／e2e／security／schema／build 與 root client相容 build／lint完成；不能執行者明列環境限制，不以mock宣稱通過；029能力契約一致。

**Task coverage:** T052、T054、T055、T056、T057、T058、T059、T060。

## 拆分與依賴說明

- 9 張 tickets 均交付完整可測行為；資料表與 DTO 不各自成為無使用情境的水平 tickets。028-01 的展示入口是 REPL 明確初始化及真 DB 約束驗證。
- 028-06 可用明確測試 fixtures 驗證，不必等待所有管理 CRUD 完成；正式切換仍必須 028-05 的核定指派能力。
- 028-07 與 028-08 行為可並行，schema snapshot／共用 mapper 的編輯需協調整合，不宣稱沒有檔案衝突。
- 028-02 完成就是 029 本人能力消費的後端前置；029 不須等待全部業務改造即可開發，正式交付則需完整後端保護。
- 原 tasks phase 是預設 story 順序；本提案將 T053 唯讀維運查詢提前到共同能力切片，無產品範圍變更。
- 每個 task 恰有一個主要 ticket，合計 60 項，沒有遺漏或重複。驗收可跨 ticket 回歸，但不重複宣告任務所有權。

## 待使用者一次確認

請確認以上粒度是否合適、阻擋關係是否只保留真正前置，以及哪些需要合併／再拆。確認後才依本機 tracker 規範建立一張一檔的正式 tickets。
