# Spec014：帳密登入與 Spec017 的部門同步交互契約

**補充日期**：2026-11-02

本目錄原無 `spec.md`，本文件僅記錄 Spec017 引入的部門同步交互契約，不重建或宣稱保存完整的歷史帳密登入規格。原帳密驗證、資格檢查、錯誤與 session 行為以現有 [AuthService](../../server/src/features/auth/services/auth.service.ts) 及其單元／登入整合測試為準。

- 帳密驗證與既有可信 HR 查驗成功後，建立或更新 User 的 `departmentCode`／`departmentName`；只使用既有 HR 回應，不接受 client 自報部門。
- 非空白部門代碼保存原字串，大小寫與前後空白不正規化；已通過上游解析的缺值或全空白清為 SQL NULL，不沿用舊部門。上游格式不合法或連線失敗沿既有錯誤規則，不擴大登入資格、不加入 fallback。
- 本地 `department_id` 外鍵、密碼與非 HR 管理欄位不因此改寫；歷史文件建立部門、簽署快照與證據保持不變。
- session 不新增部門 claim。一般電子簽部門授權使用目前資料庫 User；成功登入同步調職後，先前 session 也依新部門取得或失去可見性。
- 無部門代碼不額外禁止既有合法登入；部門列表、新建文件與一般匯出回 409 `ESIGN_DEPARTMENT_UNAVAILABLE`，訊息為「無法取得您的部門資料，請重新登入或聯絡系統管理員」。本人任務與本人副本沿既有授權。
- WebView 與 OAuth 的相同可信同步原則見 [Spec002](../002-webview-sso-session/spec.md)，文件可見性與建立快照見 [Spec017](../017-department-document-visibility/spec.md)。
