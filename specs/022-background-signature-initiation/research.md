# 022 研究與設計決策

> **最新範圍優先**：本輪只改後端 worker 與文件／簽署人異動保護；前端工作暫緩。原本必填 Idempotency-Key 改選填以相容既有 client。具體覆寫與已知限制見 [後端範圍決策](backend-only-scope.md)。

日期：2026-11-03。基於本機 `dev` 已合併 PR #47 的程式碼與使用者最新決策；所有結論是規劃，不是功能已實作。依 speckit-plan 分別研究後端交易與前端契約，再交叉核對。

## R1：所有人數使用單一背景流程

- **Decision**：1 人以上的有效提交全部背景化；0 人拒絕，不保留 100 人同步門檻。
- **Rationale**：使用者已明確確認；PDF／DB 鎖等待不由人數保證，雙軌會增加回傳、重試與權限分支。
- **Alternatives considered**：>100 才背景雖減少小名單排隊，但維護兩套體驗；首版選全域並行 1，另量測大型後的小型等待，不先增加 priority queue。

## R2：從員編解析到正式發起都移到背景

- **Evidence**：`client/src/features/esign-documents/DocumentSignersEditor.tsx` 的 resolveUserIds 以 100 人逐批串行；發起 mutation 先等待它，再呼叫 initiation。`server/src/features/esign/controllers/documents.controller.ts` 交易完成後還 calls queries.detail。
- **Decision**：發起專用 DTO 直接收 employeeNo；所有受理／查進度只回工作摘要。另行儲存草稿仍沿用原流程，不擴張本次範圍。
- **Alternatives considered**：只換後端 initiate 成 queue，仍留下 50 次前端預解析；只把 detail 簡化不能讓背景可靠持續。

## R3：一張 MySQL 工作表兼持久待派送紀錄

- **Decision**：`esign_initiation_jobs` 保存固定輸入、狀態、冪等與租約；queue payload 僅 job ID。DB 已受理但入列失敗由既有 30 秒 maintenance 恢復。
- **Rationale**：`esign-job-producer.service.ts` 與 maintenance 已採通知 outbox 模式；文件結果與 job 成功要能共用一個 transaction。
- **Alternatives considered**：僅 Redis 狀態不能與 MySQL 業務提交原子化；把 JSON 加到文件主表重現列表負擔；挪用 export jobs 混淆權限與狀態。此表有真實需求，非通用工作框架。

## R4：鎖序、完整交易與 fencing

- **Evidence**：`esign-initiation.service.ts` 交易內呼叫 employeeEmails.resolveForInitiation，再 checkAndLockDraftDoc；`esign-employee-email.service.ts` 與 `esign-signer.service.ts` 已依使用者 ID 升冪鎖 users→document。`esign-field.service.ts` 的 buildFields 會修改資料，不能當純預查。
- **Decision**：claim 的 job 鎖在獨立短交易釋放。正式核心接受 EntityManager，users→document→job 同一交易寫全部資料與 succeeded。所有狀態更新核對 lease。顯式 creatorUserId 傳遞，不複製登入 session 或另造 CLS 授權。
- **Alternatives considered**：直接呼叫現有 initiate() 後再更新 job 有 crash gap；分批提交 250 人違反全有或全無；先鎖 job 再 users/document 容易反轉鎖序。

## R5：去重不是恰好執行一次保證

