# Implementation Plan: 全量背景發起簽署

> **最新範圍優先**：本輪只改後端 worker 與文件／簽署人異動保護；前端工作暫緩。原本必填 Idempotency-Key 改選填以相容既有 client。具體覆寫與已知限制見 [後端範圍決策](backend-only-scope.md)。

**Branch**: `impl/022-integration` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**狀態**：T001–T030 後端已實作整合；T031–T034 在 `impl/022-08` 完整回歸與實時間長測中，未部署。使用者已確認所有人數都走 worker；本計畫取代 100 人門檻。

## Summary

所有發起採短交易可靠受理，回 202 與工作摘要；worker 負責本機員編解析、查核及正式發起。MySQL 工作列是可靠來源，Redis 只運送工作 ID。正式發起資料與工作成功同一交易提交，通知繼續走既有寄信 worker。本輪不修改前端；既有前置解析與成功導頁仍保留。後端受理／工作查詢不載入完整文件詳情。

## Technical Context

- **Language/Version**：TypeScript 5.7；Node >=24.22.1；繁體中文。
- **Primary Dependencies**：既有 Next.js 16／React 19／MUI／TanStack Query、NestJS 11／Fastify、TypeORM 0.3／mysql2、BullMQ 5；無新增 dependency。
- **Storage**：MySQL 8.4 新增 `esign_initiation_jobs` 一表；沿用 Redis queue 與私有檔案儲存，不存 PDF bytes 或簽名圖到工作表。
- **Testing**：Jest、隔離 MySQL／Redis e2e、合成名單、受控瀏覽器驗收。client 沒有 test script，不宣稱既有 UI 自動測試。
- **Target Platform / Project Type**：現有 Linux Docker HTTP 與 worker；兩 package web application，不新增 workspace。
- **Performance Goals**：1／100／101／5,001 人各 20 次受理 P95 ≤3 秒；已更新進度 10 秒內可見；大型與小型混合排隊依 SC-008 驗收。本機量測與未驗範圍見 [validation.md](validation.md)。
- **Scale/Scope**：0 人拒絕、1／100／101／5,001／6,001 人完整背景化；內外部混合與全外部。原 6,000 人查核限制須改為受控批次，不當作文件上限。
- **Constraints**：一文件最多一個非終態工作；不改文件狀態 enum、登入／Portal 匯入／寄信白名單；不新增 env、獨立排程、取消功能或通用工作中心。

## Constitution Check

| Gate | 設計前／後結果 |
| --- | --- |
| I KISS/YAGNI | 通過：一個專用工作表、一條發起 queue、沿用既有 30 秒 maintenance；去掉同步／背景雙軌。新增表的必要性與替代方案見 research。 |
| II Server 權威 | 通過：兩次授權、鎖內固定來源與原檔識別、完整業務交易、lease fencing；不信任前端人數／userId 作資格證據。 |
| III 隱私 | 通過：queue 僅 jobId、摘要不含 JSON／名單；input／issues 僅建立人可讀，30 天清除終態敏感明細。 |
| IV 邊界 | 通過：HTTP 只受理／查詢，processor 僅 worker module；新增 Repository 由 MysqlModule 註冊，Service 傳 EntityManager。 |
| V 驗證 | 通過（設計）：列出重放、並行、越權、中斷、期限、缺資料、容量及 filesort 回歸；尚未執行功能測試。 |

沒有未解設計 gate；所有新增結構僅為本輪規劃，不代表已執行 migration。

## Project Structure

```text
specs/022-background-signature-initiation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/background-initiation.md
├── quickstart.md
├── tasks.md
└── checklists/requirements.md
```

預計實作位置：

- `server/src/features/esign/entities/esign-initiation-job.entity.ts`、`repositories/initiation-job.repository.ts`（新增）：工作與唯一約束、精簡摘要／按需輸入讀取。
- 同 feature `services/esign-initiation-job.service.ts`（新增）：受理、冪等、查詢與重試；`esign-initiation.service.ts`：拆出接受 EntityManager 的正式交易核心，不保留同步 HTTP 發起入口。
- `esign-employee-email.service.ts`、`esign-signer.service.ts`、`esign-field.service.ts`、`esign-access-policy.service.ts`：批次解析／鎖序／忙碌保護與原檔版本確認。
- `controllers/documents.controller.ts`、新增 `controllers/initiation-jobs.controller.ts`、發起專用 DTO／既有 list DTO、`common/errors`：契約與穩定錯誤。
- `server/src/worker/esign/document-initiation.processor.ts`（新增）、既有 worker module／maintenance processor、queue module／constants／producer：執行、補列與恢復。
- `server/src/infrastructure/database/mysql/mysql.module.ts`、migration／mysql.options／schema.sql：Repository 註冊與單表 migration。
- `client/src/api/{endpoints,types,requests,queries}`、`features/esign-documents/{DocumentSignersEditor,DocumentDetailView}` 及列表：提交／摘要／失敗輸入還原。
- `server/test`：新增背景受理／並行恢復／容量 e2e，更新既有 HTTP 發起測試為受理後等待終態；不把 202 當成功發起。

