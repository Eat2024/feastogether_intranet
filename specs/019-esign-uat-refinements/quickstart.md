# Quickstart：實作後驗證與切換

本文件保留實作驗收指南，實際執行結果及尚未驗收的依賴列於文末。測試只用合成資料與 `feastogether_intranet_test` 前綴 DB、隔離 Redis namespace；不在 UAT 做破壞性驗證。

## 前置條件

- 使用 pnpm、既有 Node 版本及本機 MySQL/Redis，依既有 `.env.example` 準備測試設定，不提交 secret。
- 整合 Spec017 部門政策；若包含 Spec018 寄信白名單，允許／阻擋案例依其設定，不能用真實員工信箱測試寄件。
- 啟動 `pnpm dev`（包含 client、server、worker）；測試 HR/寄件使用合成 stub 或既有 fake adapter，既有內部通知測試規則不變。

## 自動化驗證

```bash
pnpm -C server lint:check
pnpm -C server test -- --runInBand
pnpm -C server test:e2e --testPathPatterns='esign-export|export-history|export-retention|org-chart|internal-email-initiation|internal-email-capacity|esign-signer-management'
pnpm -C client lint
pnpm build
pnpm lint
```

server e2e 清單需同步移除已刪除預檢專用檔名，容量測試移至仍使用的發起流程。client 無 test script，不能宣稱 client unit tests 已跑。若測試服務不可用，報告未執行與原因，不以 mock 等同真實 DB 驗證。

| 範圍 | 必須驗證 |
| --- | --- |
| US1 | Excel/PDF/ZIP 三次與並發重下載：紀錄數與原 metadata不變；缺檔/未就緒/無權限不寫入；新匯出仍記錄 |
| US2 | +8天/+365天檔案相同；maintenance 不刪已引用成果；租約復原、補列、孤兒暫存清理仍有效；後來新簽署不加入ZIP |
| US2 舊資料 | completed、expired仍存在、expired已刪、損毀、多工作、最新成功缺檔；固定選擇不漂移、缺檔不重建、dry-run零寫入、apply可重跑 |
| US3 | 名稱/編號/建立人/員編、中文/大小寫/%/_/!、空白/超長/缺建立人；23筆10/10/3；typeTotals同條件；Spec017不同部門不可查也不計數 |
| US4 | 真實Redis TTL1800、不續期、隔離、1799/1800邊界；放入v1舊key仍取新來源；成功空陣列及錯誤處理 |
| US5 | 移除端點及OpenAPI，呼叫不查HR；混合無信箱/有信箱指派完整，skipped不寄信；來源失敗502保持草稿；6,000筆分批與併發上限保留 |
| US6 | 27種label、未知type、補簽兩種視角actor結構、排序分組、metadata裁切；原始audit/hash不變 |

## 瀏覽器驗收

1. 在歷史匯出與我的電子簽查三種欄位，檢查待簽／已簽／拒絕與Excel／PDF／ZIP頁籤筆數、空狀態、換頁保留關鍵字。改關鍵字／頁籤回第一頁；重整維持條件。
2. 測試網址 page=0、負數、非數字、小數、含尾隨字元及極大數；UI導正有效頁，不送不安全offset；直接API非法輸入400。
3. 匯出 ZIP 後新增完成簽署，仍下載原 ZIP；不見保存期限或到期重新產生。回到匯出頁、重新整理仍選同一工作；存在較新失敗歷史時不能改選它。
4. 觀察網路：匯出面板處理中每3秒查狀態，歷史列表處理中依既有5秒更新；完成後停止相關輪詢。加入簽署人不呼叫 employee-email-checks。
5. 歷程頁直接顯示後端 label；補簽不因 actor 格式崩潰，未知事件中文顯示，顏色及合併仍依 type。

## 上線切換順序

1. 完成備份與 ZIP dry-run，結果僅存受控位置；列出缺檔阻擋與同文件多工作清單。本階段未執行。
2. 暫停匯出寫入，停止舊 worker 並排空執行中任務；不可有舊版過期清理與新政策並存。
3. 執行核對後的 ZIP apply：驗證原檔、恢復可用 expired、清空期限，保留其他歷史。失敗不得自動重建；復查 active 引用與下載。
4. 發布新 server/worker（禁期限清理、key v2、label/q/exportSummary），再發布 client。所有 API 實例更新完成後才視為30分鐘快取全面生效。
5. 用授權測試帳號核對原 ZIP 的 hash、歷史筆數、搜尋計數及中文歷程，再恢復匯出流量。
6. 不直接恢復舊 worker；如需回滾，先停止流量，依 data-model 的相容版本或整體備份方案處理，避免永久ZIP被舊清理程序刪除。

## 實際驗證結果（2026-11-02）

Plan 階段僅檢查文件結構、FR/SC 對應、連結及空白差異，當時未跑 runtime 驗證。以下為後續實作階段證據，不代表已部署或完成 UAT 切換。

整合版本 `1940095`（code review 修正前）：

