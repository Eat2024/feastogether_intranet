# 04: 同部門列表、唯讀 API 與隱私裁切

**What to build:** 以 server 部門查詢提供文件列表、詳情、來源預覽與文件層級歷程，嚴守發起人管理邊界。

**Blocked by:** [03](./03-trusted-department-policy.md)

**Status:** resolved

**Spec:** [Spec 017](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/spec.md)；US1；FR-001/002/005/006/007/008；SC-001/003。

**Tasks:** T011、T012、T013、T014、T015、T016；[原始清單](https://github.com/Eat2024/feastogether_intranet/blob/a827699743ccf306900f33a05064c76f954c13b0/specs/017-department-document-visibility/tasks.md)。

**執行約定:** 遵循 [切分索引](../README.md) 的共用約定；前置 tickets 皆 resolved 才可開始。開始改 claimed，驗收通過且合併功能整合分支後改 resolved，追加驗證命令、結果與 commit，保留原驗收條件。

## 驗收條件

- [x] role=dep 在 DB 依代碼精確比對並排除軟刪除，保留排序、有效到期狀態及 created／assigned／未帶 role 語意；all／偽造部門參數拒絕。
- [x] isCreator 區分管理與唯讀 DTO；唯讀僅回契約允許欄位，不傳 Email、note、個別拒簽理由、邀請／驗證憑證、寄送資格、原始簽名或 object key。
- [x] 同部門可讀草稿／詳情／來源及文件層級歷程；保留本人事件、來源完整性與快取／嵌入政策，補簽邀請 GET 仍限建立人。
- [x] T011／T012 測試先紅後綠：401／409／404、直接 ID 與各管理入口拒絕後無 DB 寫入或 queue job；query service 的列表與詳情修改序列整合。

## 原始任務範圍

- [x] T011 [P] [US1] 建立 `server/src/features/esign/services/esign-document-query.service.spec.ts`，測試 dep 精確比對、所有狀態／已刪除、status 有效到期推導、created／assigned／未帶 role 回歸、isCreator、詳情裁切與文件層級歷程；先對缺少 dep 功能確認失敗。
- [x] T012 [P] [US1] 在 `server/test/esign-department-visibility.e2e-spec.ts` 與 `server/test/security-esign-department.e2e-spec.ts` 建立列表、直接 ID、來源預覽、草稿唯讀、未知 all／偽造部門參數、401／409／404，以及非建立人編輯／刪除／發起／停止／補簽／備註／通知／邀請 GET 拒絕案例；拒絕後驗證無 DB 寫入或 queue job。
- [x] T013 [US1] 在 `server/src/features/esign/repositories/document.repository.ts` 增加文件建立部門代碼等值查詢，deleted_at IS NULL、updated_at DESC／id DESC；在 `server/src/features/esign/services/esign-document-query.service.ts` 接 dep 分支，部門取自登入 User，不載入全公司後再裁切，保留個人查詢語意。
- [x] T014 [US1] 更新 `server/src/features/esign/dto/document-query.dto.ts` 與 `server/src/features/esign/controllers/documents.controller.ts` 支援 dep／created／assigned 及原 status；不支援 all 或 caller departmentCode；更新 Swagger，串接 userId，通過列表測試。
- [x] T015 [US1] 在 `server/src/features/esign/dto/esign-common.dto.ts` 與 `server/src/features/esign/services/esign-view.mapper.ts` 定義以 isCreator 區分的管理／唯讀 DTO，必要時更新呼叫 mapper 的簽署任務型別；唯讀僅含契約列出的文件／來源 metadata 與姓名、狀態、時間，不能傳 Email、note、個別拒簽理由、驗證連結、邀請憑證、寄送資格或 object key。
- [x] T016 [US1] 在 `server/src/features/esign/services/esign-document-query.service.ts` 將詳情與來源讀取改用 T009 唯讀政策，重命名 creatorDetail／creatorSource 至符合共用讀取責任並更新 `server/src/features/esign/controllers/documents.controller.ts` 呼叫；history 增加同部門文件層級事件視角，保留本人簽署視角、來源完整性驗證，reopeningInvitations 仍限建立人。

## Ticket 04（T011–T016）

- T011先紅5 failed／3 passed（缺dep/唯讀功能及history未帶signerId的管理事件裁切），實作後query單元9 tests通過。
- 安全E2E先確認同部門detail 404、dep缺功能400；補合法multipart與發起body後4 tests全綠，含14管理入口拒絕及文件／簽署人／audit／notification／queue均無變更。
- 正常E2E 7 tests通過：兩部門各兩位建立人×六狀態、NULL舊文件、精確大小寫／同名異碼、來源PDF、DTO裁切、歷程、個人查詢、調職舊session。
- 全server unit 109 suites／1,041 tests通過，server build、修改檔ESLint 0 errors/warnings通過。
- 契約補全canExport與既有GET detail的view=export；同部門才可取得完整Excel欄位，草稿404，GET不寫紀錄，不影響一般唯讀裁切。詳見department-access.md。

直接整合commit：`git log --grep="feat(spec017): add department read APIs"`。
