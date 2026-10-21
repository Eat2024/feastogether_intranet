# Quickstart：後續實作驗證指南

後端已依八張本機 tickets 實作，以下保留驗證步驟；實際執行結果、容量量測與限制見末尾紀錄。前端與部署不在此次交付內。

## 前置條件

- 使用專案既有 pnpm／Node，沿用 server/.env.example 的設定，不新增環境變數或提交 secret。
- 準備隔離 MySQL／Redis 與 server/.env.test。測試 DB 名稱必須以 feastogether_intranet_test 開頭，不繞過既有保護。
- HR／staff_emails 使用合成回應；mailer 使用既有測試替身捕捉邀請與 OTP，不向真實員工發信。PDF 使用合成樣本。
- 不存在 UAT／PRD，這份指南不要求部署。不得在共用開發資料庫跑清庫或 rollback 測試。

## 驗證指令（repository root）

```bash
pnpm -C server lint:check
pnpm -C server test --runInBand
pnpm -C server build
pnpm -C server test:schema
pnpm -C server test:e2e
pnpm -C server test:e2e:security
```

先執行受影響 service／worker 單元測試，再執行上述 package 品質門檻。既有 schema harness 負責隔離 migration 驗證；不要用一般 migration:revert 對開發資料操作。HTTP／worker 手動確認如有必要才在測試設定下分別啟動，不使用真實 SMTP。

## 核心驗收

| 情境 | 可執行驗證與預期 |
| --- | --- |
| org cache 回歸 | org-chart e2e 驗證 TTL 7,200、跨使用者共享、讀不續期、過期才查、Redis 失敗不 fallback |
| POST 員工解析 | 本機命中、未建帳精確 HR lookup、並發唯一建帳、停用不恢復、超出 lookup 長度 unavailable；GET 不再寫帳號 |
| 來源契約 | 合成完整／稀疏／空結果、前導零、空白／無效 email；重複／額外員編及 malformed／401／403／逾時回 502，無原始 body 日誌 |
| 1／100／101／6,000 人 | 核對對應、60 批上限100、併發最多4、無人手拆分；記錄耗時與記憶體，失敗批次不發起、不寄信 |
| 草稿與發起 | 缺信箱可保存、發起422列出userIds；查詢後身分變動409；回應失敗無部分 active／通知／稽核；發起固定 email 納入 hash |
| schema | up→down→up；user email／邀請可存、同地址兩user可存、兩email signer重複仍失敗；有新資料時down先拒絕且資料不變 |
| 內部 Email 完整流程 | 測試 HTTP client 先 GET邀請、POST寄碼、以mailer替身取碼、POST驗證取得cookie，再讀task／source、提交簽名、worker完成、下載本人PDF |
| OTP 邊界 | 10分鐘、錯5次、60秒、每小時5封、重寄舊碼失效、並發僅一次消耗、8小時credential過期；只持邀請不讀檔 |
| 舊入口／跨人 | 員工session直接呼叫五個舊個人入口403；非本人404；service internal principal及重送也不能繞過；cookie與頁面不符409 |
| 拒簽與副本 | allowReject、requestId重送、已拒不可簽或讀檔；已簽期限後／停止後仍OTP下載；其他人副本拒絕、完整性失敗不給檔 |
| 混合通知 | 初次／all_pending／selected逐人通知；同地址照寄；午夜額度、並發、unknown與重試維持既有規則 |
| 補簽通知 | 固定舊地址、不查HR、只輪替pending、新batch入列；舊token／credential失效；未claim舊log不寄；已在途舊信即使送達也不能存取，舊結果不得覆寫新通知／清新密文；signed原連結仍可下載 |
| 補簽取連結 | 寄送前有效密文可取，寄送後正常省略／[]，損壞密文503；creator detail顯示最新寄送結果 |
| 回歸與隱私 | 外部完整流程不變；舊證據hash不變；管理人權限維持；public task無員編／部門／職稱／其他人資料，日誌無秘密 |

既有測試入口包含 server/test/org-chart.e2e-spec.ts、esign-reminders.e2e-spec.ts、esign-rejection.e2e-spec.ts、core-esign-flow.e2e-spec.ts、security-core-esign-flow.e2e-spec.ts、schema-constraints.e2e-spec.ts、schema-migration.e2e-spec.ts。新增專用 internal-email-signing 整合案例，並更新原本預期內部可免 OTP 的案例，不將失敗簡單略過。

HTTP 測試直接從 Set-Cookie 捕捉 HttpOnly credential，勿把 token／OTP 印到測試輸出。manual Browser 驗證需等前端接好，由前端交接執行，後端測試不宣稱桌面／手機畫面已完成。

## 交付紀錄

