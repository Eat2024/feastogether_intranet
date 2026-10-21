# Quickstart：後續實作驗證指南

目前已完成 plan 與 [tasks](tasks.md)，以下是實作完成後的驗證步驟，**本階段尚未執行功能測試、發信或 migration**。

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