**Structure Decision**：沿用業務 feature 與獨立 worker。只補必要 provider，不能把含 controller／組織樹上游的整個 EsignModule 載入 worker。

## Implementation Design

### 1. 受理與前端提交

使用發起專用 DTO 支援 `{type: employee, employeeNo}`；內部名單直接提交員編，不先呼叫 resolutions。外部沿用 name/email。舊 userId 形狀可解析，但所有請求均需冪等 key、均為背景結果，不代表相容舊前端。共用草稿 DTO 不擴張，避免破壞 draftSave。

HTTP 做 bounded O(N) 的格式、重複身分、欄位位置基本範圍與期間形狀驗證（截止仍在未來等動態條件於確認不是重播後才檢查）；不查全體員工、不讀 PDF bytes、不生成正式快照。短交易先以共享鎖 current read 建立人，再獨佔鎖文件，讀取原檔 metadata 與草稿版本，保存不可變工作輸入。回覆資料大小不隨人數成長。

提交以 `Idempotency-Key` 區別 HTTP trace 的 `x-request-id`。同 key 同 hash 查回原工作；不同內容 409。授權後、檢查 draft 之前先處理已存在 key，讓成功後回應遺失也能查回。不同 key 遇同文件進行中工作一律 409，附建立人可讀的現有工作識別，不靜默替換內容。重播只重驗目前授權、輸入形狀與 hash；截止時間仍在未來、latest parent、retryable 與輸入保留等動態條件只用於新受理。人工 retry 亦先查既存子工作，再驗是否可建立新子工作。

MySQL commit 成功才受理；commit 前失敗不回 202。DB 成功但 enqueue 失敗仍回已受理，由既有 maintenance 可靠補列；網路讓 commit 結果未知時前端保留 key 並查回，不假設失敗重建。

### 2. Worker 與交易邊界

新增專用 queue `esign-document-initiation`，初始全域 concurrency=1，沿用現有 export 的 setGlobalConcurrency 模式。每個工作只帶持久 job ID；不以 BullMQ 的去重當業務唯一保證。

獨立短交易 claim 工作，寫 attempt／lease 後釋放鎖；每 500 人查本機資料，保存該 attempt 的已查核筆數，不在中間建立正式指派。缺帳號／停用／身分不符整份失敗；缺信箱沿用略過通知而保留資格。不查 HR、不自動補建或刪除帳號。

進入正式交易前，以有效 lease 的短 CAS 提交 stage=committing，使輪詢能讀到階段；不代表已有業務提交。正式交易仍重核 lease 與期限。

正式交易維持使用者 ID 升冪（共享鎖）→ 文件（獨佔鎖）→ 工作（獨佔鎖）的鎖序，核對最新資格、員編映射、工作 lease、deadline 與原檔／草稿版本。正式核心接受同一 EntityManager，完成欄位、每批 250 筆指派／通知、canonical 快照與 audit、文件 active、job succeeded，最後一次 commit。不得每 250 人提交。

`buildFields()` 會刪除重建欄位，不可作為交易外的預驗證直接呼叫。首版可保留既有 PDF 驗證在正式交易內；若另抽出純讀預驗證，必須在鎖內重核 file ID/hash/version，不能只相信先前結果。worker 顯式傳入 creatorUserId 作 actor，不保存或模擬瀏覽器 session。

提交後才 enqueue 邀請。通知 queue 不可用不改寫已成功的 job；通知 outbox 由原 maintenance 補送。processor 重播 succeeded 工作直接結束；不得再次呼叫發起核心。

### 3. 所有草稿寫入入口受保護

在文件鎖後共用 active job 檢查，涵蓋標題／PDF／欄位更新、草稿刪除、draftSave、draft-settings、replace fields、重新發起及任何草稿 signer note 寫入。只允許持有當前 job ID 與有效 lease 的正式核心通行，禁止通用 skipGuard。

受理先於編輯取得文件鎖則編輯 409；編輯先完成則受理保存新版本。新 PDF 預存後因忙碌拒絕，沿用現有新檔清理。不得透過前端禁用代替 server guard。

### 4. 恢復與時間界線

- DB 管理 retry：每 job 最多 3 次 claim，暫時錯誤等待 30／120 秒；BullMQ delivery attempts=1，避免兩套重試相乘。
- Lease 5 分鐘，預查階段每 30 秒續租；progress 每批更新且距上次更新達 5 秒也需寫 heartbeat，重試顯示新的 attempt 並重設本輪查核數。
- job deadline = `min(acceptedAt + 120 分鐘, signEndAt)`。每批、進正式交易與 commit 前檢查；到期失敗，禁止超時啟動或繼續提交。
- 正式交易持有工作列鎖後停止獨立 heartbeat，避免同列自我等待。maintenance 只在短 claim／CAS 操作處理可取得的列，跳過鎖住的交易，不能強行宣告一個仍可能提交的工作失敗。
- 程序死亡由 DB 回滾後回收過期 lease；舊 lease 的更新／成功／失敗皆須 CAS，0 affected rows 即停止。
- DB／Redis 全面中斷時不能承諾即時改寫失敗；前端顯示進度暫不可更新。恢復後先核對已提交結果及期限，再終態失敗或有限重試。不得用 Promise.race 僅回 timeout、卻讓原交易在背景繼續提交。
- 人工 retries 建立新 job、新 key、新 120 分鐘界線，仍不得越過簽署截止；僅原輸入可用且文件版本未變時允許。改名單／改期限使用新的 initiation。