實作交付分別記錄 server、schema migration、前端未修改、config／dependency 無新增，以及實際執行的命令與結果。若 MySQL／Redis 不可用，明列未執行的整合測試及風險，不宣稱完整驗收。前端接續 [frontend-handoff.md](contracts/frontend-handoff.md)。

### 2026-10-21 實作前基準

- 整合分支：`feat/010-internal-email-signing`；程式基準：`615ade2`。使用者已授權依票單圖平行實作，票單分支完成驗收並整合後才標記 resolved。
- 規格品質 checklist：16／16 已確認；沒有 implementation extension hooks。
- Node `v26.4.0`、pnpm `11.9.0`；沿用現有依賴，未安裝或修改 lockfile。
- `pnpm -C server test --runInBand`：101 suites、873 tests 通過。
- `pnpm -C server lint:check`：0 errors、202 既有 warnings；`pnpm -C server build`：通過。
- 既有測試設定經不揭露 secret 的檢查：MySQL 可連線、Redis PONG，測試 DB 前綴與 Redis 非 0 guard 有效；未操作開發資料。後續具資料清理的測試由協調者序列安排。
- 以上只是修改前基準，不代表 Spec 010 的新功能已通過驗收；各票單另追加 red／green、驗證與整合紀錄。前端未修改，未發真實郵件、未呼叫真實 HR 名冊、未部署。

### 2026-10-21 Ticket 08 最終後端驗收

驗證基底為整合分支 `f8a5d65`（Tickets 01～07 已整合），加上 Ticket 08 的測試／必要隱私修正。工作樹使用既有依賴與測試設定的本機連結，未提交連結或 secrets；命令中的 `--config.verifyDepsBeforeRun=false` 只停用 pnpm 對連結工作樹的依賴自動確認，未安裝依賴或跳過測試。

| 命令（repository root） | 結果 |
| --- | --- |
| `pnpm --config.verifyDepsBeforeRun=false -C server test --runInBand` | 104 suites／941 tests 通過 |
| `pnpm --config.verifyDepsBeforeRun=false -C server build` | 通過 |
| `pnpm --config.verifyDepsBeforeRun=false -C server lint:check` | 0 errors／205 warnings；基準202，整合前票單增加3；Ticket08修改檔無新增warning，未擴大清理既有警告 |
| `pnpm --config.verifyDepsBeforeRun=false -C server test:schema` | 2 suites／8 tests 通過；真實隔離MySQL，約17.6秒 |
| `pnpm --config.verifyDepsBeforeRun=false -C server test:e2e` | 23 suites／207 tests 通過，約28.2秒，包含容量suite及組織快取回歸 |
| `pnpm --config.verifyDepsBeforeRun=false -C server test:e2e:security` | 9 suites／45 tests 通過，約6.4秒 |
| `pnpm --config.verifyDepsBeforeRun=false -C server test:e2e --testPathPatterns internal-email-capacity --silent=false` | 1 suite／7 tests 通過，約12秒；輸出下表彙總量測 |
| `git diff --check` | 通過 |

- 隱私 red→green：來源 `staff_lookup` 的失敗 envelope 可把任意 `code` 當 metadata 寫入日誌；先重現，再只對此敏感來源省略 upstreamCode。Email受限入口的 query／非提交body亦可能被記錄；先重現3個錯誤路徑，再使該組路徑與電子簽管理路徑同樣不記 query/body。原固定事件／狀態／耗時仍保留，無新logging框架。
- 實際 HTTP／application log及audit metadata核對不含合成員編／地址／cookie／邀請digest；既有OTP及簽名日誌遮罩案例保留。授權的本人／建立人業務回應仍依契約提供必要資料，不以日誌裁切影響業務資料。
- 補簽後已簽者原邀請重新OTP，取得相同真實PDF、簽署證據及原檔／副本摘要；待簽者舊cookie／token失效。此新增案例收錄在 `internal-email-copy.e2e-spec.ts`（共8例），沒有建立重複的reopening suite。
- 首輪全量e2e有3例失敗：容量fixture只清queue、未清持久通知，後續maintenance重補6000工作，干擾舊到期掃描與worker驗收。已修正容量suite只清除本次明確ID的文件／通知／員工／檔案及queue job，並斷言零owned pending job；前兩次可辨識的容量fixture亦僅按其確定ID清理。未清空測試庫、未改動其他測試資料、未跳過或放寬失敗案例；完整重跑結果如上。

### 全公司批次容量實測

`internal-email-capacity.e2e-spec.ts` 使用真實 HTTP、MySQL、Redis／BullMQ，來源僅在 HTTP transport 邊界替換為合成非同步資料，不 mock 身分解析或發起服務。來源故意逆序回傳，逐一核對員編→userId→固定地址，無依位置誤配。解析測量為**本機已有帳號**；前端自動最多100人一次，6000人共60次解析HTTP請求。信箱檢查／發起各為一次HTTP請求，由後端拆批。

