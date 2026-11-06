# 旅遊平台 phase 1 與 intranet 架構的配合與衝突

> 日期：2026-11-05。
>
> 依據：
> - 需求：`docs/travel-platform/phase1/*.md`、`docs/travel-platform/system-flow-overview.md`
> - intranet：HEAD `b110481`（branch `docs/specs-027-029-access-authorization`）、`specs/027`～`029`、`docs/research/2026-11-04-*.md`
> - feastogether_oauth：HEAD `46ca66c`
>
> 本文件是開工前的判斷，不是決議。程式位置以 repo 根目錄為準；標「（推論）」的內容沒有在程式中驗證。

## intranet 的授權模型

依使用者 2026-11-05 的說明：

- intranet 是工具集合，電子簽、旅遊平台這類功能群集各是一個 module。
- 每個 module 定義自己的角色與權限。授權判斷先決定是哪個 module，再看這個 module 裡的角色與權限。
- 只有 Super user 能跨 module 管理。每個 module 有自己的管理員，管不到其他 module。

旅遊平台在 intranet 裡是一個新 module，本文以 `travel` 稱呼，和 `esign` 並列。028 的 `module_key` 隔離（FR-001、複合 FK）已經是這個模型。其他已確認的決策見〈一、已確認的決策〉。

## 結論摘要

1. **027～029 的骨架接得住旅遊平台**。以下六點和 PRD 方向一致：
   - 只用 OAuth 登入
   - 以 module 隔離角色與權限
   - 權限異動後下一次請求生效
   - 權限目錄由程式定義
   - 用員編預先指派角色
   - 選單依權限過濾
2. **028 要依 intranet 的 module 模型修訂**。依已確認的決策 D1～D6，028 有三處要改：
   - Super user 只獨占跨 module 的管理；每個 module 的管理員管理自己 module 的授權。
   - module 管理員可以自行建立角色、授予權限（D6）。
   - 稽核改用 CKS 的 audit，並帶 `module_key`。

   角色數量不由平台限制（D2），FR-002 不必改。

   module 管理員的細節也已確認（〈module 管理員的細節〉），會連帶修改 FR-004、FR-006。

   旅遊平台的帳號另建 `travel_accounts`，記錄草稿／啟用／停用與角色，旅遊平台的權限由它衍生（M3）。028 要配合的是：依 module 讀取指派來源，並且 `travel` 的帳號只走旅遊平台自己的 API。

   另外，D3 讓旅遊平台沒有固定的「系統管理員」角色，和 PRD 不一致，要和 PM 對齊。

   028 的正式目錄目前只有 `esign` 和 `platform`，第二個 module 只當隔離測試用的 fixture；旅遊平台會是第一個真正的第二個 module。028 的 60 項任務都還沒執行，現在修訂成本最低。
3. **HR 鏡像（`users` 同步）的語意和 PRD 衝突**：
   - 停用的同仁永遠不會被同步恢復，而 AuthGuard 會擋停用的人，所以復職的同仁再也無法登入。
   - Portal 查無此人時不處理。
   - 沒有事業部與留職停薪。
4. **員工資料可以不經 OAuth server**。intranet 已經直連 Portal（spec 024），028 的預先指派也依賴 Portal。如果 PM 接受 PRD 的「經 OAuth 中心」不是硬性要求，旅遊平台就不必等 OAuth server 做 005 與資料 API。
5. **旅遊業務本身的缺口**：
   - 伺服器端加密 Excel
   - 操作紀錄（移植 CKS 的 audit，並補上查詢與畫面）
   - 投票併發與 3,000 人負載
   - 附件寄信
   - 錯誤代碼與 toast 慣例
   - 前端殼層仍是電子簽專用

---

## 一、027～029 和 PRD 的關聯

### 對得上的地方

| PRD 需求 | 027～029 的落點 | 說明 |
|---|---|---|
| 以 OAuth 登入，旅遊平台不存密碼（ACCT〈登入〉、Q-20） | 027 FR-001：保留 OAuth／WebView，移除一般員工帳密 | 一致 |
| 旅遊平台的角色、權限和電子簽互不影響 | 028 FR-001：角色和權限各自屬於一個 module，跨 module 不能混綁 | 一致；旅遊平台新增 `travel` module |
| 停用或換角色後，下一次請求就生效（ROLE-34） | 028 FR-013 | 一致 |
| 權限表的功能項目固定（ROLE〈功能項目清單〉） | 028 FR-011：權限目錄由程式定義 | 旅遊平台在程式目錄登錄自己的權限碼 |
| 還有帳號的角色不能刪除 | 028 FR-021 | 一致 |
| 從在職同仁中挑人指派角色，對方可以還沒登入過（ACCT-18/19） | 028 FR-012：查核 Portal 員編後預先指派 | 一致 |
| 沒有查看權限就不出現選單（ROLE-33） | 029：選單項目綁定 module 與權限 | 旅遊平台的選單加進 029 的集中設定 |
| 前台投票資格看名單，不看角色（ROLE-38） | survey §3：RBAC 不取代業務資料授權 | 一致 |
| 第一位系統管理員由 PG 建立（ROLE-42） | 028：由 Super user／REPL 指派 | 一致 |
| 權限由後端再驗一次（ROLE-48） | 028 FR-017 | 一致 |

### 已確認的決策

使用者 2026-11-05 確認：