- **Decision**：DB 的 document+request key 與 active document unique，加上 document 鎖與 lease 控制業務結果。相同 key 同輸入返回原工作；同 key 改內容、不同 key 搶同文件均 409。
- **Rationale**：BullMQ stalled 工作可能再次投遞；重試必須不改變最終業務結果。參考 [BullMQ stalled](https://docs.bullmq.io/guide/jobs/stalled) 與 [idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)。
- **Alternatives considered**：僅 queue dedup 或僅前端按鈕 disable 無法防重啟、兩分頁與 HTTP 回覆遺失。

## R6：受控執行、有限重試與少量文件等待

- **Decision**：沿用 export processor 的全域並行設定方式，queue 全域 concurrency=1；500 人一批查核、250 筆一批寫入。最多 3 次 claim、30／120 秒 backoff、5 分鐘 lease／30 秒 heartbeat，單 job 含排隊與重試總界線 120 分鐘，且不晚於 signEndAt。
- **Rationale**：單 worker 的 concurrency 不限制多個 worker 總量；[BullMQ global concurrency](https://docs.bullmq.io/guide/queues/global-concurrency) 提供跨 worker 限制。值為首版設計常數，需用混合負載與 SC-006 延遲情境驗收，不新增 env。
- **Alternatives considered**：無限重試會永久卡住；一次 Promise.all 全名單會增加 DB 壓力；立刻新增大小 queue／搶占工作增加鎖與公平性複雜度。
- **Known limit**：大工作執行中小工作仍會排隊；SC-008 量測大型釋放後的小型等待。CPU 長時間佔用 event loop 可能影響 heartbeat，需量測 canonical 快照階段與 stalled 恢復，不宣稱 worker 自動改善總運算時間。

## R7：移除個別 helper 的 6,000 人總數守門

- **Evidence**：`EsignEmployeeEmailService.resolveForInitiation` 現有 userIds.length > 6000 拒絕，但 `UserRepository.findByIdsWithEmail` 已每 500 人處理。
- **Decision**：保留 ID 格式、資格、固定鎖序，移除不必要的總人數拒絕，覆蓋 6,001 人；不新增文件人數上限。有限 HTTP body 與資源限制仍回明確錯誤，不能截斷。
- **Alternatives considered**：只調高常數會再次遇到同一門檻；受理後必然失敗與規格不一致。

## R8：隱私、輸入恢復與列表查詢

- **Decision**：摘要只有狀態／階段／計數；input 與 issues 由建立人按需讀取，issues 分頁。終態敏感明細保留 30 天後清除，摘要與冪等 hash/key 保留。
- **Evidence**：既有 detail 由 document.signers 還原名單，尚未正式發起的 job input 不在那裡；必須提供重整後恢復輸入的途徑。PR #47 已證實大型 JSON 不能隨列表排序。
- **Alternatives considered**：只存前端 state 會在關頁後遺失；每次 polling 回 5,001 人不必要且洩漏範圍大；立即刪終態 job 破壞冪等。

## R9：契約是明確變更，需要協調發布

- **Decision**：同一路由全改 202，要求 Idempotency-Key；同 key 重播 200 job 摘要，取消 201 文件詳情。舊 userId 輸入可接受，但不是完整向後相容。
- **Rationale**：舊 client request 宣告回傳 EsignDocumentDetail，onSuccess 無條件 flash=published；必須一起修改 API 層與 UI。新名單 DTO 不污染共用草稿 DTO。
- **Alternatives considered**：偷偷讓小名單同步與使用者最新要求衝突；新增持久 feature flag 或永久 v2 平行 API 超出範圍。

## 研究結論與設計完成檢查

所有設計疑問已決定並記錄於 plan／data-model／contract。少量排隊、DB／Redis 故障期間無法即時寫狀態、長交易鎖成本與協調發布是已知限制，須透過 quickstart 驗收，不能稱為已驗證。

## R10：規劃複核補充

- **Decision**：受理與人工 retry 都先處理授權後的合法冪等重播，再檢查新工作的期限、draft 與 parent 最新性。stage=committing 以正式交易前的短 CAS 提交。
- **Rationale**：重播不應因時間經過或子工作已建立而失效；正式交易內尚未提交的階段更新不能讓一般輪詢即時看見。
- **Alternatives considered**：先檢查所有業務前置條件會令成功後重送變成 400／409；只在正式交易內更新階段會讓前端持續顯示舊階段。
- **Verification**：唯讀交叉複核現有鎖序、buildFields 寫入、6,000 人守門及 commit 後通知入列。補充過期／清理後重播與 retry 子工作重播驗收；尚未執行功能測試。


## R11：草稿版本必須覆蓋子資料異動且單調

- **證據**：本機 TypeORM Subject 的 mustBeUpdated 依 dirty change maps；UpdateQueryBuilder 的 UpdateDateColumn 使用 CURRENT_TIMESTAMP（整秒）。真 HTTP 測試重現 fields、純名單、note、同秒 title／period 編輯後，舊 retry 錯誤地回 202。
- **決定**：沿現有 document.updated_at，在 document lock 同交易內以 DB UTC_TIMESTAMP(6)、原值+1µs、save後值+1µs 取最大值。不是先 touch 再 save，後者仍可能被 ORM 改回整秒。fields/note 不經 document save 時直接 touch；同值儲存也失效舊 retry。
- **邊界**：新建無舊版本；正式 worker 在驗完 job 後才 activate，status active 的原 save 不觸發草稿 touch，避免自我版本衝突。只有適用公開草稿修改推進版本，不新增 schema。回傳 entity 時間重讀 DB，可信版本仍為 DB raw 微秒字串。
- **驗證**：HTTP 與隔離真 DB；以 SET timestamp 固定此 app pool 的 session clock 驗同秒 dirty/no-dirty，最後重設 session clock，不調整全域 DB 時間。其他測試涵蓋全部草稿修改入口、busy拒絕不改版本、無效修改不提交、worker成功及非草稿note不改文件版本。


## R12：清理 UPDATE 也須只定位已取得的鎖

真DB跨批保留測試重現pool4仍等待50秒；performance_schema證據顯示 `WHERE id IN (378..477)` 的清理UPDATE在PRIMARY key377等待，而377是被SKIP LOCKED略過且不在清單中的parent。決定在每批100列交易內逐個已鎖唯一PK更新；避免最佳化器選掃描計畫而重新碰到略過列。保留既有batch／skip_locked／時間與summary，不以延長timeout或加重試掩蓋。原測試同DB轉綠。


## R13：唯讀員工資格採共享鎖，避免同建立人跨文件受理串行化

- **證據**：正式worker已持users/document/job鎖，在PDF儲存讀取邊界停5秒，另一份既有草稿POST受理耗時5027ms。僅移除accept的X鎖仍會受job.creator FK共享引用等待worker X鎖影響。
- **安全評估**：resolveForInitiation只讀users，Email正規化只在記憶體快照，正式寫入不涉及users。因此S鎖可固定資格／信箱並阻擋停用／同步UPDATE，無需X鎖。
- **決定**：worker全部users及accept/retry建立人皆改S current read，保留users→document→job鎖序與短交易資格原子性。不使用無鎖普通read，不改其他原需X鎖的流程。
- **驗證**：同正式5秒持鎖情境受理降至約12ms；用獨立DB連線發出停用／Email／同步UPDATE，performance_schema證實X請求等待worker S鎖。反向順序先停用則worker S等待後拒絕，沒有部分指派；retry與同key回放可併行，同文件queued仍409且越權404。
- **另行缺口**：同文件修改在committing持document鎖時，原實作等待約5秒後回STATE_CONFLICT而非當下worker執行中。此項已記錄，另以最小快速授權busy讀取補修，仍保留鎖內guard。
