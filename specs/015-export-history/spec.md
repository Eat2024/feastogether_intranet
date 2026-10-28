# 功能規格：歷史匯出紀錄 API（history/export）

**Feature Branch**: 未建立專用分支；目前為 `dev`

**Created**: 2026-10-28

**Status**: Ready for planning — 規則已確認

**Input**: 「api的部分我想切一個history/export?type=....」；以及「未紀錄的要紀錄，excel清單目前沒過後端？那可能要一隻api讓他打給後端紀錄匯出紀錄……單人pdf也要有記錄進db……簽到表先不用，type就是tab項目」

## Clarifications

### Session 2026-10-28

- 使用者確認：目前沒有記錄的匯出都要記錄。Excel 簽署紀錄清單在瀏覽器產生，由前端呼叫後端 API 記錄；單人已簽 PDF 由後端在下載時寫入 DB。
- 使用者確認：簽到表本次不做。
- 使用者確認：`type` 對應歷史匯出文件頁的頁籤，只有三種：`excel`、`pdf`、`zip`。
- 使用者確認：新的 `GET /api/esign/history/export` 取代 `GET /api/esign/exports`；建立人匯出頁的 ZIP 面板改用新路由。
- 使用者確認：分頁使用頁碼加總筆數（沿用現有畫面的頁碼分頁與頁籤筆數）。
- 使用者確認：所有有效員工 session 可查看全部匯出紀錄（沿用 Spec 009），不再以前端管理者名單 `ADMIN_EMPLOYEE_IDS` 限制。
- 使用者確認：重新下載先不擋權限，所有有效員工都能重新下載任一紀錄；每次重新下載都產生一筆新的匯出紀錄，匯出人是重新下載的人。
- 使用者確認：後端先支援 `zip` 類型；歷史頁要不要新增 ZIP 頁籤，由前端工程師評估。
- 使用者確認：簽署人下載本人副本也要記錄。內部與外部簽署人都在 Email OTP 簽署頁下載本人副本（舊的內部副本入口已停用，一律回 403），所以只有這一個入口。
- 使用者確認：ZIP 下載（含重新下載）不產生紀錄，維持「一個匯出工作一筆紀錄」。ZIP 下載支援 Range 續傳，逐請求記錄會讓一次下載變成多筆；七天重用與「最近一次匯出」也依這些紀錄判斷。
- 使用者確認：會寫入匯出紀錄的 PDF 下載一律改用 POST 並直接回傳 PDF，移除原本的 GET 下載路由（constitution IV：GET 不得產生業務寫入）。
- 使用者確認：本 spec 只做後端；後端完成後交給前端工程師串接。
- 使用者確認：資料開放範圍由 Portal 決定，本專案不判斷；等電子簽加上 role／permission 後再限制。
- 使用者確認：Excel 下載時，前端呼叫後端 API 回報這次匯出的資訊，由後端寫入紀錄。

## User Scenarios & Testing

### User Story 1 - 依類型查看所有人的匯出紀錄 (Priority: P1)

有效員工在歷史匯出文件頁切換頁籤，查看各類型的匯出紀錄，並以頁碼翻頁。

**Why this priority**: 歷史頁目前讀的是前端記憶體中的示意資料，重啟就消失，也看不到後端 ZIP 以外的紀錄。

**Independent Test**: 分別產生 Excel、單人 PDF、ZIP 匯出各數筆，以不同員工身分查詢各類型，核對筆數、排序、分頁與欄位。

**Acceptance Scenarios**:

1. **Given** 有效員工 session，**When** 以某個 `type` 查詢，**Then** 依匯出時間由新到舊回傳該類型的紀錄，不限建立人或匯出人。
2. **Given** 任一類型的紀錄超過一頁，**When** 指定頁碼，**Then** 回傳該頁資料與總筆數，翻頁不漏不重。
3. **Given** 頁籤需要顯示各類型筆數，**When** 查詢任一類型，**Then** 回應同時附上各類型的總筆數。
4. **Given** 每筆紀錄，**Then** 包含匯出時間、文件名稱、文件編號、匯出範圍、筆數與匯出人。匯出人是員工時顯示姓名與員工編號，是外部簽署人時顯示姓名與 Email。
5. **Given** ZIP 紀錄，**Then** 另含工作狀態、快照時間、預期／已處理／等待份數、完成與到期時間、失敗原因與可下載檔案，與目前 ZIP 工作狀態相同。
6. **Given** 沒有員工 session 或只有外部簽署 session，**When** 查詢，**Then** 拒絕存取。

