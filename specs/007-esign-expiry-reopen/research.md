# Research: 文件到期與補簽

調查日期：2026-10-19。依本機程式與規格完成；未採用新的外部套件或遠端技術假設。Phase 0 由主代理與唯讀研究代理共同查核，未改動應用程式。

## 1. 原始期限與有效期限

**Decision**: `signEndAt` 改為目前有效期限；`signingPayloadJson.period.endAt` 繼續保存原始期限且整份 payload/hash 不變。摘要新增 `originalSignEndAt` 與 `isReopened`，後者比較有效期限與原始期限。不新增 effective deadline 或輪次欄位。

**Rationale**: `esign-initiation.service.ts` 已將 period 放入固定快照；`esign-signing.service.ts` 與 `completed-pdf.service.ts` 沿用 payload hash，不以當前 signEndAt 重建 payload。現有截止查詢、驗證及索引均使用 signEndAt，直接明定其語意可減少修改。`EsignDocumentValidationService.assertSigningSnapshot` 比對原檔及欄位，不要求原期限等於有效期限。

**Alternatives considered**: 新增有效期限與輪次兩個欄位會重複既有資訊；重建 payload 則破壞舊證據。原始快照缺漏或 hash 不符時拒絕補簽，不猜測原期限。

## 2. 到期狀態與無副作用查詢

**Decision**: 保存 `expired`，既有 worker 負責落實；GET 使用同一查詢時間計算有效狀態但不寫入。有效狀態規則為 persisted active、pendingCount > 0、有限 signEndAt <= now 時回 expired，其餘沿用 persisted 狀態。

**Rationale**: 目前 `esign-expiry.service.ts` 呼叫 `stopByDeadline`；query.list 在 mapper 前直接依 persisted 狀態篩選，必須改成以有效狀態篩選，避免延遲處理時漏列。補簽也接受邏輯到期的 active，在同交易補上到期事件。無需新排程。

**Alternatives considered**: 僅前端推導無法保護簽署；僅等 worker 落盤會暫時顯示錯誤。GET 直接修資料違反唯讀原則。

## 3. 最小重送防護

**Decision**: 要求 `expectedSignEndAt`；文件鎖內比對當前期限，再驗證目前已到期且新期限 > 鎖內 now。成功後新期限嚴格大於舊期限，舊要求永遠無法再次比對成功。

**Rationale**: `new > now >= old` 提供單調遞增的業務版本；相同輪次同時提交只能一筆成立，隔輪重送仍失敗。409 後重新讀取，不自動以最新期限重送。無需 request-id 表、分散式鎖或 counter。

**Alternatives considered**: 只驗 expired 會讓舊請求在下一輪到期再次成功；新增版本欄位可行但此流程已有可比對的期限。若將來允許縮短／提前延期，必須重評此前提。

## 4. 稽核與證據

**Decision**: 新增 `document.expired` 與 `document.reopened` 事件，復用既有 metadataJson、actorUserId、occurredAt 及 hash 鏈。明確擴充 `esign-audit.service.ts` 的 metadata 白名單，僅增加 previousSignEndAt、signEndAt、expiredAt 等日期值。

**Rationale**: `audit-event.repository.ts` 已以文件鎖串接事件。history 原 mapping 直接輸出 reason，補簽事件需依角色裁切，不能把原始 metadata 透傳。原始期間＋每次期限異動形成授權歷程，簽署證據不重算；驗證舊副本時維持其既有稽核鏈前綴語意。

**Alternatives considered**: 新建補簽表與稽核雙寫沒有必要；覆寫原原因／期限則失去多輪歷程。

## 5. 外部邀請與寄信工作

**Decision**: 補簽只為 pending email signer 產生新 digest/ciphertext，expiry=新期限；不建立通知 batch/log 或寄信工作。新增 creator-only 唯讀邀請入口供手動轉交，使用既有橋接網址格式。

**Rationale**: 現有 `EsignTokenService` 可產生／解密憑證，但 `DocumentsController` 沒有取邀請端點，不能宣稱既有入口可用。新補簽憑證密文保留至簽署、到期或停止，讀取不輪替。

**Decision**: 同補簽交易中，將未結束的舊邀請 log 標成 failed、errorCode=`INVITATION_SUPERSEDED`，清 processingStartedAt／nextAttemptAt 並記 completedAt。scanner 與 processor claim 明確排除此 terminal errorCode（SQL 須保留 error_code IS NULL 的合法可重試資料）；成功回寫再核對 claim token digest／期限與當前值。新一輪邀請 delivery 顯示 null，不沿用舊寄送成功記錄。

**Rationale**: 現有 worker 會從 signer 讀取最新密文，寄送成功後清密文；若沒有防護，舊工作可能寄出或清除補簽憑證。failed＋nextAttemptAt=null 本身仍會重試，所以必須明確排除 terminal code。已在寄送中的舊郵件可能送達，但僅攜帶失效舊 token，不能抹除新憑證。

**Alternatives considered**: 自動寄出補簽通知超出規格；刪除 log 會破壞紀錄；新增通知狀態或世代欄位對本次範圍非必要。

## 6. 既有副本與 finalizing

**Decision**: 保留 finalizing；補簽只限已到期且仍有 pending。`completed-pdf.service.ts`、`document-finalization.processor.ts`、已簽者來源讀取白名單納入 expired。保留既有 finalizing 可人工停止行為。

**Rationale**: 已簽者的個人副本可在其餘人逾期後才完成；新狀態不能讓其產製失敗。全員簽完後原流程要等個人副本完成才結案，不能簡化成直接 completed。

## 7. 交付與遷移

**Decision**: 僅修改文件狀態 CHECK；不遷移 stopped。HTTP 與 worker 必須協調更新，不能混跑會把到期文件永久停止的舊 worker。回滾不得擅自將 expired 改成 stopped。

**Rationale**: 既有狀態是 varchar＋CHECK，不需要新增資料表或欄位；schema.sql、entity 與 migration 必須一致。down 有 expired 或補簽事件時應先拒絕，避免舊程式誤解已補簽資料；無新業務資料的測試庫才驗證完整 up/down。

所有設計未知項均已解決。既有 mock 尚未接正式 API 是交付依賴，不是假定已完成的能力。