- Server unit：106 suites／998 tests 通過；lint：0 errors／267 warnings。
- 隔離 MySQL／Redis 的 export、history、retention、org-chart、initiation、capacity、signer-management e2e：7 suites／144 tests 通過（131.5 秒）。
- 本機 moto 的 S3 export e2e：4 tests 通過。
- Root `pnpm build` 通過 client 與 server。
- Playwright 搭配合成 API：兩列表搜尋、清除、換頁、每頁 10 筆、超界頁導正及重整保留條件通過；歷程代表性中文 label、補簽、未知事件顯示通過；固定 ZIP 無期限及完成停止輪詢通過。另驗證 Excel／PDF 各三次歷史重下載成功取得 xlsx／pdf，Excel 不呼叫新增紀錄 API，PDF 僅呼叫既有下載 POST、無額外新增紀錄請求。這是 UI 合成回應驗證，不替代真實後端授權或 UAT 驗收；27 種完整 label 對照由後端測試覆蓋。

Review 修正後：新增「較新 expired 缺少 completedAt，不改選較舊 completed」回歸。修正前該案例失敗（fixed=false）；修正工具選取條件後，retention e2e 1 suite／8 tests 通過，驗證異常工作保持 fixed/unavailable、apply 不推測完成時間。修正後 server build 與 root lint 通過（0 errors／267 warnings）；此輪 client 僅修改註解，未重跑完整 client build。

原交付依賴 Spec017 部門整合（T042）已於下列 PR40/dev 整合驗證補齊。未在 UAT 執行備份、dry-run、apply、舊 worker 排空或發布。部署前仍須依上述切換順序執行。Code review 原始結論與修復範圍見 [審查紀錄](code-review.md)。


## PR40 與 dev 衝突整合（2026-11-02）

以 PR40 `3a44fbf` 合併 `dev` 的 `7d25c1a`（含 PR41／Spec017），在獨立 worktree 操作，未切換使用者主工作區、未修改其本機資料庫。

- 解決14個衝突檔案，保留019的重下載不新增歷史、固定ZIP、搜尋與頁碼導正、移除Email預檢、中文歷程；同時保留017的目前部門授權、唯讀DTO及本人副本資格。
- 歷史 page/count 在同一讀取快照套用部門與關鍵字；跨部門搜尋即使文字匹配也回空列表／0 counts。
- 詳情與 view=export 預覽都提供已授權的固定 exportSummary；原建立人調職後仍可管理，但 canExport=false、exportSummary=null且不查匯出工作。直接預覽／下載仍重新授權。
- 修正自動合併殘留的 ZipExportPanel.latest 引用、PDF 重下載 userId 參數，以及新增／移除 E2E 套件清單；中文歷程預期值同步，陌生員工負向fixture改不同部門以保留404斷言。
- OpenAPI 同步 exportSummary 的裁切與欄位，YAML及163個本地引用驗證通過。

最終驗證：server unit109 suites／1,081 tests；一般 E2E32 suites／363 tests，加上兩套白名單補跑14 tests，合計34 suites／377 tests；security14 suites／83 tests；root lint（0 errors／268 warnings）、server/client build、diff check通過。一般E2E涵蓋固定ZIP過期後沿用、歷史重下載不新增、搜尋分頁、同部門／跨部門／NULL／調職／本人例外；安全套件保留Spec018白名單與無副作用驗證。

驗證使用專用MySQL13317與Redis16317，DB `feastogether_intranet_test040verified`／Redis7，storage `/tmp/pr40-esign-verified`；安全測試獨立DB `feastogether_intranet_test040security`／Redis5。命令前綴：

```bash
DB_MYSQL_HOST=127.0.0.1 DB_MYSQL_PORT=13317 DB_MYSQL_USER=root DB_MYSQL_PASS='' DB_MYSQL_DB=feastogether_intranet_test040verified DB_MYSQL_SSL='' DB_MYSQL_SSL_CA_B64='' REDIS_HOST=127.0.0.1 REDIS_PORT=16317 REDIS_PASSWORD='' REDIS_DB=7 ESIGN_STORAGE_ROOT=/tmp/pr40-esign-verified FEASTOGETHER_BASE_URL=http://127.0.0.1:1 FEASTOGETHER_API_KEY=synthetic-test pnpm -C server test:e2e
```

初輪失敗已分開記錄：worktree共用node_modules的symlink被Turbopack拒絕，改為獨立離線frozen-lockfile安裝；合成HR設定缺漏補齊，不使用真實憑證；兩個舊斷言及新增非草稿fixture期間已修正。另有一次既有多人並行完成簽署的完整性測試失敗，其runtime與dev無差異，獨立重跑2套31 tests及最後32套功能回歸通過；沒有以放寬斷言掩蓋失敗，此時序敏感案例仍需持續留意。最後兩套白名單測試因測試DB名稱加隨機後綴超過MySQL 64字元而未能執行，改用較短的 feastogether_intranet_test040／Redis4 補跑14項通過；不是將環境失敗當成成功。

本次未重做先前瀏覽器與S3模擬驗收；保留前次證據。沒有新增表、env、dependency或排程，未執行真實UAT轉換、回填或部署。