### User Story 2 - 記錄 Excel 簽署紀錄清單匯出 (Priority: P1)

使用者下載 Excel 時，前端先呼叫後端記錄，記錄成功才下載檔案。

**Why this priority**: Excel 在瀏覽器產生，後端目前完全不知道有人匯出過。

**Independent Test**: 以不同條件匯出 Excel 兩次，確認歷史出現兩筆，匯出範圍、筆數與條件正確；記錄失敗時不會下載檔案。

**Acceptance Scenarios**:

1. **Given** 使用者選好狀態、部門與欄位條件，**When** 下載 Excel，**Then** 後端新增一筆紀錄，保存匯出人、文件、時間、範圍說明、筆數與匯出條件。
2. **Given** 記錄失敗，**When** 前端收到錯誤，**Then** 不觸發下載並顯示錯誤，可重試。
3. **Given** 文件不存在或仍是草稿，**When** 嘗試記錄，**Then** 拒絕且不新增紀錄。
4. **Given** 條件含不認得的狀態或欄位、範圍說明過長或筆數不合法，**When** 送出，**Then** 回 400，不新增紀錄。

### User Story 3 - 記錄單人已簽 PDF 下載 (Priority: P1)

任何人下載某位簽署人的已簽副本時，後端自動記錄。

**Why this priority**: 個人副本含簽名，誰在何時取得了哪位簽署人的副本需要可追查。

**Independent Test**: 分別由建立人、內部簽署人本人、外部簽署人本人下載副本，歷史各出現一筆，匯出人與範圍正確；副本尚未產製完成時下載失敗，不留紀錄。

**Acceptance Scenarios**:

1. **Given** 建立人在檢視頁下載某位簽署人的副本，**When** 後端回傳檔案，**Then** 新增一筆紀錄，匯出人為建立人，範圍為該簽署人，筆數為 1。
2. **Given** 簽署人（內部或外部）完成 Email OTP 後在簽署頁下載本人副本，**When** 後端回傳檔案，**Then** 新增一筆紀錄，匯出人與範圍都是該簽署人。
3. **Given** 原本的 GET 下載路由，**When** 呼叫，**Then** 回 404，不能繞過紀錄取得副本。
4. **Given** 副本尚未產製完成或下載被拒，**Then** 不新增紀錄。
5. **Given** 紀錄寫入失敗，**Then** 不回傳檔案，避免出現沒有紀錄的下載。

範圍的顯示方式：員工為「姓名（員工編號）」，外部簽署人為「姓名（Email）」。

### User Story 4 - 從紀錄重新下載 (Priority: P2)

有效員工在歷史頁對任一紀錄重新下載，不限建立人或原匯出人。Excel 與單人 PDF 每次重新下載都新增一筆紀錄。

**Acceptance Scenarios**:

1. **Given** 單人 PDF 紀錄，**When** 重新下載，**Then** 回傳該簽署人目前的已簽副本，並新增一筆 `pdf` 紀錄，匯出人為目前使用者。
2. **Given** Excel 紀錄，**When** 重新下載，**Then** 前端取得文件目前的簽署人資料，依紀錄的條件篩選，記錄成功後重新產生 Excel；新紀錄的條件沿用原紀錄，筆數依目前資料計算。
3. **Given** ZIP 紀錄，**Then** 沿用 Spec 009 的下載、重試、到期與重新申請規則；下載不產生紀錄。

## Requirements

### Functional Requirements

- **FR-001**: 系統 MUST 提供 `GET /api/esign/history/export`，以必填 `type` 篩選，依匯出時間由新到舊、以頁碼分頁，回傳總筆數及各類型總筆數。
- **FR-002**: `type` MUST 只接受 `excel`（簽署紀錄清單 Excel）、`pdf`（單人已簽 PDF）、`zip`（已簽署副本 ZIP）；簽到表本次不提供。
- **FR-003**: 查詢 MUST 可選擇以 `documentId` 限定單一文件，供建立人匯出頁的 ZIP 面板取得該文件最近一次匯出。
- **FR-004**: 所有有效員工 session MUST 能查看與重新下載全部類型的紀錄，不限建立人或匯出人；外部簽署 session 與未登入者 MUST 拒絕。
- **FR-005**: 每筆紀錄 MUST 回傳紀錄識別、類型、文件識別／名稱／編號、匯出人、匯出時間、範圍說明與筆數；ZIP 另回 Spec 009 的工作狀態欄位。
- **FR-006**: 系統 MUST 提供記錄 Excel 匯出的 API。有效員工 session 即可記錄，文件須存在且已發起；後端保存匯出人（取自 session，不由前端傳入）、文件、時間、範圍說明、筆數與匯出條件。
- **FR-007**（前端交接）: 前端 MUST 在 Excel 記錄成功後才觸發下載；記錄失敗不下載。
- **FR-008**: 下列下載成功時，後端 MUST 在同一請求中新增一筆 `pdf` 紀錄，寫入失敗則不回傳檔案：
  - 建立人下載簽署人副本。
  - 簽署人在 Email OTP 簽署頁下載本人副本（內外部共用）。
  - 從 `pdf` 紀錄重新下載。
