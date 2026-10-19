# API Contract: 簽署人候選組織架構

使用者後續要求採 KISS：讀快取 → 未命中呼叫上游 → 寫入 7,200 秒快取 → 回傳。允許同時未命中重複呼叫；不再使用鎖、輪詢、二次讀取或發布期限。Redis 使用既有 get/set。

**狀態**：後端已實作，HTTP 契約測試通過。DTO 完整定義見 [data-model.md](../data-model.md)。

## Request

`GET /api/esign/signer-candidates/org-chart`

- 既有內部員工 cookie session，每次請求都驗證；不新增角色或部門限制。
- 無 query/body 業務參數，無 refresh 或 TTL 參數。
- 只讀名冊，不建立帳號或簽署資料；正式員工來源沿用上游，不影響原有 candidate 員編搜尋。

## Success

HTTP 200，`Cache-Control: private, no-store`。

```json
{
  "success": true,
  "data": [],
  "timestamp": "2026-10-19T00:00:00.000Z"
}
```

`data` 為 OrgDepartment 陣列，合法空陣列也是成功。timestamp 為本次回應時間。controller 回傳 DTO，由既有 interceptor 包裝；Swagger 應描述完整 envelope，不把 data 宣告為頂層陣列。

## Errors

| 情況 | HTTP | 錯誤碼 |
| --- | --- | --- |
| session 缺少或無效 | 401 | 沿用既有認證錯誤 |
| 上游非成功、401/403、逾時、名冊任一筆格式錯誤 | 502 | `ORG_CHART_UPSTREAM_UNAVAILABLE` |
| Redis 讀寫失敗 | 503 | `ORG_CHART_UNAVAILABLE` |

錯誤碼、繁體中文訊息及狀態於既有 app-errors 集中定義，使用既有 error envelope：

```json
{
  "success": false,
  "error": {
    "code": "ORG_CHART_UPSTREAM_UNAVAILABLE",
    "message": "組織架構來源暫時無法使用，請稍後再試"
  },
  "timestamp": "2026-10-19T00:00:00.000Z"
}
```

503 訊息為「組織架構暫時無法使用，請稍後再試」。不提供原始上游 body／message 或憑證。上游 401/403 不改寫成使用者登入錯誤。

## Upstream Boundary

Server 經既有 FeastogetherClient 呼叫 `GET /api/v1/hr/org_chart`，使用既有 base URL 與 X-API-KEY，不傳使用者 Bearer token。成功必須有 `success: true` 及合法 data 陣列；metadata 不透傳。上游錯誤與任一筆必要資料格式錯誤均整批拒絕，不產生部分成功。
