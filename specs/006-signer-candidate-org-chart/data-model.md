# Data Model: 組織樹 DTO 與暫存狀態

使用者後續要求採 KISS：讀快取 → 未命中呼叫上游 → 寫入 7,200 秒快取 → 回傳。允許同時未命中重複呼叫；不再使用鎖、輪詢、二次讀取或發布期限。Redis 使用既有 get/set。

本功能不建立 DB table、entity、migration 或帳號同步資料；以下為 API DTO 與 Redis 暫存狀態。

## OrgDepartment

| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| department_ch_id | string | 非空部門代碼，保留前導零 |
| department_name | string | 來源部門名稱 |
| department_parent_guid | string 或 null | 上層部門代碼 |
| startdate | string 或 null | 保留原始字串，允許空字串 |
| stopdate | null | 上游只查 stopdate IS NULL |
| children | OrgDepartment[] | 直屬子部門，可為空陣列 |
| employees | OrgEmployee[] | 直屬員工，可為空陣列 |

## OrgEmployee

| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| person_empid | string | 保留原始字串與前導零，不轉數值或本機 userId |
| person_name | string 或 null | 員工姓名 |
| title | string 或 null | 職稱 |

所有列出的欄位皆須存在，nullable 不等於可省略。沿用 spec 型別，不額外新增員編八碼驗證、日期轉換或 HR 資格推論。只保留上述欄位、來源順序與樹狀關係；不把子部門員工複製到父部門，也不另做排序或去重。任一筆必要資料缺漏或型別錯誤整批拒絕。

## Redis 暫存狀態

| 項目 | 內容與生命週期 |
| --- | --- |
| 資料 key | schema 版本及 `OrgDepartment[]`；成功原子寫入時設定 7,200 秒 TTL，讀取不續期 |
| namespace | 本功能、版本與既有環境／來源的穩定識別 |

空陣列是有效資料，不可等同無快取。錯誤 JSON、版本不符或結構錯誤視為未命中，經相同更新流程修復。