### 5. 前端與摘要

所有受理回應都是 job 摘要。UI 取消 `flash=published` 的立即成功路徑，顯示排隊；3 秒輪詢，只有 succeeded 才顯示發起成功與通知進行中。終態停止輪詢，401／403／404 停止並提示，短暫網路失敗不把 job 改為 failed。

工作摘要由文件列表批次讀取小欄位，只有建立人回傳 initiationSummary；其他部門讀者為 null。不用完整 detail 當 polling；不在列表排序／查詢中夾帶工作 input_json 或 issues_json，延續 PR #47 的防線。

失敗後按需讀 input 讓編輯器還原完整選取；員工從上游組織樹消失仍顯示原員編，不無聲遺失。人員問題走獨立分頁 issues；每次進度輪詢只回 issueCount／errorCode，不重傳名單。

### 6. 發布與回退

先套用新增表 migration，再於協調的發起入口維護窗口更新 worker／server／client，驗證後開放；不新增長期 feature flag。舊開啟頁面收到缺 key／契約錯誤時提示重新整理。原文件、既有邀請及簽署繼續沿用。

舊版本不認識 active job guard，不能在有非終態工作時直接回退。先暫停新受理、清點／處理非終態工作並留存結果；保留新表。down 只在工作表為空時允許，否則拒絕丟棄證據與輸入。不要透過刪 job 清理卡住的工作。

## 實作順序與交付關卡

以下順序已拆入 [tasks.md](tasks.md) 與本機 tickets，本輪不執行實作：

1. **工作持久化與受理**：單表 migration、唯一約束、精簡 Repository、發起 DTO、冪等受理及所有草稿寫入的 busy guard。驗證重播、並發及 commit 回應遺失。
2. **正式核心與 worker**：交易核心、明確 actor 與鎖序、分批查核、claim／heartbeat、有限重試及既有 maintenance。驗證中斷不局部發起，成功重送不重複通知。
3. **查詢與前端**：摘要、latest、input／issues 及 retry；移除提交前 resolutions，改用受理與進度，恢復失敗輸入。僅契約 mock 不算完成整合。
4. **整合與發布驗收**：遷移既有 201 測試，執行容量、混合排隊、授權及故障注入，驗證 Swagger 契約、協調部署與回退。

Spec 023 的本機主檔與信箱能力是查核前置條件；實作前核對目標分支已具備該能力，不以即時人資查詢或自動建帳繞過相依。

## Complexity Tracking

| 新增項目 | 當前需求 | 較簡單方案的限制 |
| --- | --- | --- |
| 一張工作表與專用 queue | 可靠受理、不可變確認輸入、跨重啟追蹤與冪等 | Redis-only 無法與正式發起原子提交；塞文件大型 JSON 會重現列表風險；匯出表沒有發起語意與約束。 |
| input／issues 按需讀取 | 重整後修正完整名單且不讓輪詢洩漏大量資料 | 只回摘要無法還原尚未落地的名單；每次輪詢回整份輸入成本過高。 |

無憲章例外；移除成本為先停止受理、結清工作、保留稽核摘要，再移除讀寫入口，不需搬遷已成立簽署證據。


### 草稿編輯版本補修

2026-11-03 真 HTTP 紅燈確認：只換欄位／簽署人／註記不一定會更新 document.updated_at；ORM 即使 dirty save 也可能在同秒碰撞，讓 failed parent retry 覆蓋剛修改的名單。因此所有草稿編輯在文件鎖內以 DB 單調微秒 touch 完成版本更新，不新增版本欄位／表／環境變數。DocumentRepository.save 對既有 draft 保存原 raw 版本再 save/touch，公開 fields/note 自行 touch；新建及正式 worker activate 不走該分支。save 後回傳時間重讀 DB，原 job 仍以 raw 微秒版本比對。保守將同值儲存也視為新編輯版本。


### 員工鎖模式補修

正式發起只讀本機users資格／Email，不寫回主檔。worker以共享鎖固定全部使用者（含建立人），受理／retry也以建立人共享current read保持資格檢查原子性，與新增job的creator外鍵共享引用相容。仍阻擋停用、信箱或同步UPDATE至commit，保留users→document→job順序；其他原users寫入相關X鎖不變。這比單純移除受理X鎖完整，也避免一般非鎖定read的資格TOCTOU。