| # | 決策 | 對 028 的影響 |
|---|---|---|
| D1 | 只有 Super user 能跨 module 管理。每個 module 有自己的管理員：旅遊平台的管理員管不到電子簽，電子簽的管理員也管不到旅遊平台 | FR-007 要改：Super user 只獨占跨 module 的管理，module 管理員可以管理自己 module 的角色與指派。028 初始矩陣中，電子簽管理員的「授權管理：無」也要跟著改（推論，待確認） |
| D2 | 平台不限制角色數量，保持彈性；各 module 自己定義規則。旅遊平台規定每個帳號只有一個角色 | FR-002 不必改。旅遊平台的單一角色由旅遊平台自己的帳號管理 API 與畫面保證，平台不另加限制 |
| D3 | 內建角色只有電子簽有：所有帳號預設是同仁，管理員是人資。旅遊平台沒有內建角色 | 028 的受保護角色「同仁」維持只屬於 `esign`，不必為旅遊平台新增受保護角色 |
| D4 | 旅遊平台需要操作紀錄：把驗收系統（CKS）的 audit 加回旅遊平台；電子簽不需要 | 見〈稽核的落點〉 |
| D5 | 旅遊平台的角色分「管理者」和「同仁」：管理者看全集團，同仁只看自己管理的部門 | 見〈M6 資料範圍〉 |
| D6 | 角色建立後，由管理員自行給予權限。intranet 保留彈性：各 module 可以自行建立角色、授予角色權限 | 權限目錄仍由程式定義（FR-011）。角色與角色的權限由 module 管理員維護；FR-006 的初始角色只是起點，可以再調整 |
| D7 | 角色與權限跨 module 共用同一套表；指派依 module 需要各自決定 | 沿用 028 的 `authorization_roles`、`authorization_permissions`、`authorization_role_permissions`，以 `module_key` 隔離。角色管理 API 也共用（`/api/modules/:moduleKey/roles`）。見〈角色與權限共用（D7）〉 |

#### 角色與權限共用（D7）

**共用的內容**

- 角色就是「一個名字加一組權限碼」，權限就是程式目錄中的一個 key，各 module 的形狀相同。
- 028 已經提供隔離：
  - `role_permissions` 的複合 FK 保證角色與權限屬於同一個 module。
  - 角色名稱在同一個 module 內唯一。
  - 權限碼帶 module 前綴（`travel.*`、`esign.*`）。
- 角色 CRUD、權限設定、每次請求重算權限、Super user 看全部、029 的選單過濾、稽核，都只實作一次。新增第三個 module 時，只要登錄程式目錄。

**各 module 的差異放在哪裡**

| 差異 | 放哪裡 |
|---|---|
| 指派方式 | 依 module 決定：旅遊平台用 `travel_accounts`（M3）；電子簽及其他沒有帳號生命週期需求的 module 用 `authorization_user_roles` |
| 角色排序（旅遊平台的排序／刪除頁） | 共用的角色表加一個通用排序欄位，其他 module 也可以使用 |
| 受保護角色（電子簽「同仁」） | 沿用 028 的 `is_protected`，旅遊平台不使用 |
| 資料範圍（旅遊平台「看全集團」） | 用權限表達（M6），不加角色欄位 |
| 權限矩陣的顯示資訊（分組、功能、動作、順序） | 放在各 module 的程式目錄 |

**什麼情況才另外切表**

某個 module 的角色有大量專屬欄位，或語意完全不同（例如階層式角色、針對單筆資料的存取控制）時，再另外切表。目前電子簽、旅遊平台都沒有這種需求。

### 決策後還要處理的事

#### 和 PRD 不一致，要和 PM 對齊

- **系統管理員不再是固定角色（D3）**：
  - PRD 原本的規則：
    - 系統管理員固定存在，全部權限全開，不能修改或刪除，分頁固定排第一（ROLE-42）。
    - 帳號管理要「至少保留一位系統管理員」（`accounts.md`〈權限與系統管理員保護〉、Q-07）。
  - D3 之後，旅遊平台的「管理者」是一般角色，這些規則要從 PRD 拿掉，或改由 Super user 維護。
  - 第一位管理者由 Super user 指派。
- **D5 的「管理者／同仁」**：
  - 依 D6，角色由管理員自行建立，所以「管理者」「同仁」是旅遊平台一開始建立的兩個角色，不是固定只有兩個；PRD 的自訂角色（例如部門主管、財務人員）照樣可以建立。
  - 資料範圍是一個可以授予的權限（見〈M6 資料範圍〉）。
  - 旅遊平台的「同仁」和電子簽內建的「同仁」同名但屬於不同 module。028 允許不同 module 有同名角色，系統上不衝突，但畫面與文件要避免混淆。
  - 沒有旅遊平台角色的同仁照樣可以投票，因為資格看名單（ROLE-38）。

#### module 管理員的細節（D1，使用者 2026-11-05 確認）

以電子簽為例確認，旅遊平台的管理員也比照：

| # | 問題 | 決定 | 對 028 的影響 |
|---|---|---|---|
| 1 | 怎麼成為管理員 | 逐人指派，可以在對方登入前先指派；不依部門自動帶入。第一位由 Super user 指派 | 沿用 FR-012 的預先指派 |
| 2 | 管理員能做什麼 | 建角色、設權限、指派角色都可以 | FR-007、FR-010：這些管理操作開放給 module 管理員，只限自己的 module |
| 3 | 能否任命、移除其他管理員（含自己） | 可以；不做「至少保留一位」的保護，由 Super user 補救 | 不加檢查 |
| 4 | 越權問題 | 有帳號管理權限的人就是管理員，管理員在 module 內擁有全部權限，不存在更大的權限，所以不必檢查越權 | 不加「只能指派權限不超過自己的角色」的檢查 |
| 5 | 電子簽「同仁」的權限能否由管理員修改 | 可以（依回覆字面解讀，待確認） | FR-004 要改：「同仁」仍然隱含給全部有效員工，不能刪除、不能撤銷，但權限改由電子簽管理員維護，不再由程式固定 |
| 6 | 「文件建立者」 | 保留。管理員本身就有文件建立權限，部分同仁也可能被授予文件建立權限，保留彈性 | FR-006：「文件建立者」維持為可調整的初始角色；電子簽管理員的初始權限包含文件建立與 esign 授權管理 |

