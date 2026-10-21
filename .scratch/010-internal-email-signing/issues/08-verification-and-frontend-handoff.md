# 08: 整體驗收與前端串接交接

**What to build:** 將已整合的內部與混合簽署流程完成跨功能驗收，提供前端 agent 可依循且與實作一致的契約，清楚區分後端完成與尚未實作的畫面。

**Blocked by:** 05 簽署後透過 OTP 取得個人副本；06 內外部簽署人混合催簽；07 重新開放簽署並寄送新邀請。

**Status:** resolved

**Spec:** 010 — SC-001～008、全部 FR 的交付核對，尤其 FR-015～018。對應 T018 的容量驗證、T039～T044，並完成 T034 延後至真實副本流程的回歸。T001～T017、T019～T038 已分配至 01～07；T004、T009、T018、T034 的分工依各票註記，未完成完整任務前不可將原 tasks 整項勾選。

**執行約定:** 所有前置 resolved 後才整體驗收；本票不是將前票必要測試延到最後的理由。僅後端必要修正與交接文件，不實作 client、不新增遠端 issues／PR、不部署；驗收且整合後才 resolved，追加命令、結果及既有 commit 紀錄，不將建立票單視為提交或發布授權。

- [x] 以合成內部及混合名單完整驗證選人→信箱檢查→發起→邀請→OTP→簽署／拒簽→副本下載，及催簽、補簽後的新舊授權，外部流程回歸通過。
- [x] 驗證補簽只更新待簽者，已簽者原邀請重新 OTP 後仍下載相同副本，證據 hash 不變；SMTP 失敗不回退已發起／補簽狀態，重送不重複建立批次。
- [x] 以 1、100、101、6,000 人量測員工解析與信箱核對，6,000 人信箱為 60 批、每批最多 100、併發不超過 4，無誤配、缺漏被忽略或部分發起；記錄耗時、記憶體與請求／代理期限風險，不擅自增加背景發起。
- [x] 再驗組織樹 Redis 7,200 秒快取命中不續期、過期按需更新；信箱查詢不套用該快取，不新增排程、fallback、環境變數、依賴或資料表。
- [x] access／application log 與 audit metadata 不洩漏員編清單、Email、OTP、token、cookie 或簽名；發現缺口只作本需求必要修正。
- [x] 更新受影響的舊免 OTP 成功假設，保留拒絕驗證及 Email 成功流程；確認新測試實際收錄，不刪除／跳過安全測試，不回填、刪除或改寫歷史證據。
- [x] 在隔離 MySQL／Redis 執行 server lint:check、unit、build、schema、e2e、security 及容量驗證；記錄實際命令與結果。無法執行的項目保持未完成並列風險，不以 mock 通過替代真實資料庫驗收。
- [x] 核對 Swagger 與三份既有串接契約，涵蓋實際方法／路徑、request／response、錯誤 details、兩種認證、cookie／表單、GET 唯讀、舊個人入口 403、補簽自動寄信及空清單語意；只將已驗證 API 標為交付。
- [x] 前端交接明列選人解析、草稿／信箱狀態、發起錯誤、邀請／OTP、簽署／拒簽、產製輪詢與下載、催簽／補簽的串接順序；前端不直連 fgapi、不用登入略過 OTP、不依 Email 合併人員。
- [x] 完成 FR／SC 對照及原 spec、tasks、checklist、quickstart 的真實狀態更新，交付摘要分列後端、migration、config 無新增、前端未實作及未驗證限制；桌面／手機畫面、完整登出既有限制及 UAT／PRD 部署不宣稱完成。

## Ticket 08 實作與驗證紀錄

- 基底：整合分支 f8a5d65；Tickets 01～07 均已 resolved。狀態維持 claimed，等待 merger 合併後才 resolved。
- TDD：先以失敗測試重現 staff_lookup success=false 任意code進日誌，再省略該敏感來源code；Email受限路徑query/body亦先重現3例，再沿用既有排除機制修正。沒有引入logging框架。
- 新增真實HTTP/MySQL/Redis容量suite 7例，1/100/101/6000解析與信箱核對、6000末批失敗原子性及成功快照／6000逐人通知／真正queue入列。每批100、最多4併發。6000完整段8485ms（含後置核對）；完整量測與限制記quickstart，不代表真HR/代理SLA。
- 補簽後已簽者原邀請OTP下載相同PDF與證據不變新增於既有copy suite；待簽舊token/cookie失效。所有安全案例保留。
- 修正容量測試teardown：只移除本次明確ID的DB fixture、來源檔案、帳號session與queue job；斷言零owned pending job，避免maintenance重補干擾其他suite。首輪3例隔離失敗已完整重跑，不放寬斷言或刪除案例。
- 最終命令（皆帶 pnpm --config.verifyDepsBeforeRun=false -C server）：test --runInBand 104 suites/941；build通過；lint:check 0errors/205warnings（基準202、前票單增加3，本票修改檔無新warning）；test:schema 2/8；test:e2e 23/207；test:e2e:security 9/45；容量單跑1/7，全部通過。git diff --check通過。
- 44項tasks按實際路徑／測試逐項對照，spec/plan/research/data-model/quickstart與三份契約更新；品質checklist16個標記未變。前端未改，沒有新增env/table/dependency/cron/fallback，沒有部署或真實HR/SMTP；代理期限、冷匯入速度及完整登出限制明列。
- commit及merge紀錄由整合者追加；此紀錄不是部署完成宣告。

## 整合驗收紀錄（2026-10-21）

- 實作 commit `844d61d` 以 `--no-ff` 合入 `feat/010-internal-email-signing`，merge commit `39ff98b`，無衝突；01～07 均已整合且 resolved。
- 合併者核對 44 項 tasks 與實際測試／路徑證據對照、三份契約及前端交接界線；容量記錄明確區分本機已建帳、合成來源、非峰值記憶體及未驗證代理時限，不把容量成功視為真實 HR／SMTP 或畫面驗收。
- 整合分支 `pnpm --config.verifyDepsBeforeRun=false -C server test --runInBand 'http-access-log.interceptor.spec.ts|feastogether.client.spec.ts'`：2 suites／31 tests 通過；`test:e2e --testPathPatterns='internal-email-capacity|internal-email-copy'`：2 suites／15 tests 通過，包含真實 6,000 人發起／入列與補簽後原已簽副本不變。容量 fixture 清理僅限本次擁有資料及 jobs，共用 DB／Redis 完成後釋放。
- 同一程式碼樹完整 unit 104／941、e2e 23／207、security 9／45、schema 2／8、build 與 lint 零 errors 證據如上，`git diff --check` 通過。十項驗收完成，改 resolved；主協調者仍須執行獨立雙軸 code-review，尚未清理 worktrees 或部署。
