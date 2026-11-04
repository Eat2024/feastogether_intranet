# Research — Spec 025

## 1. 已存在的文件與受理順序

**Decision**: 使用現有文件列與工作資料，無新文件／無 migration。

**Evidence**: esign-draft.service.ts 的 createDraftDocument 建立草稿。esign-initiation-job.service.ts 的 accept 先 normalize，交易內 create job 保存 inputJson、totalCount，提交後才 enqueueInitiation。normalize 已處理期間與重複身分，正式資格仍由 worker 驗證。

**Rationale**: 使用者想要「worker 前可見列表資料」已具可靠儲存基礎，缺口在讀取與呈現。

**Alternatives considered**: 新增列表資料表造成雙重來源；提前寫正式文件日期會破壞失敗恢復及草稿版本；預建正式簽署人會把大量寫入搬回受理流程。均不採用。

## 2. 日期與人數來源

**Decision**: 日期取受理 input_json 的 signStartAt/signEndAt，人數取 total_count；輕量投影，不載入完整 JSON。

**Rationale**: 資料已經原子保存，與此次確認內容一致。不能使用舊草稿期間、名單完成筆數或郵件成功數替代。

**Alternatives considered**: 額外日期欄位能省 JSON 投影但需 schema 與雙寫，目前無證據必要；待效能測試證實不足才另提調整。

## 3. 避免排序記憶體回歸及狀態競態

**Decision**: 排序窄欄位與無排序日期投影分離，使用捕捉的 job ID；列表所有讀取保持同一短 REPEATABLE READ 快照，無寫入／悲觀鎖。

**Evidence**: document.repository.ts 已刻意分離 signing_payload_json 的無排序讀取，避免 MySQL filesort；PR #50 僅投影 isInitiating，尚無日期／人數。

**Rationale**: 即使只 JSON_EXTRACT 小欄位，來源 JSON 仍可能增加排序資料量；分批查詢若讀到不同提交版本，可能呈現 initiating 搭配正式計數或日期缺失。固定快照也涵蓋 creator/count 查詢。

**Alternatives considered**: 排序時直接讀 JSON 有既有 UAT 回歸風險；逐文件讀取形成 N+1；跨查詢只重看 active 任務會在完成瞬間失去日期。

## 4. 合約與 UI

**Decision**: 列表增加可空 initiation 摘要；顯示用 0/N 不改 pendingCount 的正式語意。POST 維持既有 job 回應，client 修正錯誤型別後使用其 totalCount 與此次提交期間初始化快取。

**Rationale**: 避免把尚未建立的簽署人當成正式 pending 紀錄；同一確認資料可立即顯示，重整由 server 恢復。

**Alternatives considered**: 為日期擴充所有 job 查詢會涉及重播、保留清除與詳情裁切，對本需求沒有必要；只在 client 保存摘要無法滿足重新進入與他人閱讀。

## 5. 既有功能依賴

**Decision**: 沿用已合併 PR #50，不 revert PR #49。現有輪詢、狀態及操作保護不重做。

**Evidence**: gh pr view 50 確認 MERGED，時間 2026-11-04T03:23:49Z。

**Rationale**: 本次是日期／預計人數補足，不更動 worker 正式發起交易。無未解決研究問題。

## 6. 文件建立時間

**Decision**: 直接使用既有 createdAt，只新增列表欄位。

**Evidence**: server 的 esign-common.dto.ts、esign-view.mapper.ts 及 client 的 esignDocuments.ts 已提供 createdAt。

**Rationale**: 不需新增 API、欄位或資料回填。

**Alternatives considered**: 受理時間／更新時間無法代表文件建立時間，不採用。