另外，使用者確認 intranet 沒有 `is_admin`，不需要處理。

#### M1 module 管理員的實作（D1）

- 旅遊平台的「角色管理」「帳號管理」「操作紀錄」是 `travel` 目錄裡的權限，例如 `travel.roles.*`、`travel.accounts.*`、`travel.audit.*`，勾給管理者角色。
- 這些權限只能操作 `travel` 的角色、指派與稽核紀錄。028 的複合 FK 已能保證角色與權限屬於同一個 module。
- 管理 API 依 survey 的草案，放在 `/api/modules/:moduleKey/...` 底下，每次都檢查呼叫者在該 module 有對應權限，或是 Super user。
- `platform.authorization.manage`（跨 module 管理）維持只有 Super user。

#### M3 旅遊平台帳號：`travel_accounts`（使用者 2026-11-05 決定）

**決定**

- 旅遊平台另建 `travel_accounts`，記錄草稿、啟用、停用三種狀態。
- 旅遊平台的角色指派也放在這張表，權限由這張表的角色衍生出來。
- 依據：PRD《帳號管理》v0.9 第 9.2 節 ST-01 帳號狀態，以及附錄 A Q-03（2026-10-28 決議）。

**為什麼不放在 028 的 `authorization_user_roles`**

- 帳號狀態、單一角色、Email、備註都屬於旅遊平台。
- 如果角色放在 028 的指派表、狀態放在旅遊平台的表，兩張表要同步，會多出「指派還在但帳號已停用」這類不一致。
- 放在同一列，一次寫入就能同時更新狀態、角色與稽核紀錄。

**欄位**

沿用 intranet 慣例：繼承記錄操作者的 `AuditableEntity` 子類別，DB 用 snake_case，狀態用 varchar 加 CHECK（同 `esign_documents.status`）。

| 欄位 | 型別與限制 | 說明 |
|---|---|---|
| `id` | bigint unsigned PK | |
| `user_id` | bigint，NOT NULL，FK → `users.id` RESTRICT | 員編、姓名、事業部、在職狀態都從 `users` 取得，不另外複製 |
| `role_id` | bigint unsigned，NOT NULL；FK → `authorization_roles.id` RESTRICT | 草稿也必填，因為「儲存草稿」會檢查角色（PRD ㉗）。寫入時，帳號管理 service 在同一個交易內確認角色屬於 `travel` 且未刪除。不另設 `module_key`，理由見表格下方 |
| `status` | varchar(20)，NOT NULL，CHECK IN (`'draft'`, `'active'`, `'disabled'`) | ST-01 |
| `email` | varchar(100)，NULL | 新增時預設帶入 `users.email`；HR 有信箱時，每天同步會覆蓋 |
| `note` | varchar(200)，NULL | |
| `active_user_id` | 生成欄位：`CASE WHEN deleted_at IS NULL THEN user_id END`，UNIQUE | 每位員工最多一個未刪除的帳號（含草稿、停用）。草稿刪除後可以重新建立。做法同 028 的 `active_role_name` |
| `created_by`／`updated_by`、`created_at`／`updated_at`／`deleted_at` | 共用欄位 | 刪除草稿用軟刪除；PRD「刪除後不留帳號」指的是畫面與功能上不存在 |

- 不設 `module_key` 的理由：
  - 它唯一的用途是組成複合 FK，讓資料庫擋住「掛到別的 module 的角色」。
  - 但這張表只有旅遊平台的帳號管理 API 會寫入（見下方〈028 要配合的改動〉第 2 點），而這個 API 本來就要讀取角色，確認角色存在、未刪除，才能回應正確的錯誤，順便檢查 `module_key = 'travel'` 即可。
  - 角色的 module 建立後不會改變，所以存進來的角色不會事後變成別的 module 的角色。
  - 代價是繞過 service 直接寫 SQL 時沒有資料庫層的保護；028 也規定 REPL 要走 service，不以裸 SQL 當正式流程。
- 索引：`(role_id, status, deleted_at)`，供角色分頁與人數統計使用。
- 「上次登入」不放這張表：intranet 只有一個 session，沿用 `users.last_login_at`，待 PM 確認（見 A4）。

**狀態規則（ST-01）**

| 動作 | 狀態變化 |
|---|---|
| 新增時按「儲存草稿」 | → `draft` |
| 按「儲存並發佈」 | → 依啟用開關變成 `active` 或 `disabled` |
| 停用、重新啟用、批次停用 | `active` ⇄ `disabled` |
| HR 同步標記離職 | `draft`／`active` → `disabled`，`actor_kind = system` |

- 已發佈的帳號不能回到草稿。
- 只有草稿可以刪除。
- 復職的同仁，帳號維持停用，要由管理員重新啟用（ACCT-45）。
- 冪等：已停用的帳號再停用一次時，不改資料、不寫稽核紀錄，也不報錯。批次停用時逐筆處理。
- 併發：
  - 兩位管理員同時新增同一位員工，由 `active_user_id` 唯一鍵擋下後到的人，顯示「該員工已有帳號」。
  - 兩人同時編輯同一帳號，以後儲存的為準。
  - 啟用時，在交易內重新確認 HR 在職狀態，確保離職停用優先。

**權限怎麼算（每次請求重算，028 FR-013）**

| 身分 | `travel` 權限 |
|---|---|
| Super user | 全部 |
| 員工 | `users.is_active` 為真，而且有未刪除、`status = 'active'` 的 `travel_accounts`：取得該列 `role_id` 的權限（只算程式目錄中仍存在的權限） |
| 其他人（草稿、停用、沒有帳號） | 沒有任何後台權限；前台投票、報名仍看資格名單（ROLE-38） |

**028 要配合的改動**

1. **指派來源依 module 不同**：
   - `esign`：`authorization_user_roles`，加上隱含的「同仁」。
   - `travel`：`travel_accounts`。

   028 的授權判斷和 029 用的「目前能力查詢」都要把 `travel` 的來源算進去。
