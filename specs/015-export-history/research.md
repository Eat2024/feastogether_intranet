# Research：歷史匯出紀錄 API

## R1 沿用 `esign_export_jobs`，不新建 table

**Decision**：三種紀錄都存在既有的 `esign_export_jobs`，以 `export_type` 區分。

**Rationale**：
- 這張表從初始 schema 就有 `export_type`、`document_id`、`created_by_user_id`、`scope_description`、`record_count`、`completed_at`、`created_at`，正是匯出紀錄需要的欄位。
- ZIP 專用欄位全部可為 NULL，Excel／PDF 紀錄不會用到。
- 查詢、總筆數與分頁都在同一張表完成，不需要跨表 UNION。

**Alternatives**：新增 `esign_export_records`。AGENTS.md 與 constitution 都要求未經需要不新增 table，而既有表已能承載，因此不採用。

## R2 API `type` 與 DB `export_type` 的對應

**Decision**：API 的 `excel`、`pdf`、`zip` 對應 DB 的 `excel`、`pdf`、`signed_copies_zip`；對應表只放在 history service 一處。

**Rationale**：ZIP 的背景工作、重用、重試與清理都以字串 `signed_copies_zip` 判斷，`esign_file_objects.file_purpose` 也用同一個值。不改 ZIP 的 DB 值，就不用動 ZIP 流程與它的測試。

**Alternatives**：以資料 migration 把 ZIP 改成 `zip`。這會改到 ZIP 流程的多處字串與 CHECK，但對使用者沒有差別，因此不採用。

## R3 Excel 匯出條件存在新欄位 `conditions_json`

**Decision**：新增可為 NULL 的 `conditions_json`，只有 `excel` 紀錄使用。

**Rationale**：既有 ZIP 程式以 `snapshot_json IS NOT NULL` 辨識 ZIP 工作，例如重試掃描與 ZIP 歷史。若把 Excel 條件放進 `snapshot_json`，Excel 紀錄就會被當成 ZIP 工作，還得逐一補上類型條件。

**Alternatives**：沿用 `snapshot_json`。會和 ZIP 工作混淆，因此不採用。

## R4 PDF 的簽署人與匯出人

**Decision**：
- 新增可為 NULL 的 `signer_id`（外鍵連到 `esign_signers`），記錄這份副本屬於哪位簽署人；只有 `pdf` 紀錄使用。
- `created_by_user_id` 改為可為 NULL。NULL 代表「簽署人本人下載」，匯出人就是 `signer_id` 指向的簽署人。
- 匯出人顯示：
  - 員工：`users.name` 與 `users.empid`。
  - 本人下載的內部簽署人：`name_snapshot` 與 `empid_snapshot`。
  - 本人下載的外部簽署人：`name_snapshot` 與 `external_email`。

**Rationale**：
- 外部簽署人不是員工，無法填 `created_by_user_id`。
- 簽署人的姓名、員編與 Email 在發起時就已固定，不需要再另存匯出人快照。
- 內部簽署人本人下載時，也一律用「NULL 代表本人」的規則，不必區分內外部兩種寫法。

**Alternatives**：
- 新增匯出人姓名／Email 快照欄位：資料與簽署人快照重複，因此不採用。
- 內部本人下載時填 `signer.user_id`：同一種情況要用兩種規則，因此不採用。

## R5 會寫入紀錄的下載改用 POST

**Decision**（使用者決定）：
- 新增三個 POST 子資源，直接回傳 PDF：
  - `…/signers/{signerPublicId}/completed-file/downloads`
  - `/api/external-signing-task/completed-file/downloads`
  - `/api/esign/history/export/{id}/downloads`
- 移除原本兩個 GET 下載路由。

**Rationale**：constitution IV 規定 GET 不得產生業務寫入。專案也有先例：開啟外部任務會記錄稽核，所以用 POST，唯讀查詢則用 GET。保留舊 GET 等於留一條不記錄的下載路徑。