耗時包括該段請求及後置驗證（完整發起含6000份DB通知世代、快照與實際queue job核對），不是純HR耗時或正式SLA。RSS／heap為該段前後差值，含GC，**不是峰值**；負值是回收後下降。單位：耗時ms、記憶體MiB。

| 操作 | 人數 | 耗時 | RSS差 | heap差 | 信箱來源批數 | 最大併發 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 本機身分解析 | 1 | 4 | 0 | 1 | 0 | 0 |
| 本機身分解析 | 100 | 4 | 0 | 2 | 0 | 0 |
| 本機身分解析 | 101 | 5 | 0 | 2 | 0 | 0 |
| 本機身分解析 | 6000 | 216 | 2 | -7 | 0 | 0 |
| 信箱檢查 | 1 | 4 | 0 | 1 | 1 | 1 |
| 信箱檢查 | 100 | 4 | 0 | 2 | 1 | 1 |
| 信箱檢查 | 101 | 4 | 0 | 2 | 2 | 2 |
| 信箱檢查 | 6000 | 129 | 2 | 25 | 60 | 4 |
| 發起末批缺地址→422 | 6000 | 159 | 5 | 8 | 60 | 4 |
| 發起末批來源失敗→502 | 6000 | 156 | 9 | -8 | 60 | 4 |
| 完整發起→201＋實際入列 | 6000 | 8485 | 202 | 191 | 60 | 4 |

- 每批最多100、timeout10000ms；兩種末批失敗都保持草稿、零指派／通知批次／發起audit，之後可用同草稿成功發起。成功固定6000地址、6000不同邀請世代及6000實際queue job，未啟動6000人寄信或PDF產製。
- 組織樹仍為7200秒、跨實例共用、讀1000次不續期、過期按需更新；信箱預覽與發起不使用該快取、不新增排程。
- 舊10人全簽署／PDF容量回歸保持10人，沒有以6000人信箱測量冒充6000份PDF完成。

### 交付與尚未驗證界線

- 後端：員工解析／信箱預覽／原子發起、邀請與OTP簽署／拒簽、本人副本、混合催簽及補簽完成；舊員工session個人操作回403，不保留免OTP旁路。
- Migration：`1792454405000-InternalEmailInvitations.ts` 修改既有signer約束及generated external_email唯一索引，無新表；schema無drift、有新內部邀請時拒絕rollback而不刪資料。HTTP／worker須使用同一相容版本；此處只在測試庫執行，未部署。
- Config／dependency：無新增env、套件、lockfile、排程、fallback或Email cache。
- 前端：未修改client；[frontend-handoff](contracts/frontend-handoff.md)提供實際方法／認證／錯誤與順序。桌面／手機、同源cookie、下載、Next rewrite及實際反向代理期限未驗證。
- 合成HR的快速回應不代表真實來源SLA。6000人需要60批，4併發為15波；單批接近10秒時來源等待可能接近150秒，再加DB／入列。HTTP直連測試未驗證代理容忍度；既有keepAlive／headers timeout不是請求處理時限。未擅增背景發起。
- 未建帳員工的staff_lookup目前串行，100人冷匯入可能較慢；本機不存在且不符合5–8碼lookup限制者回unavailable，不能套用已建帳容量結果。
- 舊指派缺固定Email／邀請、舊notification log缺generation均fail-closed；不回填、不補寄或改寫歷史證據。無UAT／PRD，未執行真實HR／SMTP或部署驗收。
- 既有DELETE session不在credential cookie Path下，本次不宣稱完整登出已修；8小時憑證及逐指派／世代驗證維持。
- 任務44／44已依實際檔案與測試核對，詳見tasks末尾；規格品質checklist16個標記保持原值。票單結案仍依合併結果，主協調者另執行整合分支獨立code-review。

### 最終雙軸審查與整合收尾

- 以 `615ade2` 為比較基準、`a05a221` 為受審整合版本完成獨立雙軸審查：Standards 無硬性違規，僅一項低風險私有命名建議；Spec 無發現問題。
- 修正 commit `1552b51` 將發起服務中已涵蓋內外部人員的私有 invitation 方法／變數移除 external 限定名稱；未改公開 API、通知種類、資料或執行行為。修正分支驗證：相關 unit 4／4、build 與 lint 通過；合併者確認差異僅為私有命名，`git diff --check` 通過。
- 八張 tickets 均已 resolved，44 項 tasks 均完成勾選。原八個實作 worktrees 已在乾淨來源及整合祖先檢查後清理，分支保留；最終 review-fix worktree 由主協調者於整合確認後清理。
- 本節僅追加最終審查與整合紀錄，不改寫前述測試量測；前端、真實 HR／SMTP、實際代理時限與部署仍維持上述未驗證界線。