2. **只有一條寫入路徑**：
   - 028 的通用「員工角色指派」API 不處理 `travel`。
   - 旅遊平台的帳號一律走旅遊平台自己的帳號管理 API，它負責狀態、Email、備註、稽核；Super user 也走這條。
3. **刪除角色的檢查**：
   - `travel` 的角色只要還有未刪除的 `travel_accounts`（含草稿、停用），就不能刪除。對應 FR-021 與 PRD「有帳號的角色不能刪」。
   - 角色本身是軟刪除，FK 不會觸發，所以要在 service 裡鎖定角色後檢查，同 028 對 `user_roles` 的做法。
4. **角色分頁人數**：依 `role_id` 統計未刪除的帳號，三種狀態都算。

**和 PRD 不一致、要確認**

- **編輯自己的帳號**：
  - PRD 規定編輯自己的帳號時，角色和啟用開關是唯讀，防止把自己鎖在外面。
  - 但〈module 管理員的細節〉第 3 點決定管理員可以移除自己。
  - 要保留 PRD 的唯讀，還是開放？建議保留唯讀：要移除自己，請另一位管理員或 Super user 處理。
- **「只有系統管理員看得到系統管理員選項」**：D3 之後沒有固定的系統管理員角色，這條規則從 PRD 拿掉。

#### 稽核的落點（D4）

##### 1. CKS 現在有什麼

位置：`CKS_Acceptance_System/server/src/features/auth/`。

| 項目 | 內容 |
|---|---|
| `audit_logs` | `action`（白名單常數）、`entity_type`／`entity_id`（主要對象，字串、無 FK）、`actor_user_id`、`changes`（`{欄位: [前, 後]}`）、`before_snapshot`／`after_snapshot`（JSON）、`description`、`ip_address`、`user_agent`、`created_at`。索引：對象、操作者、動作，各自搭配時間 |
| `audit_log_targets` | 一筆紀錄可以有多個查詢目標：`target_kind`（primary／associated）、`target_type`、`target_id`。用來查「和某帳號或某活動有關的所有紀錄」 |
| `AuditLogService` | `recordHistory`／`recordHistoryBatch`，可以傳入交易 manager，和業務寫入同一個交易。操作者、IP、UA 取自 CLS，呼叫端只給事件內容。快照會擋掉疑似敏感欄位名（pass、token、secret、hash…）。**前後沒有差異時直接跳過不寫** |
| 查詢 | `audit-log-query.ts` 可以依對象、動作、操作者、時間範圍篩選，有筆數上限，再批次補上操作者名稱。只有 REPL 腳本 `console/scripts/auditLogs.ts` 會用到 |
| 沒有的東西 | 沒有 HTTP 查詢 API、沒有匯出、沒有畫面（CKS PRD Story 4：本期只做後端） |

intranet 已經用 nestjs-cls 記錄操作者（`server/src/infrastructure/database/audit-user.context.ts`），寫入端可以直接移植。

##### 2. 移植到 intranet 要改的地方

**統一成一張表**

- CKS 的 `audit_logs` 成為 intranet 唯一的稽核表，取代 028 規劃的 `authorization_events`，避免同一件授權異動寫兩份。
- 028 需要的欄位併進來：

| 新增欄位 | 用途 |
|---|---|
| `module_key` | `esign`／`travel`／`platform`。查詢一律先限定 module |
| `actor_kind` | `employee`／`super_user`／`system`／`operator`。Super user 和 HR 同步沒有員工 ID |
| `source` | `http`／`repl`／`sync`／`migration` |
| `details`（JSON） | 不屬於「前後差異」的事件資料，例如匯入檔名與筆數、成功或失敗、錯誤摘要、名單下載的寄送信箱 |
| `request_id` | 對應同一次請求的多筆紀錄 |

**允許「沒有欄位異動」的事件**

- PRD 要求「取消」「名單下載」「名單匯入」也要留紀錄（ACCT-55、ROLE-39、VOTE-SET-76），而 CKS 遇到沒有差異就跳過。
- 改成：更新類動作沒有差異時才跳過；事件類動作一律寫入。
- 「已停用的帳號再停用一次」不寫，這符合 ACCT 的冪等規則。

**對象被刪除後仍要看得懂**

- PRD 要求活動刪除後紀錄仍保留（VOTE-SET-76）。
- `entity_id` 本來就沒有 FK，但顯示需要的名稱（角色名稱、活動名稱）要寫進快照或 `details`，因為對象刪除後就 join 不到了。

**人名不寫進紀錄**

- 操作者與被異動的帳號只存 `user_id`，查詢時再 join 出員編和姓名，符合 028 FR-016 不存不必要個資的規定。
- 代價是同仁改名後，舊紀錄會顯示新名字。PRD 沒有要求保留當時的姓名。

**和業務寫入同一個交易**

稽核寫入失敗時，整筆業務異動一起 rollback（028 FR-014）。

##### 3. 各 module 寫哪些事件

| module | 事件 | 依據 |
|---|---|---|
| `platform`／`esign` | 只寫授權異動：角色建立、修改、權限變更、刪除；角色指派、撤銷 | 028 FR-014。電子簽不恢復文件、簽署事件歷程（026） |
| `travel` 帳號 | 儲存草稿、儲存並發佈、停用、重新啟用、批次停用（每個帳號一筆）、HR 同步停用（`actor_kind=system`）、刪除草稿、取消。記錄角色、Email、狀態、備註的前後值 | ACCT-55／56 |
| `travel` 角色 | 儲存、排序、改名、刪除、取消。記錄角色名稱與權限差異 | ROLE-39／40 |
| `travel` 投票活動 | 儲存草稿、儲存並發佈、停用、重新啟用、名單匯入、名單下載、候選地點匯入、刪除、取消。記錄活動名稱，以及筆數、檔名、結果、寄送信箱等 `details` | VOTE-SET-76、〈稽核紀錄〉 |