- **FR-009**: 系統 MUST 提供 Excel 重新下載所需的資料：依紀錄回傳文件目前的名稱、編號、建立人與全部簽署人，供所有有效員工使用。
- **FR-010**: Excel 重新下載 MUST 透過 FR-006 新增紀錄。
- **FR-011**: `GET /api/esign/exports` MUST 移除；ZIP 面板改用 FR-003。ZIP 的申請、查詢、重試與下載路由不變。
- **FR-012**: `excel`、`pdf` 紀錄 MUST NOT 被 ZIP 背景工作、重試掃描、到期清理、七天重用或「最近一次匯出」判斷處理。
- **FR-013**: 紀錄只新增，不提供修改或刪除。
- **FR-014**: 會寫入紀錄的 PDF 下載 MUST 使用 POST 並直接回傳 PDF；原本的 `GET /api/esign/documents/{documentId}/signers/{signerPublicId}/completed-file` 與 `GET /api/external-signing-task/completed-file` MUST 移除，避免繞過紀錄下載。

### Key Entities

- **匯出紀錄**：一次匯出或重新下載。包含類型、文件、匯出人（員工或外部簽署人）、匯出時間、範圍說明與筆數；Excel 另存匯出條件，單人 PDF 另存簽署人，ZIP 另有背景工作狀態與成果檔案。

## Success Criteria

- **SC-001**: Excel 匯出、單人 PDF 下載（含本人下載）與兩者的重新下載，每次都在歷史中有且只有一筆紀錄；ZIP 每個匯出工作一筆。
- **SC-002**: 紀錄存在 DB，伺服器重啟後仍在；前端改串接後，歷史頁不再讀取前端記憶體的示意資料。
- **SC-003**: 各類型的總筆數與分頁結果一致，翻頁不漏不重。
- **SC-004**: 外部簽署 session 與未登入者查詢、記錄、重新下載的嘗試全部被拒，且不留紀錄。

## Assumptions

- 沿用既有的 `esign_export_jobs`（匯出工作），以 `export_type` 區分類型，不新增 table。Excel 條件與單人 PDF 的簽署人如何保存、是否需要新欄位或索引，在 plan 階段決定。
- `esign_export_jobs.created_by_user_id` 目前是 NOT NULL 且連到員工，外部簽署人不是員工。記錄外部簽署人下載需要 migration，例如改成可為 NULL 並改由簽署人識別匯出人，在 plan 階段決定。
- 既有 ZIP 紀錄的 `export_type` 是 `signed_copies_zip`；DB 值要改成與 API 相同的 `zip`（需要 migration），或保留原值並在後端對應，在 plan 階段決定。ZIP 申請路由 body 的 `{ "type": "signed_copies_zip" }` 屬於 Spec 009 的既有契約，本次不變。
- 資料開放範圍由 Portal 決定：能進入電子簽的有效員工都能查看紀錄、重新下載單人副本，並透過 Excel 重新下載取得任一文件的簽署人清單（含 Email、拒絕原因）。本專案不另判斷角色；電子簽加上 role／permission 後再限制。
- Excel 紀錄由前端回報，後端只能驗證身分與文件，範圍說明與筆數以前端為準；不做冪等，網路重試造成的重複紀錄可接受。
- 文件名稱與編號取文件目前的資料。已發起的文件不能改名，文件刪除受外鍵限制，不需要另存匯出當時的名稱。
- 本 spec 只交付後端。所有前端改動（歷史頁、Excel 回報紀錄、ZIP 面板、PDF 下載改用 POST）由前端工程師在後端完成後處理，交接內容見 contract。

## Out of Scope

- 簽到表匯出與其紀錄。
- `GET /api/esign/exportable-documents` 跨建立人文件查找（不變）。
- 人資角色或管理者權限機制。
- 所有前端改動（交給前端工程師，見 contract「前端交接」）。
- 歷史頁的 ZIP 頁籤（由前端工程師評估）。
