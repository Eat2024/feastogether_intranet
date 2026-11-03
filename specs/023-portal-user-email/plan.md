# Implementation Plan: Portal 員工資料匯入與本機發起查核

**Branch**: 本輪在 `dev` 產出文件；實作整合分支 `feat/023-portal-user-email`（尚未建立） | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

## Summary

保留選人部門樹與登入的人資來源，名單解析、發起信箱與寄送白名單改用 users。PR #45 與首次 UAT 匯入為已完成前置，不重做 migration。提供人工可重跑的受控維護工具以維持本機來源可信度。維持同步 API。

## Technical Context

- Language/Version：TypeScript 5.7、Node >=24.22.1；繁體中文文案。
- Dependencies：既有 NestJS 11、TypeORM 0.3、mysql2、class-validator、Next.js 16／React 19；無新 dependency。
- Storage：MySQL 8.4 users／既有 esign 表；Redis 僅維持現有部門樹快取。維護原值 artifact 存受控檔案，不進 repo。
- Testing：Jest service tests、MySQL／Redis e2e、client lint/build 與人工瀏覽器流程。
- Platform：既有 Linux HTTP／worker Docker 與人工維護入口。
- Scale：5,001–6,000 內部簽署人，解析每請求最多 100；發起批次讀 users 每批最多 500；不得逐人 HR 或逐人 Email 查詢。
- Performance：量測整份名單解析、Email 取得、發起交易、寄送政策耗時，這些階段 HR 呼叫必須為零；不以未測量的秒數或倍數宣稱完成。
- Constraints：不改登入認證／部門樹，不引入新表、env、fallback、排程，不更動歷史證據或固定信箱。

## Constitution Check

| Gate | 設計前／後結果 |
| --- | --- |
| KISS/YAGNI | 通過：修改現有 service／repository，維護 CLI 是 US1／US4 所需，沒有 provider framework |
| Server 權威 | 通過：發起交易內鎖定人員與驗證，不信任 client Email |
| 隱私 | 通過：email 維持 select:false，回應 DTO 不含新增 Email，artifact 僅維運可讀 |
| 系統邊界 | 通過：HTTP 契約不變，Repository 接收 EntityManager，client 不 import server |
| 驗證 | 通過：規劃真實 MySQL 的競態／回滾與合成資料驗收，未將規劃當成已測試 |

## Project Structure

- 文件：spec.md、research.md、data-model.md、contracts/local-directory.md、quickstart.md、tasks.md、checklists/requirements.md。
- `server/src/features/users/repositories/user.repository.ts`：受限批次信箱查詢與交易鎖。
- `server/src/features/esign/services/esign-signer-candidate.service.ts`：本機解析，org chart 不改。
- `server/src/features/esign/services/esign-employee-email.service.ts`、`esign-initiation.service.ts`：交易內資料與快照一致性。
- `server/src/infrastructure/mail/mail-recipient-policy.service.ts`：本機白名單資料。
- `server/src/maintenance/portal-users.ts`、`portal-users.spec.ts`（新增）：人工維護 CLI 與驗證，沿用既有 DB config／UserRepository，不建立常駐服務。
- `server/test/portal-user-import.e2e-spec.ts`（新增）、既有 candidate／initiation／capacity／mail-whitelist e2e：真實資料庫驗證。
- `client/src/features/esign-documents/DocumentSignersEditor.tsx` 與 API 型別註解：缺同步提示及維持阻止部分發起。
- `.scratch/023-portal-user-email/issues/`：本機 tickets；依 repo 規則不建立 GitHub Issues。

## Implementation Design

1. **前置**：確認 PR #45 存在，不再新增 email migration；使用者 UAT 核對結果只記錄彙總。
2. **匯入工具**：解析七欄 HEX TSV，SQL NULL 與空字串明確處理；先做完整驗證與精確員編對應。依 data-model 限制與 normalize email 規則，拒絕無法對應的大小寫／collation 衝突。產出 SHA256 綁定來源、目標 DB 身分及原值集合的私有預覽檔。
3. **預覽／apply**：預覽無寫入。apply 驗證 hash、目標及每筆原值，在單一 transaction 依 id 遞增鎖舊帳號；新增員編在交易內再檢查，唯一鍵衝突整批回滾。只 save 真正改變的欄位，保護 is_active／deleted_at／外鍵／登入資訊。既有停用帳號略過，非 0／1 來源略過並統計，不自動離職。回復設計見 data-model。
4. **解析**：保留 dedupe 及輸入順序，一次批次本機查詢，不再 importStaff；查無／停用回 unavailable。候選回應不新增 email；前端以既有名單顯示「無法指定，請確認帳號狀態或同步員工資料」，任何 unavailable 阻止整份發起。
5. **正式發起**：交易外只做必要的輸入與存取預檢；交易內先依 user id 排序鎖發起者與內部簽署人，再鎖文件並重新授權。顯式選取 Email、員編、姓名、部門、職稱與狀態，所有指派及快照均由同 manager／同一組被鎖定資料導出；將已鎖定 users 顯式傳給 signer 建立流程，避免 repeatable-read 的一般 SELECT 取回先前快照。保持 6,000 上限、外部 Email、既有文件狀態與權限檢查；缺信箱存 null 並產生 RECIPIENT_UNAVAILABLE，不查 HR。來源故障整筆失敗。
6. **白名單**：規則每次重新讀，完整 email 直接命中；其他收件人依有效 users 的精確員編／直接部門取得允許信箱集合，只回傳原請求地址的交集。規則或 users 查詢失敗皆 MailWhitelistCheckFailedError；空結果是阻擋，不能混用。
7. **歷史與登入**：通知 worker 使用 esign_signers.email 固定值。一般 User 查詢仍不帶 email；登入 save 不清除未選取 email，並用回歸測試證明。來源移除只針對本規格列出的電子簽流程。
8. **交付**：US1 工具與 US2 切換可各自驗收；整套啟用要完成 US3／US4 與整合驗證。部署與寄信由後續明確操作執行；這輪只規劃。

## Complexity Tracking

無憲章例外。維護原值檔與回復檢查服務 US4，不新增永久批次表。與首次手動 SQL 相比增加的驗證用於防止覆寫登入同步及刪除已被引用的新員工。