**不寫進這張表的**

- 投票點選：量很大，另開只新增的 `travel` 投票點選紀錄表，見〈三、旅遊業務本身〉。
- HR 同步的每次執行紀錄：PRD 說只給 IT 在後端查，另存同步執行紀錄。

##### 4. 查詢與匯出（新工作）

| 項目 | 內容 |
|---|---|
| API | `GET /api/modules/travel/audit-logs`：時間範圍、動作、操作者、對象篩選，分頁，依時間新到舊排序。需要 `travel.audit.view` |
| 匯出 | `GET /api/modules/travel/audit-logs/export`：依目前篩選匯出 CSV，需要 `travel.audit.export`。匯出前處理控制字元與 CSV 公式注入（PRD 開發提醒）。要設筆數上限，超過時改成背景工作 |
| 顯示 | 時間轉台灣時間到秒。操作者的顯示規則：員工顯示員編＋姓名；Super user 顯示「Super user」；HR 同步顯示「系統同步」。帳號、角色、活動三類的前後差異結構不同，畫面依動作類型分別呈現 |
| 電子簽 | 不做列表。Super user 用 REPL 查，沿用 CKS 的 `auditLogs` 腳本模式 |
| Super user | 可以查全部 module |
| 優先順序 | 寫入從第一個旅遊功能開始；查詢畫面可以最後做（操作紀錄頁名「最後有時間再做」） |

##### 5. 還沒決定的事

- **保存期限**：PRD 建議至少 6 個月，待法務確認。決定前不做清除排程。
- **028 FR-016 要放寬**：帳號紀錄需要記 Email、備註的前後值（ACCT-56），名單下載需要記寄送信箱。028 FR-016 寫「不含員工不必要個資」，要明確把這些列為必要資料。
- **只新增的保護**：CKS 只靠「不提供更新、刪除 API」維持只新增。要不要另外用資料庫帳號權限限制 UPDATE／DELETE，屬於維運決定。

#### M6 資料範圍（D5）

- 用 `travel` 自己的權限表達，例如 `travel.registration.read_all`（看全集團）。依 D6，管理員可以把它授予任何角色：
  - 一開始授予「管理者」角色。
  - 「同仁」角色沒有這個權限，就只看 HR 回傳的管理部門。
- 角色編輯畫面上呈現成二選一。
- 「管理的部門」的 HR 來源目前沒有，phase 2 前要補。

### 其他缺口

- **A1 角色排序、權限矩陣的顯示資訊、管理畫面**：
  - **角色排序**：PRD 需要角色排序和批次改名、刪除，排序依 module 分開。028 沒有排序欄位，要補。PRD 的角色沒有停用狀態，`travel` 不使用 `is_active` 即可。
  - **權限矩陣**：PRD 的權限矩陣是「功能項目 × 查看／新增／修改／刪除／匯出」，有些格子不適用。程式目錄要補分組、功能、動作、排序等顯示用資訊。
  - **管理畫面**：028 和 029 都不做角色和員工的管理畫面，但 PRD 的 phase 1 就要角色管理和帳號管理頁。這些頁面由旅遊平台實作，可以參考 CKS client 的角色與帳號管理頁，並套用上面的 module 管理 API。
- **A2 OAuth 瀏覽器入口與首頁**：
  - 027 FR-013 與 Scope 明確不做 OAuth 登入頁和 callback 頁。
  - **現況（2026-11-05 查核 dev `4e0c9bc`）**：
    - client 沒有任何登入頁，員工只能從入口網的 iframe／WebView launch 進入。
    - server 已有 `POST /api/auth/oauth/start`、`POST /api/auth/oauth/callback`（從 nest_seed 帶過來，intranet 沒有對應的 spec）。
    - `.env.example` 的 `OAUTH_REDIRECT_URI` 指向 client 的 `/oauth/callback`，但 client 沒有這一頁，所以瀏覽器的 OAuth 登入目前走不完。
  - **和 feastogether_oauth 對得上的部分**：
    - intranet 是機密 client，用 `client_secret_post`，OAuth server 有支援。
    - scope 是 `openid profile email`，員編在 `profile` 的 `employee_number`。
    - intranet 的 client 註冊時不能設定 `allowed_auds`：設定後 access token 會變成發給該 resource，拿去打 userinfo 會失敗，intranet 就拿不到員編。
  - 旅遊平台的後台只做 PC 版、不進饗賓人 App；App 的登入目前擱置（〈三、8〉）。所以 OAuth 瀏覽器入口是旅遊平台 phase 1 的前置工作。要做的有 callback 頁、沒有 session 時導去 OAuth 登入、登入後的首頁。
  - 投票入口卡片所在的首頁 PRD（S1-01）還沒寫。
- **A3 離職者的「無法登入，請洽人資」**：
  - OAuth server 在離職日當天就拒絕登入，訊息是通用的，intranet 根本收不到這些人。
  - intranet 自己的 Portal 資格檢查失敗時，也只回通用的 `AUTH_EXCHANGE_FAILED`（`server/src/features/auth/services/eligible-staff.service.ts:50-51`）。
  - intranet 可以在「OAuth 已通過、Portal 判定不合格」時顯示 PRD 的訊息，這時同仁已經驗證過身分，沒有帳號枚舉的問題。
  - 但大多數離職者在 OAuth 那一關就被擋下，要由 OAuth 端決定是否修改防帳號枚舉的規則。
- **A4 上次登入與 Super user 操作者**：
  - **上次登入**：intranet 是單一應用、單一 session，無法區分「登入旅遊平台」和「登入電子簽」。請 PM 確認改用 intranet 的登入時間，或改記「最後一次使用 `travel` module 的時間」。
  - **Super user**：Super user 沒有員編（028 data-model §7 顯示為 `Super user`）。操作紀錄的操作者欄要能呈現這種非員工身分。

