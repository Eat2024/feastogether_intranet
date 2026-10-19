# Quickstart: 組織樹 API 驗證

使用者後續要求採 KISS：讀快取 → 未命中呼叫上游 → 寫入 7,200 秒快取 → 回傳。允許同時未命中重複呼叫；不再使用鎖、輪詢、二次讀取或發布期限。Redis 使用既有 get/set。

後端功能與自動化驗證已完成。以下保留可重跑的步驟，實際結果與驗證限制記錄於文末。

## 前置條件

- 沿用 root pnpm workspace 與現有 Node.js 環境。
- 上游僅使用既有 `FEASTOGETHER_BASE_URL`、`FEASTOGETHER_API_KEY`；Redis 使用既有設定，不新增環境變數。
- e2e 使用既有 `.env.test` 與隔離 MySQL／Redis。MySQL 名稱須以 `feastogether_intranet_test` 開頭；Redis DB 須經 `assertTestRedisDb` 檢查，禁止 DB 0。
- 所有名冊 fixture 使用合成資料；不把真實組織資料、session 或 API Key 寫入文件／log。

## 自動驗證

從 repository root 執行：

```bash
pnpm -C server lint:check
pnpm -C server test --runInBand
pnpm -C server build
pnpm -C server test:e2e --testPathPatterns='org-chart|api-coverage'
```

`org-chart.e2e-spec.ts` 已納入既有 Jest e2e 收錄規則；執行時須確認有實際測試結果。

| 情境 | 預期 |
| --- | --- |
| 無 cookie／失效 session，快取存在或不存在 | 401，未讀組織快取或上游 |
| 多根、空部門、十層巢狀、前導零及 nullable 欄位 | 完整保留來源結構，只含白名單欄位 |
| 一筆必要欄位錯誤 | 整批 502、不寫入資料快取 |
| 合法空陣列 | 200 且快取 7,200 秒 |
| 兩實例共用 Redis | 一個實例成功寫入後，另一實例直接讀取快取 |
| 成功後 1,000 次查詢 | 上游額外零次，TTL 不續期 |
| 快取到期但無查詢／有下一次查詢 | 無背景更新／由查詢觸發一次更新 |
| Redis 讀寫失敗 | 回 503；讀取失敗不直連上游 |
| HTTP 回應／日誌 | 正確 envelope、no-store，無名冊或憑證洩漏 |

TTL 邊界可用受控時間測試驗證 T+7,199／7,200；真實 Redis 測試另外驗證實際 7,200 秒 TTL、讀取不續期與縮短測試 key TTL 後的到期行為，不必實際等待兩小時。測試只清理其唯一 namespace。

## 人工驗證（尚未執行）

在既有登入流程取得測試 session 後呼叫新端點，確認 200、資料結構與 no-store；再以未登入狀態確認 401。短時間重複查詢確認上游呼叫計數不增加。不得以真實名冊截圖或回應內容作為提交附件。

## 本次實作驗證（2026-10-19）

| 指令／檢查 | 結果 |
| --- | --- |
| `pnpm -C server test --runInBand` | 通過：89 suites、698 tests |
| `pnpm -C server test:e2e --testPathPatterns='org-chart\|api-coverage'` | 通過：2 suites、39 tests |
| `pnpm -C server lint:check` | 通過：0 errors、157 warnings；未順手修改任務外的 warning |
| `pnpm -C server build` | 通過 |
| `git diff --check` | 通過 |

單元測試另驗證十層樹、欄位裁切、必要欄位完整性、單筆錯誤整批拒絕、上游 401/403 與 HTTP 逾時錯誤映射、TTL 邊界及 namespace 隔離。DTO 沿用現有 class-validator／class-transformer，不新增套件。

## 交付範圍與限制

- Server：已簡化為讀快取、呼叫上游、寫快取及回傳；同時未命中可重複呼叫。

- Client：未修改，樹狀選人介面與正式串接仍屬後續工作。
- Migration／config：無新資料表、migration、環境變數、dependency 或排程；沿用 `.env.example` 的既有設定，沒有需要新增的設定文件。
- 權限：依已確認範圍，僅驗證員工 session，不新增 Role／Permission／部門授權。
- 真實上游 UAT 與人工驗證尚未執行，未部署；本機通過不代表已驗證真實名冊格式與規模。只列正式員工的來源語意仍依 spec 的上游契約。
