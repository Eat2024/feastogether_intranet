# Research: 組織樹 API

使用者後續要求採 KISS：讀快取 → 未命中呼叫上游 → 寫入 7,200 秒快取 → 回傳。允許同時未命中重複呼叫；不再使用鎖、輪詢、二次讀取或發布期限。Redis 使用既有 get/set。

**日期**：2026-10-19。依 repository 現況進行唯讀研究；未呼叫真實上游或取得員工名冊。

## 1. 沿用既有 candidate 與 department 服務

- **證據**：`signer-candidates.controller.ts` 已使用 candidate service；其 `list()` 在完整員編查無本機帳號時呼叫 `importStaff()` 並寫入 users。`FeastogetherDepartmentService` 已負責部門來源。
- **決策**：在既有 candidate service 新增獨立的組織樹讀取方法；上游由既有 department service 提供，不進入 list/importStaff。
- **理由**：責任相近且不需要新服務抽象，維持 GET 無業務寫入。
- **未採方案**：整棵樹逐人呼叫 candidate 搜尋會產生非必要匯入，直接 controller 呼叫上游會混入協調責任。

## 2. 上游驗證與錯誤隔離

- **證據**：`FeastogetherClient.unwrap()` 目前可接受裸 payload，只明確拒絕 `success === false`。`mapFeastogetherUpstreamError` 將上游 401/403 映射為使用者認證錯誤；client 的 request 與 unwrap 各有一份 omitBody 名單。
- **決策**：org_chart 專用路徑驗證上游 `success === true` 與合法 data；其餘既有端點行為不變。department service 驗證整棵樹、裁切欄位，任一筆格式錯誤整批拒絕。上游非成功、格式錯誤與連線逾時均對應本功能 502。
- **理由**：符合合法成功才快取、單筆錯誤整批拒絕，避免把 API Key 問題當成使用者 session 失效。
- **未採方案**：沿用通用 401 映射、接受模糊成功回應或略過錯誤資料。
- **日誌**：org_chart 同時加入兩處 body 省略；不記錄來源 code/message 等可能含自由文字的欄位，只記安全摘要。

## 3. Redis 共用快取

- **隔離**：使用既有 NODE_ENV、base URL 及 Redis 部署設定；key 中不放 API Key 或原始名冊。資料版本不符或損毀視同未命中。

- **決策**：沿用 Redis get/set，成功寫入時設定 7,200 秒 TTL。

## 4. 失敗行為

- **決策**：上游失敗回 502，Redis 讀寫失敗回 503，不自動重試。

- **未採方案**：Pub/Sub、續租、錯誤傳播通道、重試策略、過期名冊 fallback。

## 5. 模組與驗證

- **證據**：`FeastogetherModule` 目前未匯出 FeastogetherConfig；`EsignModule` 可透過既有 RedisModule 取得 RedisService。全域 AuthGuard 與 ResponseInterceptor 分別負責 session 與 envelope。
- **決策**：實作時補必要的既有 provider 匯出／import；用正式 AppModule 的 HTTP 測試檢查 DI 與路由，另用兩個獨立服務實例連到隔離測試 Redis 驗證共用快取。
- **理由**：mock service 測試不會發現模組注入遺漏，也不能證明跨實例共用快取。
- **未採方案**：只測 process 內 mock、把上游實際個資存為 fixture。

研究已解決本期規劃所需的技術選擇；沒有需新增產品需求才能繼續的項目。上游 60 秒快取、只列正式員工及欄位契約沿用 spec 的來源確認，未在本次重新連線驗證。