---

## 二、員工主檔（HR 鏡像）

員工主檔由所有 module 共用，不屬於任何一個 module。

| PRD | intranet 現況 | 判斷 |
|---|---|---|
| 在職就能登入；復職者的後台帳號維持停用，但可以登入（ACCT-45） | 同步時，已停用或軟刪除的 users 一律不寫入、也不恢復（`server/src/features/users/portal-user-sync.rules.ts:174-200`）；AuthGuard 每次請求都擋停用的使用者 | **衝突**：復職者永遠無法登入 |
| HR 查無此人時停用（ACCT-44） | Portal 查不到的人不動（同檔 :177） | 衝突 |
| 事業部、留職停薪 | `users` 有部門代碼、名稱和職稱，沒有事業部和留停 | 缺口；事業部對應 Portal 哪個欄位（Q-06）、留停的狀態碼都還不知道 |
| 每天 05:00 同步，05:30、06:00 重試，失敗與恢復都寄信，要有執行紀錄 | 每天 04:00 跑一次（`attempts:1`），失敗只寫 log | 缺口 |
| HR 有信箱時才覆蓋 Email | HR 空白也會把 email 改成 NULL（rules :87） | Email 另存在 `travel_accounts.email`（見 M3） |
| 在職同仁下拉 | `GET /esign/signer-candidates?q=` 可以參考 | 可沿用；放在 `esign` 底下，旅遊平台要用的話應該搬到共用的位置 |
| 名單匯入的員編要存在於 HR 同步帳號（VOTE-SET-52） | 有本地 `users` 與批次查詢 helper | 可沿用 |

**建議**

- 把「HR 在職狀態」和「本地停用」拆成兩個欄位：
  - 「本地停用」是整個員工層級的，所有 module 都不能用。
  - 旅遊平台的停權用 `travel_accounts.status`（M3），各 module 自己管理。
- 補上事業部、留停、同步執行紀錄，以及重試與告警。
- 024 是既有 spec，要另開 spec 修訂。
- 來源維持直連 Portal，請 PM 確認「經 OAuth 中心」可以改成這樣。

---

## 三、旅遊業務本身

### 1. 投票的正確性與負載

**資料模型**

- 唯一鍵 `(activity, vote_generation, empid, location)`。
- 鎖定該同仁的資料後再檢查票數上限。
- 停用活動時把 `vote_generation` 加一，舊的票就自動不計，重新啟用也不會恢復。
- 每次點選帶冪等鍵，避免重試重複計票。

**負載上的疑慮**

- MySQL 連線池預設只有 10（`server/src/infrastructure/database/mysql/mysql.options.ts:128`）。
- 每次請求都要查 session；028 計畫每次請求也查授權，而且不做快取。
- 所有 `/api` 都經過 Next rewrite，多一層代理。
- repo 裡沒有壓測工具。

**要先確認的事**

- 登入限流是每個 IP 每 60 秒 10 次、每 300 秒 50 次（`server/src/features/auth/auth.constants.ts:36-42`），OAuth start／callback 也套用；`trustProxy:1`（`server/src/bootstrap/app.bootstrap.ts:63`）。要確認經過 ALB → Nginx → Next → Nest 之後，取得的仍是真實 IP。如果全部變成同一個 IP，3,000 人登入會被限流擋下（推論）。
- 壓測也要涵蓋 OAuth server 的登入：bcrypt cost 12，每次約 250 ms。

### 2. 名單匯入與加密下載

- **匯入可以沿用**：電子簽發起工作的模式（DB 工作列 + BullMQ 去重、每份文件只有一個進行中的工作）適用於「每個活動只有一個匯入」。目前沒有取消功能，要補上「commit 前檢查是否已取消」。
- **伺服器端沒有 Excel 套件**：電子簽的 Excel 是在瀏覽器用 exceljs 產生。
- **加密 .xlsx 只有一個候選**：唯一用過的是 `officecrypto-tool@0.0.19`，曾在原型中使用後移除，目前仍留在 `client/package.json`。要先做 spike，驗證 10 萬列的記憶體用量、Excel 能否正常開啟，以及加密後如何切成 10 MB 一份。

### 3. 寄信

**現況**

- 只有一個 Gmail SMTP 帳號（`einvoice@`），沒有連線池。
- 寄信介面是邀請信專用，不支援附件。
- `specs/011`、`012` 是空目錄，沒有實作。

**要補的**

- 一個通用的寄信介面（含附件），沿用非正式環境的白名單守衛。寄信屬於共用基礎設施，不放在任何一個 module 底下。
- 決定旅遊平台的寄件帳號。

### 4. 稽核

見〈稽核的落點〉。旅遊平台需要兩種紀錄：

- 操作紀錄：移植 CKS 的 `audit_logs`，帶 `module_key`，只新增、不修改，和業務寫入在同一個交易。
- 投票點選紀錄：量很大，另外一張只新增的表，每次點選一筆。內容是活動、啟用代次、`user_id`、地點、投票或取消、時間、冪等鍵。
  - 壓測時用它核對「得票數＝實際紀錄」（VOTE-PAGE-36）。
  - 不出現在操作紀錄列表。

電子簽不提供操作紀錄列表。

### 5. 錯誤代碼與 toast

**PRD 要求**

- 每個紅色 toast 的結尾都帶「_{錯誤代碼}」。
- toast 在右上、填色、顯示 5 秒、沒有關閉鈕。

**intranet 現況**

- 錯誤代碼是語意字串（`server/src/common/errors/app-errors.ts`），前端只顯示訊息，不顯示代碼。
- axios 沒有設 timeout。
- toast 在下方置中、顯示 4 秒、可以關閉。

**建議**

開工前定好共用的代碼表與 toast 規則：

