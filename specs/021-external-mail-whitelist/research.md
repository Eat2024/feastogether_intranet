# Research: 非 production 白名單開放指定收件信箱

## 1. 規則存放方式

- **Decision**：在既有 `mail_recipient_whitelist` 新增 `type = 'email'`，值為正規化後的完整地址。
- **Rationale**：沿用 Spec 018 的維護程序、唯一鍵、軟刪除與「每次寄送重讀」語意，不需新表或新欄位。
- **Alternatives considered**：非員工一律放行（無法由信箱判斷是否為員工，且違背白名單目的）；網域規則（範圍過大）；環境變數清單（需重啟，018 已排除）；轉寄測試信箱（018 已排除）。

## 2. 比對順序與人資查詢

- **Decision**：先以信箱規則比對，全部命中即回傳；仍有未命中者才走 018 的部門／員編解析，結果取聯集。
- **Rationale**：外部簽署人寄送都是單一收件人（邀請、催簽走 `send`，OTP 走 `sendOtp`），群發 `sendInternalGroup` 只用於內部同仁；公司同仁一律走部門／員編規則。外部信箱因此不依賴人資來源，HR 故障也能測外部流程。
- **細節**：人資故障時沿 018 整次 check-failed。由於外部信箱不會與須查人資的地址混在同一次寄送，不需要另訂部分放行規則。

## 3. 資料庫格式限制

- **Decision**：`value` 放寬為 VARCHAR(255)，與 guarded sender 的收件地址上限一致；`email` 值以 CHECK 要求小寫、恰好一個 `@`、`@` 前後非空且不含空白／控制字元。部門與員編仍由原 CHECK 限制 50／20 字元。
- **Rationale**：欄位為 `utf8mb4_0900_bin` 精確比對，寫入大寫或含空白的值會永遠無法命中；DB 先擋下可省去政策服務重複正規化。唯一鍵 `(type, value)` 擴大後約 1,100 bytes，低於 InnoDB 3,072 bytes 上限。
- **不做**：完整 RFC 信箱驗證、公司網域阻擋（維護人只有使用者本人，同仁一律走部門／員編規則）。

## 4. 回滾

- **Decision**：down 還原原欄位長度與 CHECK，不刪資料；有 `email` 列時 MySQL 拒絕整句 ALTER。
- **Rationale**：符合 FR-010「不可靜默刪除維護資料」，且 InnoDB DDL 原子，失敗不留半套。維護人回滾前須先備份並刪除信箱規則列（含已撤銷列），寫入 018 maintenance。
