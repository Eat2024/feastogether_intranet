# 04: 內部員工透過 Email＋OTP 簽署或拒簽

**What to build:** 員工不必登入內部入口網，即可從專屬邀請驗證 OTP 後閱讀、簽署或拒簽；一般員工登入與舊入口不能繞過驗證。

**Blocked by:** 03 發起文件並寄送內部員工邀請。

**Status:** resolved

**Spec:** 010 — US2、FR-007～012、FR-015～017。對應 T019～T024、T027、T028，以及 T004 的 ESIGN_EMAIL_OTP_REQUIRED。T025、T026 已由 03 完成；本票不重做邀請 worker。

**執行約定:** 前置 resolved 後執行，沿用現有 Email 通道與 cookie，不建立第二套登入。僅後端及契約，不修改 client、不部署；驗收並整合後才 resolved，追加驗證與 commit 紀錄。

- [x] user 與 email 指派都可使用既有 Email 通道，但必須具固定有效 email、正確文件關聯及邀請世代；保留內部 userId／類型／員工快照，不轉成外部人員。
- [x] 單純 GET 邀請不寄碼、不授予存取、不回文件內容；主動開啟才寄 OTP，開始前不寄碼，來源地址固定為發起時信箱。
- [x] OTP 為 6 位、10 分鐘、一次性、錯 5 次失效；所有寄碼入口共用 60 秒冷卻及每小時 5 封限制，新碼使舊碼失效，並發只成功消耗一次，寄信失敗不建立存取。
- [x] 驗證後使用獨立 credential 與瀏覽器 session cookie，期限 8 小時；只授權一人一文件，不建立員工 session、不接受邀請原值冒充 credential，同 Email 不同 signer 仍互相隔離。
- [x] 簽署／拒簽與寬等重送均拒絕 internal principal；舊個人 open、source、sign、reject、completed-file 本人回 403 ESIGN_EMAIL_OTP_REQUIRED，他人 404、未登入 401，保留列表 metadata 與建立人管理權限。
- [x] 驗證頁面 signer 與 cookie 身分，錯位回 409；保留同意版本、期限、狀態、拒簽規則與證據，新增證據使用 email_invitation，不改歷史 employee_session 證據。
- [x] 公開 task 的員編、部門、職稱為 null，不洩漏 userId、建立人或管理備註；驗證前只回遮罩地址，沿用既有表單、cookie 與 API 契約。
- [x] 邀請→OTP→簽署／拒簽 HTTP 測試通過，覆蓋重放、錯人／跨文件、Origin、過期、停止、刪除、舊入口與直接 service 繞過；不保留舊文件免 OTP 分支。

## 實作與驗證紀錄（2026-10-21）

- 狀態維持 claimed，等待 merger 合併整合分支後改為 resolved；實作 commit：`2ae6395`，已合併整合分支 `2e1f934`（含 Ticket 06）。
- TDD：內部 user 存取政策、一般登入簽署重放、一般登入拒簽及副本入口測試先紅後綠；以相同 ExternalAccess 測試驗證 user／email，未建立第二套驗證。新簽章只寫入 email_invitation，舊證據保留。
- 新增 HTTP 驗收涵蓋邀請 GET 唯讀、OTP 重放／錯五次／並發／同信箱隔離、獨立 session cookie、Origin、錯位、簽署重送、拒簽、公開裁切，以及舊五入口本人 403／他人 404／匿名 401。直接 service 的 internal principal 亦拒絕。
- 既有 core、拒簽、管理歷程、delivery-security 及容量 fixture 成功路徑改經 Email 通道；保留舊入口拒絕案例，不刪除或跳過安全驗收。core 過期案例的待簽者暫用外部指派，已簽內部副本仍驗證；內部補簽由 Ticket 07 完成。
- `pnpm --config.verifyDepsBeforeRun=false -C server test --runInBand`：104 suites／927 tests 通過。
- `pnpm --config.verifyDepsBeforeRun=false -C server test:e2e`：21 suites／183 tests 通過（一般測試規模，非宣稱 6,000 人容量驗收）。
- `pnpm --config.verifyDepsBeforeRun=false -C server test:e2e:security`：8 suites／37 tests 通過。
- `pnpm --config.verifyDepsBeforeRun=false -C server build` 通過；`lint:check` 0 errors／205 warnings（既有測試型別與 async 類警告）。
- 契約及 Swagger 已同步舊入口限制與 Email 共用通道。無 client、migration、依賴、環境設定或部署變更；HTTP 上游及信件均使用合成資料與 fake sender。

## 整合驗收紀錄（2026-10-21）

- 實作 `2ae6395`、同步整合 `87d974e` 與證據 `bb04f4c` 以 `--no-ff` 合入功能整合分支；merge commit `5dc862e`，無衝突，保留已結案 06 的催簽行為。
- 合併者核對固定有效地址／世代驗證、公開資料裁切、舊個人五入口與直接 service internal principal 拒絕，以及簽署寬等重送不能繞過授權；必要舊測試改經 Email 成功流程，保留拒絕驗證。
- 整合分支重跑 `pnpm --config.verifyDepsBeforeRun=false -C server test:e2e --testRegex '(internal-email-signing|core-esign-flow).e2e-spec.ts$'`：3 suites／41 tests 通過，涵蓋內部 OTP、內外部 core 回歸；`git diff --check` 通過。DB／Redis 序列使用並於完成後釋放。
- 同一程式碼樹完整 unit 104／927、e2e 21／183、security 8／37、build 與 lint 零 errors 證據如上。本票八項驗收完成，改 resolved，可開始 05 與 07；完整副本及補簽的專屬驗收仍由後續票單負責。
