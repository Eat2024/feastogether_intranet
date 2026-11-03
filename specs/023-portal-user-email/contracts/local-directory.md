# 本機人員來源契約

## HTTP

既有 session／建立人授權與 response envelope 不變；不新增 endpoint。

### POST /api/esign/signer-candidates/resolutions

- Request：employeeNos 字串陣列，1–100 項，每項 1–20 ASCII 英數；前導零不去除。輸入驗證失敗維持既有 400。
- Response 200：items，去重後依首次輸入順序；每項 employeeNo、userId/name/department/title（可 null）、status: resolved | unavailable。不得新增 Email。
- 缺本機帳號與停用／刪除維持 unavailable，不查 HR、不建帳；UI 提供同步／確認資格提示，任何 unavailable 阻止部分發起。
- DB 故障為失敗回應，不能偽造成功 unavailable 集合；沿用 ESIGN_EMPLOYEE_DIRECTORY_UNAVAILABLE 的既有集中錯誤定義。
- 5,001 人由 client 現有每批 100 路徑完成；不改為 202、不新增 job ID。

### 既有正式發起端點

維持 initiation.dto.ts 與既有 controller 的路徑、回應及上限；內部 userIds 由 server 驗證，外部 Email 指派語意不改。交易內重新核對有效員工，缺身分維持 ESIGN_EMPLOYEE_IDENTITY_UNAVAILABLE／IDENTITY_CHANGED 適用錯誤；DB 信箱取得錯誤維持 EMAIL_SOURCE_UNAVAILABLE 類別，但文案更新為員工資料來源，不提 HR。

有效內部員工 email=null 可發起，寄信紀錄 skipped／RECIPIENT_UNAVAILABLE。主檔 email 只在 server 使用，不加入候選或登入回應；Client 自報內部 email 不採信。

### 選人組織樹與登入

來源、快取、授權與回應維持原行為，不能用「所有 HR 都不可用」的測試同時要求部門樹仍可重新載入。離線測試必須先取得選人資料及有效 session，再對解析／發起／寄送計數。

## 寄送 policy 內部介面

allowedRecipients(recipients: readonly string[]): Promise<Set<string>> 簽名不變。完整 Email 規則全部命中可免查 users；規則表故障仍失敗。部分命中後 users 查詢故障：整次 MailWhitelistCheckFailedError，不傳回部分允許集合。正式環境 bypass 留在既有 sender 邊界。

## 維護 CLI（待實作）

入口：server/src/maintenance/portal-users.ts，使用現有 TypeScript 執行工具與 DB 設定，不新增環境變數。

- preview --input <private.hex.tsv> --output <private-preview.json> [--exclude-file <private-exclusions.json>]
- apply --preview <private-preview.json> --output <private-result.json>
- rollback-preview --result <private-result.json> --output <private-rollback.json>
- rollback --preview <private-rollback.json>

輸入七欄 header：empid_hex、name_hex、department_code_hex、department_name_hex、email_hex、person_status、title_name_hex。HEX 必須合法且可完整還原 UTF-8；字面 NULL 為來源 SQL NULL；只有 optional 空值可轉 null。拒絕欄位缺漏、畸形列、空檔、未知映射與衝突員編；合法但不合格狀態列統計略過。

preview 不寫 DB；apply 不另連 Portal，必須使用預覽綁定快照與原值。DB commit 前任何檢查／寫入失敗 exit 非零且整批回滾；DB commit 後結果檔寫入失敗則 exit 非零並要求人工對帳，不宣稱資料已回滾；不輸出原始名冊或憑證。已成功 apply 的同一預覽不重複套用，須重新 preview 才可再次確認 no-op。完整重跑同來源的新預覽不得改 updated_at。