- 錯誤碼：AppErrors 每筆加一個短的顯示碼，代碼表由 AppErrors 產生；網路錯誤、逾時由前端給代碼。
- 跨 module：決定代碼要不要帶 module 前綴。
- axios：設定 timeout。
- toast：決定是否全站改用 PRD 的樣式。

### 6. 前端殼層

**現況**

- 側欄寫死電子簽的項目，標題是「電子簽署」。
- `/` 導向 `/forms`。
- session 檢查只涵蓋電子簽的路由。
- 每頁固定 10 筆。

**要做的**

- 側欄：029 的集中設定先依 module 分組，再依權限過濾；旅遊平台的選單放在 `travel` 群組。
- 版面：後台走 PC 版面；投票頁做手機優先、不帶側欄的版面。
- 共用表格：一個表格元件，支援每頁筆數、欄位顯示、重新整理。
- 文案入口：標題和首頁導向改成工具集合的入口。

### 7. 部署

- 沿用同一個網域和同一個 Next app，可以避開 cookie 與 basePath 的問題：cookie 是 host-only、`Path=/`。
- 如果為了 3,000 人要擴到多台主機，檔案要從本機 volume 改成 S3（推論）。

### 8. 登入入口：Portal 與饗賓人 App（擱置）

> **狀態（使用者 2026-11-05）**：饗賓人 App 的登入先擱置，只記下有這件事。它和 OAuth 是兩條不同的路，目前先處理 OAuth 的搬遷。以下是擱置前的討論紀錄，重啟時再確認。

**新需求**

旅遊平台可能要在饗賓人 App 裡開啟，同仁不必再輸入帳密，和 Portal 進電子簽一樣。

**決定**

- 饗賓人 App 比照 Portal 現在的做法，使用 002 的 WebView launch：App 的後端用自己的私鑰簽短效 JWT，伺服器對伺服器交給 intranet。
- App 的修改由使用者協助。
- 不在 WebView 裡走 OAuth 登入：App 依 D33 用系統瀏覽器登入 OAuth，這份 cookie 和 WebView 不共用，同仁得再輸入一次帳密。
- Portal 也維持 002：Portal 是用 iframe 嵌入電子簽（`specs/002-webview-sso-session/contracts/embed-postmessage.md`），OAuth 登入頁設了 `frame-ancestors 'none'`，不能在 iframe 裡開。

**流程**

1. 同仁在 App 點旅遊平台。
2. App 帶著自己的 Sanctum token 呼叫 App 後端 `feastogether-backend` 的一支新 API。
3. `feastogether-backend` 依 `main-platform-jwt.md` 簽 JWT：`sub` 是登入者的員編，`iss` 用 App 專屬的值；再 POST 到 intranet 的 `/api/auth/webview-launches`。
4. intranet 驗證後回 `launchUrl`（60 秒內、只能用一次），`feastogether-backend` 把它交給 App。
5. App 用 WebView 開 `launchUrl`，經 bridge 取得 intranet 的 session cookie。

**App 後端：`feastogether-backend`（2026-11-05 查核，HEAD `4d5ae25`）**

- Laravel 12 加 Sanctum，是饗賓人 App 的 CMS 後台、API 與推播 API。
- App 登入（`AuthService::login`）由它轉打 fgapi `/api/v1/staff/login`：
  - 成功後建立或沿用本地 `users`，`username = person_empid`，`auth_type = 'external'`。
  - 之後發 Sanctum token 給 App。
  - 所以這個後端知道登入者的員編，也有可以放私鑰的伺服器環境。
- 另有 `auth_type = 'local'` 的本地帳號，用本地密碼登入，`username` 不保證是員編。新 API 只能替 `external` 帳號簽 JWT，`local` 帳號一律拒絕。
  - 否則本地帳號的 `username` 剛好等於某個員編時，就能冒用那位員工登入 intranet。
  - intranet 的 Portal 在職檢查擋不住這種情況。
- 私鑰放在 `feastogether-backend` 的環境設定，不能打包進 App。
- 簽章可以用 `firebase/php-jwt`：目前只是間接依賴，使用時要直接列進 `composer.json`。
- 呼叫外部服務的寫法可以比照既有的 `ExternalApiService`。
- 員工離職後，App 的 Sanctum token 可能仍然有效。intranet 在 launch 時會查 Portal，離職者會被擋下，所以 App 後端不必另外判斷。

**intranet 要改的**

| 項目 | 現況 | 要改成 |
|---|---|---|
| 信任的簽發者 | 只有一組 `WEBVIEW_JWT_ISSUER`／`WEBVIEW_JWT_PUBLIC_KEY_B64` | 依 `iss` 選對應的公鑰，Portal、App 各一組。要新增環境變數，實作前取得同意 |
| 登入後的頁面 | launch 一律導到 `/`；Portal 再用 `postMessage` 的 `esign:navigate` 換頁 | WebView 沒有父頁面可以送 `postMessage`。目前依簽發者固定落地頁：App 一律導到旅遊平台前台首頁（S1-01 活動總覽，投票和報名入口都在這裡）。推播要直接開某個活動時，再讓 launch 帶站內相對路徑（之後規劃） |
| 登入來源 | Portal 和 OAuth 都寫 `webview` | 記錄是哪一個簽發者，Portal 和 App 分得出來（配合 027 的 `source`） |
| 資格規則 | 各入口各自呼叫 | OAuth、Portal、App 三個入口共用同一個「查 Portal、擋停用、更新部門」的 service |

**旅遊平台在 WebView 裡要處理的**

- App 只開投票頁和報名頁給同仁；管理頁面不進 App（使用者 2026-11-05 確認）。投票頁以手機為主（VOTE-PAGE，iPhone 15 Pro）；後台只做 PC 版（ACCT-61、ROLE-47）。
- 「查看行程」（VOTE-PAGE-16）要另開新分頁開網址或檔案，但 WebView 沒有分頁：
  - App 要處理 `target=_blank` 和檔案下載。
  - 如果交給系統瀏覽器開，系統瀏覽器沒有 intranet 的 cookie，需要登入才能讀的行程檔會打不開。
  - 要決定在 WebView 內開，或改用短效的簽名網址。
