# Spec 017 tickets 切分索引

來源：[PR 37](https://github.com/Eat2024/feastogether_intranet/pull/37)，固定 commit `a827699743ccf306900f33a05064c76f954c13b0`。切分日期：2026-11-02。

PR 已產生 46 項 tasks，全部未勾選；這表示任務規劃完成，不代表功能已實作。本次只建立 10 張本機 tickets，沒有修改前後端、執行 migration／UAT 回填或部署，也沒有建立 GitHub Issues。

## 規格與工作分支

規格唯一來源仍是 `specs/017-department-document-visibility/`，不複製到 .scratch。建立 tickets 時工作區在 `dev`，尚未包含 PR 37 的規格，因此各票提供固定 commit 的連結。實作前先在單一功能整合分支納入 PR 37 規格，再使用本機 spec.md、plan.md、tasks.md、research.md、impact-analysis.md、data-model.md、contracts/department-access.md 與 quickstart.md；若來源有後續變更，先核對並更新對應 tickets。

plan.md 的「尚未產生 tasks」及 spec.md 的 planning 狀態是前階段文字；本次按實際存在的 tasks.md（46 項未完成）判斷進度，不把這些舊狀態當成 tasks 尚未產生，也不將 tasks 勾成已實作。

## 依賴與範圍

| Ticket | 工作 | Tasks | Blocked by |
| --- | --- | --- | --- |
| [01](issues/01-baseline.md) | 基線盤點與隔離驗證環境 | T001–T002 | 無 |
| [02](issues/02-department-schema.md) | 部門欄位與資料庫遷移 | T003–T005 | 01 |
| [03](issues/03-trusted-department-policy.md) | 可信登入同步、錯誤與共用存取政策 | T006–T010 | 02 |
| [04](issues/04-department-read-api.md) | 同部門列表、唯讀 API 與隱私裁切 | T011–T016 | 03 |
| [05](issues/05-department-read-ui.md) | 部門列表與前端唯讀檢視 | T017–T021 | 04 |
| [06](issues/06-creation-snapshot.md) | 建立交易保存部門快照 | T022–T026 | 03、04 |
| [07](issues/07-department-export-api.md) | 一般匯出、歷史與下載的部門授權 | T027–T032 | 04、06 |
| [08](issues/08-department-export-ui.md) | 前端匯出串接與下載安全回歸 | T033–T036 | 05、07 |
| [09](issues/09-cutover-rehearsal.md) | 正式登入回歸與 UAT 切換程序演練 | T037–T041 | 05、06、08 |
| [10](issues/10-integration-handoff.md) | 契約同步、查詢驗證與整合交付 | T042–T046 | 09 |

每項 task 僅有一張主責 ticket。原始任務逐項保留於票內，重跑前置測試是回歸驗證，不是重複分派。所有票初始狀態為 ready-for-agent，依前置順序實作；目前 01–10 全部 resolved，46 項 tasks 完成並經本機隔離驗證。

04 完成後 05 與 06 可分開處理；07 等 06 完成，08 等 05／07 完成。06 的調職讀取驗收需要 04，因此明列額外依賴。09 的回填文件可以提早準備，但完整票的開始與驗收仍依依賴；10 收尾全部整合驗證。只完成 05／06 是本機 MVP，不代表部門隔離可上線；必須同時完成匯出保護與切換演練。

## 共用實作與驗證約定

- 使用單一功能整合分支；各票可獨立 commit／分支審查，遠端 PR 依使用者後續要求「開發完畢請進 PR review」建立供審查。遵循 root 及修改 package 的 AGENTS.md。
- 測試先於對應實作，紅燈必須來自預期缺少功能；環境或登入失敗不可算有效紅燈。只用合成資料及 feastogether_intranet_test 前綴測試 DB，不使用 UAT DB。
- 共用 validation.md、E2E config、policy、query service 及前端共用檔案要序列整合；會重設同一 DB 的 schema／E2E 不可同時跑。可拆分工作不等於要求啟動多代理。
- 驗證先依修改 package 執行 lint／相關測試／build；server 檢查使用 lint:check。跨前後端與最後整合執行 root pnpm lint、pnpm build 及規劃的測試套件。client 不另增測試框架，以 lint/build、雙帳號流程與回應內容驗收。
- 所有授權最終在 server 判斷；同部門唯讀、建立人管理、同部門一般匯出、本人簽署／副本分開檢查，不用 isCreator 代替匯出資格。
- 不新增表、dependency、env、fallback、排程或通用 RBAC；不提交 secret、cookie、token、組織個資、簽名圖檔或真實備份。
- 09 僅產出可審查 SQL／程序與隔離演練；真實 UAT 回填、部署與恢復對外服務留待使用者部署指示。通用 schema migration 不混入 UAT 特定回填。
- 每張票將驗證證據追加到票內與 specs/017-department-document-visibility/validation.md；驗收並整合後才改 resolved。最後交付分列前端、後端、migration/config 與未完成限制，不把已產生 tickets 當成已實作。

## 實作追蹤

| Ticket | 整合提交 |
|---|---|
| 01 | 2f1eacb |
| 02 | 9fe7128 |
| 03 | ed16786 |
| 04 | adb85f4 |
| 05 | e5f1de2 |
| 06 | e6df515 |
| 07 | 3bf47e9 |
| 08 | e32dcda（client 共用部分先整合於 e5f1de2） |
| 09 | 3338e8d |
| 10 | `git log --grep="complete integration validation"` |

交付與測試：[validation](../../specs/017-department-document-visibility/validation.md)；獨立雙軸 [review](../../specs/017-department-document-visibility/review.md)。真實 UAT 盤點、回填及部署尚未執行。
