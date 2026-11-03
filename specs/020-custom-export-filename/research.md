# Research: 自訂當次匯出檔名

## 1. 沿用原下載，只有名稱需要新能力

**Decision**：一支準備下載 POST 共用 Excel／ZIP；不保存名稱。

**Rationale**：`DocumentExportView` 已有未串接輸入框；`buildExportXlsx` 在前端產檔，`ZipExportPanel` 用 GET 原生下載。`EsignExportService.download` 已有授權、歸屬與成果檢查，可供 ZIP 準備與實際下載重用。現有工作依 Spec 019 固定沿用，不應因名稱重新產生。

**Alternatives considered**：更新 file object 名稱會影響其他人；增加 DB／Redis 暫存與 token 會擴張這個無持久需求的功能；只有前端改名不滿足使用者新增 API 的要求。

## 2. 同源下載名稱與回應標頭

**Decision**：ZIP GET 支援固定 `downloadName=client`，僅回 `Content-Disposition: attachment`，由同源 `a.download` 提供後端驗證後名稱。未帶旗標維持原有 filename*。

**Rationale**：HTTP header 的 filename 會優先於 download 屬性；省略 header 中的名稱可讓同源連結提供建議名稱。採用此機制的設計推論依據為 [MDN anchor download](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a) 與 [HTML Standard 的下載演算法](https://html.spec.whatwg.org/multipage/links.html#downloading-resources)。仍須在實際入口網／支援瀏覽器驗證，尚未執行瀏覽器測試。

**Alternatives considered**：名稱放 query 違反敏感資料邊界；整包 Blob 破壞既有大檔下載特性；POST form + 隱藏 iframe 會遇到既有 `X-Frame-Options: DENY` 及入口網祖先頁限制，為改名變更 frame 安全設定沒有必要。

## 3. 名稱不進日誌與並行互不影響

**Decision**：名稱僅放 POST body、必要回應與 DOM；GET query 只有固定非個資旗標。

**Rationale**：`http-access-log.interceptor.ts` 已對電子簽請求排除 body 日誌。新 API 無狀態，不會出現共用檔名覆寫，也不需要有效期／回收機制。實際 GET 仍重新授權，準備結果不是下載憑證。

**Alternatives considered**：可逆編碼檔名仍會暴露內容；使用共享 cookie 保存名稱會有並行與路徑限制，不採用。

## 4. 原生下載的觀測邊界

**Decision**：API 事先檢查 ZIP 可用性；前端只承諾交付瀏覽器，不承諾觀測下載成功。原頁保留；失敗的準備請求沿用現有提示與 session 過期 UI。

**Rationale**：從 `a` 觸發的下載無一般 Promise 能得知完整傳輸成功。準備與 GET 之間仍可能 session 過期或檔案失效；GET 必須照常拒絕，不以準備成功放寬檢查。傳輸失敗交由瀏覽器下載介面，實際表現納入驗收。

**Alternatives considered**：輪詢、一次性票證或下載代理會增加非需求的狀態與維運負擔。

無待選型的新技術。瀏覽器相容性是實作驗收門檻，不是本次已驗證的結果。