**Alternatives**：修訂 constitution，允許下載時寫紀錄。使用者選擇不修改。

## R6 紀錄寫入時機

**Decision**：讀檔與完整性驗證成功後、送出回應前，新增一筆紀錄。寫入失敗時拋出錯誤，回 500，不送出檔案。

**Rationale**：
- 副本未產生或驗證失敗時，不會留下紀錄。
- 有回傳檔案，就一定有紀錄。

若紀錄寫入後用戶端中斷連線，紀錄代表「已取得」。這種情況可接受，不另做補償。

## R7 頁碼分頁與總筆數

**Decision**：
- 列表：`WHERE export_type = ? [AND document_id = ?] ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`。
- 總筆數：`SELECT export_type, COUNT(*) … GROUP BY export_type`，同時產生 `total` 與 `typeTotals`。
- 新增索引 `(export_type, created_at, id)`；有帶 `documentId` 時，使用既有的 `document_id` 索引。
- `zip` 類型沿用既有 ZIP 歷史的條件 `snapshot_json IS NOT NULL`，總筆數也套用同一條件。

**Rationale**：匯出紀錄量級為數千到數萬筆，OFFSET 分頁的成本可接受，也符合現有畫面的頁碼分頁。

## R8 Excel 重新下載資料

**Decision**：新增 `GET /api/esign/history/export/{id}/document`，所有員工都能使用，只回產生 Excel 需要的欄位。

**Rationale**：
- 使用者決定重新下載不擋權限，但文件詳情只限建立人，而且含管理備註、通知紀錄等 Excel 用不到的資料。
- 另開一個窄回應，既能滿足需求，也符合 constitution III 的資料最小化。

**開放範圍**：由 Portal 決定（使用者決定）。能進入電子簽的員工都能取得任一文件的簽署人清單，包含 Email 與拒絕原因；電子簽加上 role／permission 後再限制。

## R9 ZIP 下載不記錄

**Decision**（使用者決定）：ZIP 維持一個匯出工作一筆紀錄。

**Rationale**：ZIP 下載支援 Range 續傳，一次下載可能拆成多個請求。另外，七天重用與「最近一次匯出」都依這些紀錄判斷。

## R10 只做後端

**Decision**（使用者決定）：本 spec 只做後端，不改 `client/`；後端完成後把 contract 交給前端工程師。

**影響**：移除 `GET /api/esign/exports` 與兩個 GET 下載路由後，現有的 ZIP 面板、檢視頁下載與外部簽署完成頁下載會失效，直到前端改完。部署時前後端必須一起上；contract 的「前端交接」已把這三處列為必須同時部署。

**Alternatives**：先保留舊路由，等前端改完再移除。舊 GET 下載是不記錄的路徑，與 FR-014 衝突，因此不採用。

## R11 Migration 回退

**Decision**：`down` 在已有 `excel`／`pdf` 紀錄時拒絕回退；沒有時才移除 CHECK、索引、外鍵與欄位，並把 `created_by_user_id` 改回 NOT NULL。

**Rationale**：沿用 `1792454402000-ExternalReminders` 的做法，避免回退時悄悄刪掉稽核紀錄。

## R12 CHECK 約束

**Decision**：新增 `chk_esign_export_jobs_record_type`，規則如下：
- `excel` 必須有 `conditions_json` 與 `created_by_user_id`，且沒有 `signer_id`。
- `pdf` 必須有 `signer_id`，且沒有 `conditions_json`。
- 其他類型（含 ZIP 與既有舊資料）必須有 `created_by_user_id`，且兩個新欄位都是 NULL。

**Rationale**：
- 由 DB 保證「NULL 匯出人一定是本人下載的 PDF」。
- 既有資料一定符合第三條，加上 CHECK 時不會失敗。
- 專案已有 CHECK 先例，例如 `esign_file_objects`、`esign_document_fields`。