- session 固定 8 小時：App 每次開旅遊平台都重新 launch；使用中途到期就在頁面提示重新開啟。
- 投票開放時的尖峰：每次 launch 都會多打一次 App 後端和一次 Portal 查詢，壓測要一起算進去。

**之後改用 OAuth**

等 Portal 和 App 都改用 OAuth 登入，兩邊一起把 JWT 換成 OAuth 發的、收件者是 intranet 的 access token，launch、bridge、session 都不變。到時要做的：

- OAuth：
  - client 的 `allowed_auds` 加上 intranet。
  - intranet 用的 token 要帶 `employee_number`。收件者是 intranet 的 token 不能拿去打 userinfo，所以員編要直接放在 token 裡。
- client 端：同一個 client 有兩個收件者後，沒指定收件者的請求會被拒絕（`invalid_target: select one resource`，見 feastogether_oauth `resource-token.service.ts`）。所以既有的登入與換 token 請求都要明確帶 `resource`，要和 client 同步上線。
- intranet：改用 OAuth 的 JWKS 驗證，保留 `jti` 防重放；只剩 OAuth 一個簽發者後，移除 Portal、App 的公鑰設定。

**auth 細節**

- **前台只看 session 與資格名單**：
  - 投票、報名只需要有效 session，再依活動的資格名單比對員編（ROLE-38），不需要 `travel_accounts`。
  - 所以 App 進來的同仁不必有旅遊平台帳號。
- **不依登入來源限制權限**：
  - 從 App 進來的 session 和其他入口相同；管理者從 App 進來，畫面上只是沒有後台入口。
  - 不另外做「App 來的 session 不能進後台」，因為目前沒有這個需求。
- **共用手機與換帳號**：
  - App 的 WebView 會保留 intranet 的 cookie。
  - App 每次開旅遊平台都重新 launch，新的 cookie 會蓋掉舊的。
  - App 登出時清掉 WebView 裡 intranet 的 cookie，或呼叫 `DELETE /api/auth/session`。
  - 這樣下一位登入同一支手機的人，不會看到前一個人的投票頁。
- **限流不受影響**：
  - App 的 launch 全部從 `feastogether-backend` 同一個 IP 發出。
  - intranet 依 IP 的登入限流（`AuthThrottlerGuard`）只套在員工帳密登入，027 會移除該入口；`webview-launches` 和 bridge 的 `POST /api/auth/session` 都沒有掛。
  - 所以同一個 IP 不會被擋。
- **契約只換 `iss` 與金鑰**：
  - App 沿用 002 的 `typ`（`FT-ESIGN-LAUNCH+JWT`）和 `aud`（`feastogether-esign`）。名稱雖然是電子簽，但要改就得 Portal 一起改，所以先不動。
  - App 用自己的一組 RSA 金鑰。App 後端的金鑰外洩時，只要撤換這一組，不影響 Portal。
- **登入資格和投票資格不同**（待 PM 確認）：
  - 能登入的只有 Portal 狀態為試用或正式的員工（`PORTAL_ACTIVE_STATUS_NAMES`）。
  - 投票資格名單上的人如果不在這兩種狀態（例如留職停薪），連登入都進不去，也就看不到「您目前不具備本次投票資格」的提示，只會看到登入失敗。
  - 建議維持登入門檻，並請 PM 確認名單只會匯入在職員工。

**之後再規劃**

- 饗賓人推播直接開啟某個投票活動：屆時 launch 要能帶站內相對路徑，存在待啟動紀錄裡，不放進 `launchUrl`；驗證沿用 `safeLoginReturnPath`。

---

## 四、feastogether_oauth 還要配合的事

- **員工資料 API**：如果 intranet 維持直連 Portal，OAuth server 就不必提供員工資料 API，也不必為此先做 005。
- **離職訊息**：在 OAuth 登入頁顯示「無法登入，請洽人資」，要先決定是否修改防帳號枚舉規則（A3）。
- **登入尖峰**：3,000 人同時登入的承載要和 intranet 一起壓測。
- **同步時間**：OAuth 04:00、intranet 04:00、PRD 05:00，三者的先後與失敗語意要對齊。
- **WebView 入口改用 OAuth（之後）**：Portal 和饗賓人 App 改用 OAuth 登入後，要替 intranet 發帶員編的 access token，client 也要明確帶 `resource`。見〈三、8〉。

## 五、建議的處理順序

1. **028 實作前**：
   - 依 D1～D6 與〈module 管理員的細節〉修訂 028：
     - Super user 只獨占跨 module 管理。
     - module 管理員自行管理角色與權限，包括電子簽「同仁」的權限。
     - 稽核表改用 CKS 的 audit 並帶 `module_key`（〈稽核的落點〉）。
   - 依 M3 讓 028 的授權判斷依 module 讀取指派來源（`travel` 讀 `travel_accounts`）。
   - 旅遊平台作為第二個正式 module 納入 028 的設計。
2. **和 PM 對齊**：系統管理員不再是固定角色（D3）；「管理者／同仁」是一開始建立的角色，可以再新增（D5、D6）。
3. **HR 鏡像**：決定語意與來源，另開 spec 修訂 024。
4. **spike**：加密 xlsx；3,000 人投票與登入的壓測原型。
5. **第一個旅遊功能開工前**：定好錯誤代碼表、toast、axios timeout、通用寄信介面、共用表格。
6. **入口**：
   - OAuth 瀏覽器入口和首頁 PRD，排在投票頁之前。
   - 饗賓人 App 的 WebView launch（〈三、8〉）：目前擱置。
