# Phase 0 Research：內部員工 Email 簽署

2026-10-21。依本機 intranet／fgapi 原始碼與測試研究，未呼叫真實名冊、未寄信。依 speckit-plan 分別研究身分／模型與簽署／通知，所有設計未知已收斂如下。

## 1. 組織快取與員工解析

**Decision**: 保留 org-chart Redis 7,200 秒 TTL；新增 POST resolutions 承接選取員工的建帳，GET candidates 改唯讀。

**Rationale**: getOrgChart 已有環境／來源隔離、讀不續期、miss 才更新；組織樹沒有本機 userId。既有 list() 對完整員編查無時會建帳，與 GET 無業務寫入原則衝突。

**Alternatives considered**: 繼續 GET 隱性寫入不符合憲章；整樹匯入超出範圍；員編不能當 userId。

**Evidence**: `server/src/features/esign/services/esign-signer-candidate.service.ts`、`controllers/signer-candidates.controller.ts`、Spec 006。

## 2. 信箱來源與批次

**Decision**: 經既有 FeastogetherClient.post 與 HR service 呼叫 staff_emails，100 人一批，最多 4 批併發、10 秒逾時、不自動重試，不建 email cache。

**Rationale**: 上游省略查無／非在職／無 email 人員，且非 NULL 不保證合法 email。用員編 Map 核對，缺漏與不合法地址標 unavailable；結構錯誤、重複／請求外員編與失敗 envelope 回 502。來源每天同步，非即時在職證明。

**Alternatives considered**: 依位置配對會錯寄；組織快取不含 email；全公司 email cache／同步排程未獲要求。

**Evidence**: fgapi `routes/api.php`、`app/Http/Controllers/Api/V1/UserController.php:getStaffEmails`、`app/Http/Docs/V1/UserControllerDocs.php`、`tests/Feature/StaffEmailsTest.php`。intranet `FeastogetherClient` request／unwrap 兩處 omitBody 都要加此路徑，並嚴格檢查 success envelope。

## 3. 發起交易

**Decision**: 上游呼叫在文件交易外；交易內鎖草稿、重驗 creator／帳號及同份 request 的 userId→empid，固定地址後才建 snapshot。

**Rationale**: 6,000 人需 60 批，持鎖呼叫會延長文件交易。現有 initiation 本就完整取代 request 名單／欄位，保留語意即可，不新增 revision。

**Alternatives considered**: updatedAt 無法涵蓋所有子資源異動；revision 需改全部草稿寫入，非本需求；部分發起違反 Q1。

**Evidence**: `esign-initiation.service.ts`、`esign-signer.service.ts`、`esign-field.service.ts`。

## 4. Schema

**Decision**: 沿用 signer.email／invitation，放寬 user identity CHECK；新增 derived external_email unique。

**Rationale**: 原 CHECK 禁止 user email／token／expiry，原 document_id,email unique 阻擋同信箱員工。derived 欄位只作約束，無第二份可編輯業務資料。

**Alternatives considered**: 改外部 type 會丟員工身分；新表不必要；unique(document_id,signer_type,email) 仍擋 user 同信箱；只刪索引則失去外部 DB 去重。

**Evidence**: `server/src/features/esign/entities/esign-signer.entity.ts`。migration 與 generated column 須以真實 MySQL schema tests 驗證，不僅靠 mock。

## 5. 共用 Email 通道

**Decision**: 保持 external-* 路徑、cookie、Redis credential，允許具邀請的 user signer；舊個人操作僅員工 session 不可讀檔／簽署／拒簽，列表 metadata 與管理權限保留。

**Rationale**: 已有 OTP、generation、寬等、本人副本機制；驗證通道不等於 signer 身分類型。服務重送分支也需驗證，不能只擋 controller。

**Alternatives considered**: 新 cookie／API 形成平行流程；員工登入略過 OTP 違反 Q4／Q6。

**Evidence**: `external-access.service.ts`、`external-access-credential.service.ts`、`external-otp.service.ts`、`esign-access-policy.service.ts`、`esign-signing.service.ts`、`esign-rejection.service.ts`、`esign-completion-access.service.ts`、`signing-tasks.controller.ts`。task mapper 必須裁切新出現的員工資料。

## 6. 通知與補簽

**Decision**: worker／reminder／initiation 支援所有指派；補簽增加通知、固定原信箱且只輪替 pending；log 記 generation，worker 前後核對。取補簽連結清單省略已寄後清除密文者。

**Rationale**: 現有 reopen 只換外部 token，不寄信；worker 寄成功會清密文，舊連結查詢在缺密文時會 503，需一起改。

**Alternatives considered**: 永久留密文只為複製連結不必要；重做 queue 不必要；按信箱去重違反 Q3，補簽重查地址違反 Q2。

**Evidence**: `esign-reopening.service.ts`、`esign-document-query.service.ts`、`esign-reminder-policy.ts`、`esign-reminder.service.ts`、`server/src/worker/esign/external-invitation.processor.ts`。

## 7. 治理與交付

**Decision**: 憲章 1.5.0 同步使用者已核准的內部 Email＋OTP；本次只 plan 與契約，後續實作僅後端。

**Rationale**: Q1–Q6 已確認，使用者再明確要求先寫 plan、不寫 code。新 API 必須標規劃中，不能說已可用。

**Alternatives considered**: 不處理憲章會留下文字衝突；再次詢問已確認的相同授權沒有必要。
